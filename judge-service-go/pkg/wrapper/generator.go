package wrapper

import (
	"encoding/json"
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

	// Marshal test cases to JSON
	testsJSON, err := json.Marshal(p.TestCases)
	if err != nil {
		return "", fmt.Errorf("failed to marshal test cases to JSON: %w", err)
	}
	tpl = strings.ReplaceAll(tpl, "{{TESTS_JSON}}", string(testsJSON))

	// Determine function/class name placeholders
	fnName := "solution" // default
	if p.FunctionName != nil {
		// pick entry for language if present
		if n, ok := p.FunctionName[lang.ID]; ok && n != "" {
			fnName = n
		}
	}

	// Replace placeholders
	tpl = strings.ReplaceAll(tpl, "{{FUNCTION_NAME}}", fnName)
	// For Java templates
	className := "Main"
	if p.FunctionSignature.Language == "java" {
		className = strings.TrimSuffix(fnName, "")
	}
	tpl = strings.ReplaceAll(tpl, "{{CLASS_NAME}}", className)

	return tpl, nil
}

