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
		return "{{CLASS_NAME}}.{{FUNCTION_NAME}}()", nil
	}

	var args []string
	for i, param := range p.ExpectedIoType.InputParameters {
		switch param.Type {
		case "int":
			args = append(args, fmt.Sprintf("gson.fromJson(inputArgs.get(%d), Integer.class)", i))
		case "String":
			args = append(args, fmt.Sprintf("gson.fromJson(inputArgs.get(%d), String.class)", i))
		case "int[]":
			args = append(args, fmt.Sprintf("gson.fromJson(inputArgs.get(%d), int[].class)", i))
		case "String[]":
			args = append(args, fmt.Sprintf("gson.fromJson(inputArgs.get(%d), String[].class)", i))
		case "boolean":
			args = append(args, fmt.Sprintf("gson.fromJson(inputArgs.get(%d), Boolean.class)", i))
		case "double":
			args = append(args, fmt.Sprintf("gson.fromJson(inputArgs.get(%d), Double.class)", i))
		// Add more types as needed
		default:
			return "", fmt.Errorf("unsupported Java input type: %s", param.Type)
		}
	}

	// The class name and function name will be replaced in main.go
	return fmt.Sprintf("{{CLASS_NAME}}.{{FUNCTION_NAME}}(%s)", strings.Join(args, ", ")), nil
}
