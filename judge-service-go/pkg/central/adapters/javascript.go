package adapters

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"judge-service-go/pkg/models"
	"judge-service-go/pkg/workspace"
)

type JavaScriptAdapter struct{}

func (JavaScriptAdapter) Name() string {
	return "javascript"
}

func (JavaScriptAdapter) PrepareFiles(workDir string, submissionMsg models.SubmissionMessage) ([]string, error) {
	tplPath := filepath.Join("pkg", "wrappers", "js_single_wrapper.tpl")
	b, err := os.ReadFile(tplPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read template %s: %w", tplPath, err)
	}

	wrapperCode := string(b)
	wrapperCode = strings.ReplaceAll(wrapperCode, "{{FUNCTION_NAME}}", submissionMsg.FunctionName)
	wrapperCode = strings.Replace(wrapperCode, "// USER_CODE_MARKER", submissionMsg.Code, 1)

	if err := workspace.WriteFile(workDir, "wrapper.js", []byte(wrapperCode), 0644); err != nil {
		return nil, fmt.Errorf("failed to write wrapper.js: %w", err)
	}

	return []string{"wrapper.js"}, nil
}

func (JavaScriptAdapter) RunCommand(inputB64 string) []string {
	return []string{"node", "/app/wrapper.js", inputB64}
}
