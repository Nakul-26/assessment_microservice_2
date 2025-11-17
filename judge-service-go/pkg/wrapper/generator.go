package wrapper

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"judge-service-go/pkg/languages"
	"judge-service-go/pkg/models"
)

func GenerateWrapper(p models.Problem, lang languages.Language) (string, error) {
	tplPath := filepath.Join("pkg", "wrappers", lang.WrapperTemplate)
	b, err := os.ReadFile(tplPath)
	if err != nil {
		return "", fmt.Errorf("failed to read template %s: %w", tplPath, err)
	}
	tpl := string(b)

	// Replace generic placeholders
	functionName := p.ExpectedIoType.FunctionName
	if functionName == "" {
		// Fallback to functionDefinitions if ExpectedIoType.FunctionName is not set
		if def, ok := p.FunctionDefinitions[lang.ID]; ok {
			functionName = def.Name
		}
	}
	tpl = strings.ReplaceAll(tpl, "{{FUNCTION_NAME}}", functionName)
	tpl = strings.ReplaceAll(tpl, "{{EXPECTED_OUTPUT_TYPE}}", p.ExpectedIoType.ReturnType)
	tpl = strings.ReplaceAll(tpl, "{{TESTS_JSON}}", string(p.TestsJSON)) // assume TestsJSON is []byte or string

	// Java-specific logic
	if lang.ID == "java" {
		functionCallLine, err := generateJavaFunctionCall(p)
		if err != nil {
			return "", fmt.Errorf("failed to generate Java function call: %w", err)
		}
		tpl = strings.Replace(tpl, "{{FUNCTION_CALL_LINE}}", functionCallLine, 1)
	}

	return tpl, nil
}

func generateJavaFunctionCall(p models.Problem) (string, error) {
	if len(p.ExpectedIoType.InputParameters) == 0 {
		// Handle cases with no input parameters or problems without defined IO types
		return "new {{CLASS_NAME}}().{{FUNCTION_NAME}}()", nil
	}

	var args []string
	for i, param := range p.ExpectedIoType.InputParameters {
		javaType := toJavaType(param.Type)
		if strings.HasPrefix(javaType, "ListNode") {
			args = append(args, fmt.Sprintf("gson.fromJson(inputArgs.get(%d), %s.class)", i, "ListNode"))
		} else if strings.HasPrefix(javaType, "TreeNode") {
			args = append(args, fmt.Sprintf("gson.fromJson(inputArgs.get(%d), %s.class)", i, "TreeNode"))
		} else {
			args = append(args, fmt.Sprintf("gson.fromJson(inputArgs.get(%d), %s.class)", i, javaType))
		}
	}

	// The class name and function name will be replaced in main.go
	return fmt.Sprintf("new {{CLASS_NAME}}().{{FUNCTION_NAME}}(%s)", strings.Join(args, ", ")), nil
}

func toJavaType(jsonType string) string {
	switch jsonType {
	case "int":
		return "Integer"
	case "String":
		return "String"
	case "int[]":
		return "int[]"
	case "String[]":
		return "String[]"
	case "boolean":
		return "Boolean"
	case "double":
		return "Double"
	case "ListNode":
		return "ListNode"
	case "TreeNode":
		return "TreeNode"
	default:
		// Capitalize first letter for class types
		return strings.ToUpper(string(jsonType[0])) + jsonType[1:]
	}
}