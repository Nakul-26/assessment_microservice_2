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
	"judge-service-go/pkg/types"
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
func GenerateWrapper(p models.Problem, lang *languages.Language, submissionFuncName string, templateName string) (string, error) {
	if len(p.TestCases) == 0 && len(p.TestsJSON) > 0 {
		if err := p.ParseTestsJSON(); err != nil {
			return "", fmt.Errorf("failed to parse TestsJSON: %w", err)
		}
	}

	if templateName == "" {
		templateName = lang.WrapperTemplate
	}

	tplPath := filepath.Join("pkg", "wrappers", templateName)
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
			"EXPECTED_OUTPUT_TYPE": p.ReturnType,
			"TestCases":            p.TestCases,
			"CLASS_NAME":           "GeneratedTester",
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

	if lang.ID == "cpp" {
		tpl = strings.ReplaceAll(tpl, "{{FUNCTION_NAME}}", sanitizedFuncName)
		cppCall := buildCppCall(p, sanitizedFuncName)
		tpl = strings.ReplaceAll(tpl, "// GENERATED_CALL_MARKER", cppCall)
		return tpl, nil
	}

	if lang.ID == "c" {
		tpl = strings.ReplaceAll(tpl, "{{FUNCTION_NAME}}", sanitizedFuncName)
		cCall := buildCCall(p, sanitizedFuncName)
		tpl = strings.ReplaceAll(tpl, "// GENERATED_CALL_MARKER", cCall)
		return tpl, nil
	}

	if lang.ID == "go" {
		tpl = strings.ReplaceAll(tpl, "{{FUNCTION_NAME}}", sanitizedFuncName)
		goCall := buildGoCall(p, sanitizedFuncName)
		tpl = strings.ReplaceAll(tpl, "// GENERATED_CALL_MARKER", goCall)
		return tpl, nil
	}

	if lang.ID == "rust" {
		tpl = strings.ReplaceAll(tpl, "{{FUNCTION_NAME}}", sanitizedFuncName)
		rustCall := buildRustCall(p, sanitizedFuncName)
		tpl = strings.ReplaceAll(tpl, "// GENERATED_CALL_MARKER", rustCall)
		return tpl, nil
	}

	// For other languages (JS, Python, etc.), use simple string replacement.
	tpl = strings.ReplaceAll(tpl, "{{FUNCTION_NAME}}", sanitizedFuncName)

	// Always marshal p.TestCases to ensure valid JSON is injected.
	testsJSONBytes, err := json.Marshal(p.TestCases)
	if err != nil {
		return "", fmt.Errorf("failed to marshal TestCases to JSON: %w", err)
	}
	tpl = strings.ReplaceAll(tpl, "{{TESTS_JSON}}", string(testsJSONBytes))

	paramsJSONBytes, err := json.Marshal(p.Parameters)
	if err != nil {
		return "", fmt.Errorf("failed to marshal Parameters to JSON: %w", err)
	}
	paramsJSON := string(paramsJSONBytes)
	if lang.ID == "csharp" {
		paramsJSON = strings.ReplaceAll(paramsJSON, "\"", "\"\"")
	}
	tpl = strings.ReplaceAll(tpl, "{{PARAMS_JSON}}", paramsJSON)
	tpl = strings.ReplaceAll(tpl, "{{RETURN_TYPE}}", p.ReturnType)

	tpl = strings.ReplaceAll(tpl, "{{EXPECTED_OUTPUT_TYPE}}", p.ReturnType)
	// Inject compare mode and deep-copy flag
	replCompare := ""
	if p.CompareConfig.Mode != "" {
		replCompare = p.CompareConfig.Mode
	}
	tpl = strings.ReplaceAll(tpl, "{{COMPARE_MODE}}", replCompare)
	// Inject deep-copy flag, using language-appropriate boolean literal
deepCopyStr := fmt.Sprintf("%t", p.CompareConfig.RequireDeepCopy)
if lang.ID == "python" {
// Python booleans are capitalized
deepCopyStr = strings.Title(deepCopyStr)
}
tpl = strings.ReplaceAll(tpl, "{{REQUIRE_DEEP_COPY}}", deepCopyStr)

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

			switch exp := tc.Expected.(type) {
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

func cppType(t string) string {
	parsed, err := types.ParseType(t)
	if err != nil {
		return "auto"
	}
	return mapCppType(parsed)
}

func mapCppType(t types.ParsedType) string {
	switch t.Kind {
	case types.NumberKind:
		return "int"
	case types.StringKind:
		return "std::string"
	case types.BooleanKind:
		return "bool"
	case types.VoidKind:
		return "void"
	case types.ArrayKind:
		return "std::vector<" + mapCppType(*t.Element) + ">"
	case types.MatrixKind:
		return "std::vector<std::vector<" + mapCppType(*t.Element) + ">>"
	case types.LinkedListKind:
		return "ListNode*"
	case types.TreeKind:
		return "TreeNode*"
	case types.GraphKind:
		return "Node*"
	default:
		return "auto"
	}
}

func buildCppCall(p models.Problem, funcName string) string {
	var sb strings.Builder
	for i, param := range p.Parameters {
		sb.WriteString(fmt.Sprintf("        %s arg%d = ", cppType(param.Type), i))
		switch param.Type {
		case "linkedlist<number>":
			sb.WriteString(fmt.Sprintf("list_from_json(inputs[%d]);\n", i))
		case "tree<number>":
			sb.WriteString(fmt.Sprintf("tree_from_json(inputs[%d]);\n", i))
		case "graph<number>":
			sb.WriteString(fmt.Sprintf("graph_from_json(inputs[%d]);\n", i))
		default:
			sb.WriteString(fmt.Sprintf("inputs[%d].get<%s>();\n", i, cppType(param.Type)))
		}
	}

	if p.ReturnType == "void" {
		sb.WriteString(fmt.Sprintf("        sol.%s(", funcName))
		for i := range p.Parameters {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(fmt.Sprintf("arg%d", i))
		}
		sb.WriteString(");\n")

		if len(p.Parameters) > 0 {
			sb.WriteString("        result[\"output\"] = arg0;\n")
		} else {
			sb.WriteString("        result[\"output\"] = nullptr;\n")
		}
	} else {
		sb.WriteString(fmt.Sprintf("        %s output = sol.%s(", cppType(p.ReturnType), funcName))
		for i := range p.Parameters {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(fmt.Sprintf("arg%d", i))
		}
		sb.WriteString(");\n")
		sb.WriteString("        result[\"output\"] = output;\n")
	}
	sb.WriteString("        std::cerr << result.dump() << std::endl;")
	return sb.String()
}

func goType(t string) string {
	parsed, err := types.ParseType(t)
	if err != nil {
		return "interface{}"
	}
	return mapGoType(parsed)
}

func mapGoType(t types.ParsedType) string {
	switch t.Kind {
	case types.NumberKind:
		return "int"
	case types.StringKind:
		return "string"
	case types.BooleanKind:
		return "bool"
	case types.VoidKind:
		return ""
	case types.ArrayKind:
		return "[]" + mapGoType(*t.Element)
	case types.MatrixKind:
		return "[][]" + mapGoType(*t.Element)
	case types.LinkedListKind:
		return "*ListNode"
	case types.TreeKind:
		return "*TreeNode"
	case types.GraphKind:
		return "*Node"
	default:
		return "interface{}"
	}
}

func buildGoCall(p models.Problem, funcName string) string {
	var sb strings.Builder
	for i, param := range p.Parameters {
		t := goType(param.Type)
		sb.WriteString(fmt.Sprintf("\tvar arg%d %s\n", i, t))
		switch param.Type {
		case "linkedlist<number>":
			sb.WriteString(fmt.Sprintf("\targ%d = listFromJSON(payload.Inputs[%d])\n", i, i))
		case "tree<number>":
			sb.WriteString(fmt.Sprintf("\targ%d = treeFromJSON(payload.Inputs[%d])\n", i, i))
		case "graph<number>":
			sb.WriteString(fmt.Sprintf("\targ%d = graphFromJSON(payload.Inputs[%d])\n", i, i))
		default:
			sb.WriteString(fmt.Sprintf("\tif err := json.Unmarshal(payload.Inputs[%d], &arg%d); err != nil {\n", i, i))
			sb.WriteString("\t\tresult.Error = \"Runtime Error\"\n")
			sb.WriteString(fmt.Sprintf("\t\tfmt.Printf(\"{\\\"error\\\": \\\"Runtime Error\\\", \\\"message\\\": \\\"failed to unmarshal arg%d: %%v\\\"}\\n\", err)\n", i))
			sb.WriteString("\t\treturn\n")
			sb.WriteString("\t}\n")
		}
	}

	if p.ReturnType == "void" {
		sb.WriteString(fmt.Sprintf("\t%s(", funcName))
		for i := range p.Parameters {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(fmt.Sprintf("arg%d", i))
		}
		sb.WriteString(")\n")
		if len(p.Parameters) > 0 {
			sb.WriteString("\tresult.Output = arg0\n")
		} else {
			sb.WriteString("\tresult.Output = nil\n")
		}
	} else {
		sb.WriteString(fmt.Sprintf("\toutput := %s(", funcName))
		for i := range p.Parameters {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(fmt.Sprintf("arg%d", i))
		}
		sb.WriteString(")\n")
		sb.WriteString("\tresult.Output = output\n")
	}

	sb.WriteString("\tjsonRes, _ := json.Marshal(result)\n")
	sb.WriteString("\tfmt.Fprintln(os.Stderr, string(jsonRes))\n")
	return sb.String()
}

func cType(t string) string {
	parsed, err := types.ParseType(t)
	if err != nil {
		return "int"
	}
	return mapCType(parsed)
}

func mapCType(t types.ParsedType) string {
	switch t.Kind {
	case types.NumberKind:
		return "int"
	case types.StringKind:
		return "const char*"
	case types.BooleanKind:
		return "bool"
	case types.VoidKind:
		return "void"
	case types.LinkedListKind:
		return "struct ListNode*"
	case types.TreeKind:
		return "struct TreeNode*"
	case types.GraphKind:
		return "struct Node*"
	case types.ArrayKind:
		return mapCType(*t.Element) + "*"
	case types.MatrixKind:
		return mapCType(*t.Element) + "**"
	default:
		return "void*"
	}
}

func buildCCall(p models.Problem, funcName string) string {
	var sb strings.Builder
	for i, param := range p.Parameters {
		t := cType(param.Type)
		parsed, _ := types.ParseType(param.Type)
		switch parsed.Kind {
		case types.NumberKind:
			sb.WriteString(fmt.Sprintf("        %s arg%d = json_object_get_int(json_object_array_get_idx(inputs, %d));\n", t, i, i))
		case types.StringKind:
			sb.WriteString(fmt.Sprintf("        %s arg%d = json_object_get_string(json_object_array_get_idx(inputs, %d));\n", t, i, i))
		case types.BooleanKind:
			sb.WriteString(fmt.Sprintf("        %s arg%d = json_object_get_boolean(json_object_array_get_idx(inputs, %d));\n", t, i, i))
		case types.LinkedListKind:
			sb.WriteString(fmt.Sprintf("        %s arg%d = list_from_json(json_object_array_get_idx(inputs, %d));\n", t, i, i))
		case types.TreeKind:
			sb.WriteString(fmt.Sprintf("        %s arg%d = tree_from_json(json_object_array_get_idx(inputs, %d));\n", t, i, i))
		case types.GraphKind:
			sb.WriteString(fmt.Sprintf("        %s arg%d = graph_from_json(json_object_array_get_idx(inputs, %d));\n", t, i, i))
		case types.ArrayKind:
			sb.WriteString(fmt.Sprintf("        int arg%d_size;\n", i))
			helper := "array_from_json"
			if parsed.Element.Kind == types.StringKind {
				helper = "string_array_from_json"
			} else if parsed.Element.Kind == types.BooleanKind {
				helper = "bool_array_from_json"
			}
			sb.WriteString(fmt.Sprintf("        %s arg%d = %s(json_object_array_get_idx(inputs, %d), &arg%d_size);\n", t, i, helper, i, i))
		case types.MatrixKind:
			sb.WriteString(fmt.Sprintf("        int arg%d_rows;\n", i))
			sb.WriteString(fmt.Sprintf("        int* arg%d_cols;\n", i))
			helper := "matrix_from_json"
			if parsed.Element.Kind == types.StringKind {
				helper = "string_matrix_from_json"
			} else if parsed.Element.Kind == types.BooleanKind {
				helper = "bool_matrix_from_json"
			}
			sb.WriteString(fmt.Sprintf("        %s arg%d = %s(json_object_array_get_idx(inputs, %d), &arg%d_rows, &arg%d_cols);\n", t, i, helper, i, i, i))
		default:
			sb.WriteString(fmt.Sprintf("        %s arg%d = NULL; // Unsupported type\n", t, i))
		}
	}

	if p.ReturnType == "void" {
		sb.WriteString(fmt.Sprintf("        %s(", funcName))
		for i, param := range p.Parameters {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(fmt.Sprintf("arg%d", i))
			parsed, _ := types.ParseType(param.Type)
			if parsed.Kind == types.ArrayKind {
				sb.WriteString(fmt.Sprintf(", arg%d_size", i))
			} else if parsed.Kind == types.MatrixKind {
				sb.WriteString(fmt.Sprintf(", arg%d_rows, arg%d_cols", i, i))
			}
		}
		sb.WriteString(");\n")
		if len(p.Parameters) > 0 {
			param0 := p.Parameters[0]
			parsed0, _ := types.ParseType(param0.Type)
			if parsed0.Kind == types.ArrayKind {
				sb.WriteString("        int output_size = arg0_size;\n")
			} else if parsed0.Kind == types.MatrixKind {
				sb.WriteString("        int output_rows = arg0_rows;\n")
				sb.WriteString("        int* output_cols = arg0_cols;\n")
			}
			jsonAddOutput(&sb, param0.Type, "arg0")
		} else {
			jsonAddOutput(&sb, p.ReturnType, "NULL")
		}
	} else {
		retType := cType(p.ReturnType)
		parsedReturn, _ := types.ParseType(p.ReturnType)
		if parsedReturn.Kind == types.ArrayKind {
			sb.WriteString("        int output_size = 0;\n")
		} else if parsedReturn.Kind == types.MatrixKind {
			sb.WriteString("        int output_rows = 0;\n")
			sb.WriteString("        int* output_cols = NULL;\n")
		}
		sb.WriteString(fmt.Sprintf("        %s output = %s(", retType, funcName))

		for i, param := range p.Parameters {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(fmt.Sprintf("arg%d", i))
			parsedParam, _ := types.ParseType(param.Type)
			if parsedParam.Kind == types.ArrayKind {
				sb.WriteString(fmt.Sprintf(", arg%d_size", i))
			} else if parsedParam.Kind == types.MatrixKind {
				sb.WriteString(fmt.Sprintf(", arg%d_rows, arg%d_cols", i, i))
			}
		}
		if parsedReturn.Kind == types.ArrayKind {
			if len(p.Parameters) > 0 {
				sb.WriteString(", &output_size")
			} else {
				sb.WriteString("&output_size")
			}
		} else if parsedReturn.Kind == types.MatrixKind {
			if len(p.Parameters) > 0 {
				sb.WriteString(", &output_rows, &output_cols")
			} else {
				sb.WriteString("&output_rows, &output_cols")
			}
		}
		sb.WriteString(");\n")

		// Add output to result based on type
		jsonAddOutput(&sb, p.ReturnType, "output")
	}
	sb.WriteString("        fprintf(stderr, \"%s\\n\", json_object_to_json_string(result));")
	return sb.String()
}

func jsonAddOutput(sb *strings.Builder, returnType string, varName string) {
	parsed, _ := types.ParseType(returnType)
	switch parsed.Kind {
	case types.NumberKind:
		sb.WriteString(fmt.Sprintf("        json_object_object_add(result, \"output\", json_object_new_int(%s));\n", varName))
	case types.StringKind:
		sb.WriteString(fmt.Sprintf("        json_object_object_add(result, \"output\", json_object_new_string(%s));\n", varName))
	case types.BooleanKind:
		sb.WriteString(fmt.Sprintf("        json_object_object_add(result, \"output\", json_object_new_boolean(%s));\n", varName))
	case types.LinkedListKind:
		sb.WriteString(fmt.Sprintf("        json_object_object_add(result, \"output\", list_to_json(%s));\n", varName))
	case types.TreeKind:
		sb.WriteString(fmt.Sprintf("        json_object_object_add(result, \"output\", tree_to_json(%s));\n", varName))
	case types.GraphKind:
		sb.WriteString(fmt.Sprintf("        json_object_object_add(result, \"output\", graph_to_json(%s));\n", varName))
	case types.ArrayKind:
		helper := "array_to_json"
		if parsed.Element.Kind == types.StringKind {
			helper = "string_array_to_json"
		} else if parsed.Element.Kind == types.BooleanKind {
			helper = "bool_array_to_json"
		}
		sb.WriteString(fmt.Sprintf("        json_object_object_add(result, \"output\", %s(%s, output_size));\n", helper, varName))
	case types.MatrixKind:
		helper := "matrix_to_json"
		if parsed.Element.Kind == types.StringKind {
			helper = "string_matrix_to_json"
		} else if parsed.Element.Kind == types.BooleanKind {
			helper = "bool_matrix_to_json"
		}
		sb.WriteString(fmt.Sprintf("        json_object_object_add(result, \"output\", %s(%s, output_rows, output_cols));\n", helper, varName))
	default:
		sb.WriteString("        json_object_object_add(result, \"output\", NULL);\n")
	}
}

// rustJSONHelpers returns the (fromJSON, toJSON) helper function names (defined
// statically in rust_wrapper.tpl) for a given parsed type. Only number, string,
// boolean, array<...> and matrix<...> of those are supported for Rust — the Rust
// judge intentionally does not support linkedlist/tree/graph types.
func rustJSONHelpers(t types.ParsedType) (fromJSON string, toJSON string, ok bool) {
	switch t.Kind {
	case types.NumberKind:
		return "json_to_i32", "i32_to_json", true
	case types.StringKind:
		return "json_to_string", "string_to_json", true
	case types.BooleanKind:
		return "json_to_bool", "bool_to_json", true
	case types.ArrayKind:
		if t.Element == nil {
			return "", "", false
		}
		switch t.Element.Kind {
		case types.NumberKind:
			return "json_to_vec_i32", "vec_i32_to_json", true
		case types.StringKind:
			return "json_to_vec_string", "vec_string_to_json", true
		case types.BooleanKind:
			return "json_to_vec_bool", "vec_bool_to_json", true
		default:
			return "", "", false
		}
	case types.MatrixKind:
		if t.Element == nil {
			return "", "", false
		}
		switch t.Element.Kind {
		case types.NumberKind:
			return "json_to_matrix_i32", "matrix_i32_to_json", true
		case types.StringKind:
			return "json_to_matrix_string", "matrix_string_to_json", true
		case types.BooleanKind:
			return "json_to_matrix_bool", "matrix_bool_to_json", true
		default:
			return "", "", false
		}
	default:
		return "", "", false
	}
}

// buildRustCall generates the body that replaces // GENERATED_CALL_MARKER in
// rust_wrapper.tpl: it converts each JSON input to its typed Rust value, calls
// the user's Solution method, and prints the {"output": ...} judge line.
func buildRustCall(p models.Problem, funcName string) string {
	var sb strings.Builder

	type paramInfo struct {
		fromJSON string
		toJSON   string
	}
	params := make([]paramInfo, len(p.Parameters))

	unsupported := false
	for i, param := range p.Parameters {
		parsed, err := types.ParseType(param.Type)
		if err != nil {
			unsupported = true
			break
		}
		fromJSON, toJSON, ok := rustJSONHelpers(parsed)
		if !ok {
			unsupported = true
			break
		}
		params[i] = paramInfo{fromJSON: fromJSON, toJSON: toJSON}
	}

	var returnToJSON string
	if !unsupported && p.ReturnType != "void" {
		returnParsed, err := types.ParseType(p.ReturnType)
		if err != nil {
			unsupported = true
		} else {
			_, toJSON, ok := rustJSONHelpers(returnParsed)
			if !ok {
				unsupported = true
			} else {
				returnToJSON = toJSON
			}
		}
	}

	if unsupported {
		sb.WriteString("    compile_error!(\"this problem uses a type not supported by the Rust judge (only number/string/boolean/array/matrix are supported)\");\n")
		return sb.String()
	}

	for i, info := range params {
		sb.WriteString(fmt.Sprintf("    let mut arg%d = %s(&inputs[%d]);\n", i, info.fromJSON, i))
	}
	sb.WriteString("    let sol = Solution;\n")

	if p.ReturnType == "void" {
		sb.WriteString(fmt.Sprintf("    sol.%s(", funcName))
		for i := range params {
			if i > 0 {
				sb.WriteString(", ")
			}
			if i == 0 {
				sb.WriteString("&mut arg0")
			} else {
				sb.WriteString(fmt.Sprintf("arg%d", i))
			}
		}
		sb.WriteString(");\n")
		if len(params) > 0 {
			sb.WriteString(fmt.Sprintf("    eprintln!(\"{{\\\"output\\\": {}}}\", %s(&arg0));\n", params[0].toJSON))
		} else {
			sb.WriteString("    eprintln!(\"{{\\\"output\\\": null}}\");\n")
		}
	} else {
		sb.WriteString(fmt.Sprintf("    let output = sol.%s(", funcName))
		for i := range params {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(fmt.Sprintf("arg%d", i))
		}
		sb.WriteString(");\n")
		sb.WriteString(fmt.Sprintf("    eprintln!(\"{{\\\"output\\\": {}}}\", %s(&output));\n", returnToJSON))
	}

	return sb.String()
}

