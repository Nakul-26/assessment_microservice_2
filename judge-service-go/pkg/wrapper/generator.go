package wrapper

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"

	"judge-service-go/pkg/languages"
	"judge-service-go/pkg/models"
)

// safe identifier regexp
var validIdent = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)

func escapeForJavaString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, `
`, `\n`)
	s = strings.ReplaceAll(s, `
`, `\r`)
	s = strings.ReplaceAll(s, `	`, `\t`)
	return s
}

// GenerateWrapper generates the wrapper source for a problem + language.
func GenerateWrapper(p models.Problem, lang *languages.Language, submissionFuncName string) (string, error) {
	if len(p.TestCases) == 0 && len(p.TestsJSON) > 0 {
		if err := p.ParseTestsJSON(); err != nil {
			return "", fmt.Errorf("failed to parse TestsJSON: %w", err)
		}
	}

	tplPath := filepath.Join("pkg", "wrappers", lang.WrapperTemplate)
	b, err := os.ReadFile(tplPath)
	if err != nil {
		return "", fmt.Errorf("failed to read template %s: %w", tplPath, err)
	}
	tpl := string(b)

	sanitizedFuncName, _ := sanitizeIdentifier(submissionFuncName)

	// For Java, continue using the template engine because it has complex logic.
	if lang.ID == "java" {
		ctx := map[string]interface{}{
			"FUNCTION_NAME":        sanitizedFuncName,
			"EXPECTED_OUTPUT_TYPE": p.ExpectedIoType.ReturnType,
			"TestCases":            p.TestCases,
			"CLASS_NAME":           "Solution",
		}

		javaTests, javaExpected, err := buildJavaTestLiterals(p)
		if err != nil {
			return "", fmt.Errorf("failed to build Java test literals: %w", err)
		}
		ctx["TESTS_LITERAL"] = javaTests
		ctx["EXPECTED_LITERAL"] = javaExpected

		testsJSONBytes, err := json.Marshal(p.TestCases)
		if err != nil {
			return "", fmt.Errorf("failed to marshal TestCases to JSON: %w", err)
		}
		ctx["TESTS_JSON_STRING"] = string(testsJSONBytes)

		t, err := template.New("wrapper").Option("missingkey=error").Parse(string(b))
		if err != nil {
			return "", fmt.Errorf("failed to parse template %s: %w", tplPath, err)
		}
		var out bytes.Buffer
		if err := t.Execute(&out, ctx); err != nil {
			return "", fmt.Errorf("failed to execute template %s: %w", tplPath, err)
		}

		result := out.String()
		result = strings.ReplaceAll(result, "{{COMPARE_MODE}}", "") // Assuming empty for now
		return result, nil
	}

	// For other languages (JS, Python, etc.), use simple string replacement.
	tpl = strings.ReplaceAll(tpl, "{{FUNCTION_NAME}}", sanitizedFuncName)

	// Always marshal p.TestCases to ensure valid JSON is injected.
	testsJSONBytes, err := json.Marshal(p.TestCases)
	if err != nil {
		return "", fmt.Errorf("failed to marshal TestCases to JSON: %w", err)
	}
	tpl = strings.ReplaceAll(tpl, "{{TESTS_JSON}}", string(testsJSONBytes))

	tpl = strings.ReplaceAll(tpl, "{{EXPECTED_OUTPUT_TYPE}}", p.ExpectedIoType.ReturnType)
	tpl = strings.ReplaceAll(tpl, "{{COMPARE_MODE}}", "") // Default to empty string

	return tpl, nil
}

func sanitizeIdentifier(name string) (string, bool) {
	if validIdent.MatchString(name) {
		return name, true
	}
	re := regexp.MustCompile(`[^A-Za-z0-9_]`)
	s := re.ReplaceAllString(name, "_")
	if !regexp.MustCompile(`^[A-Za-z_]`).MatchString(s) {
		s = "f_" + s
	}
	if len(s) > 127 {
		s = s[:127]
	}
	return s, false
}

func buildJavaTestLiterals(p models.Problem) (string, string, error) {
	var testsBuf strings.Builder
	var expectedBuf strings.Builder

	allIntInputs := true
	for _, tc := range p.TestCases {
		for _, in := range tc.Input {
			switch v := in.(type) {
			case []interface{}:
				for _, e := range v {
					_, okFloat := e.(float64)
					_, okInt64 := e.(int64)
					_, okInt := e.(int)
					if !(okFloat || okInt64 || okInt) {
						allIntInputs = false
					}
				}
			default:
				_, okFloat := in.(float64)
				_, okInt64 := in.(int64)
				_, okInt := in.(int)
				if !(okFloat || okInt64 || okInt) {
					allIntInputs = false
				}
			}
		}
	}

	if allIntInputs {
		testsBuf.WriteString("Object[][] tests = new Object[][]{\n")
		expectedBuf.WriteString("Object[] expected = new Object[]{\n")

		for _, tc := range p.TestCases {
			testsBuf.WriteString("    new Object[]{")
			for i, in := range tc.Input {
				if arr, ok := in.([]interface{}); ok {
					testsBuf.WriteString("new int[]{")
					for j, vv := range arr {
						num := numericToInt(vv)
						if j > 0 {
							testsBuf.WriteString(",")
						}
						testsBuf.WriteString(fmt.Sprintf("%d", num))
					}
					testsBuf.WriteString("}")
				} else {
					num := numericToInt(in)
					testsBuf.WriteString(fmt.Sprintf("%d", num))
				}
				if i < len(tc.Input)-1 {
					testsBuf.WriteString(", ")
				}
			}
			testsBuf.WriteString("},\n")

			switch exp := tc.ExpectedOutput.(type) {
			case float64:
				expectedBuf.WriteString(fmt.Sprintf("    %d,\n", int64(exp)))
			case int64:
				expectedBuf.WriteString(fmt.Sprintf("    %d,\n", exp))
			case int:
				expectedBuf.WriteString(fmt.Sprintf("    %d,\n", exp))
			case []interface{}:
				expectedBuf.WriteString("    new int[]{")
				for j, vv := range exp {
					num := numericToInt(vv)
					if j > 0 {
						expectedBuf.WriteString(",")
					}
					expectedBuf.WriteString(fmt.Sprintf("%d", num))
				}
				expectedBuf.WriteString("},\n")
			default:
				jb, _ := json.Marshal(exp)
				expectedBuf.WriteString(fmt.Sprintf("    %s,\n", string(jb)))
			}
		}

		testsBuf.WriteString("};")
		expectedBuf.WriteString("};")
		return testsBuf.String(), expectedBuf.String(), nil
	}

	jb, err := json.Marshal(p.TestCases)
	if err != nil {
		return "", "", fmt.Errorf("failed to marshal tests to json: %w", err)
	}
	escaped := escapeForJavaString(string(jb))
	testsLiteral := fmt.Sprintf("String testsJson = \"%s\";", escaped)
	return testsLiteral, "", nil
}

func numericToInt(v interface{}) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	default:
		return 0
	}
}
