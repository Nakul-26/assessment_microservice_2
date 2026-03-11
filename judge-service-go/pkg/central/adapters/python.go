package adapters

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"judge-service-go/pkg/models"
	"judge-service-go/pkg/workspace"
)

type PythonAdapter struct{}

func (PythonAdapter) Name() string {
	return "python"
}

func (PythonAdapter) PrepareFiles(workDir string, submissionMsg models.SubmissionMessage) ([]string, error) {
	tplPath := filepath.Join("pkg", "wrappers", "python_single_wrapper.tpl")
	return preparePythonWrapper(workDir, submissionMsg, tplPath)
}

func (PythonAdapter) PrepareBatchFiles(workDir string, submissionMsg models.SubmissionMessage) ([]string, error) {
	tplPath := filepath.Join("pkg", "wrappers", "python_batch_wrapper.tpl")
	return preparePythonWrapper(workDir, submissionMsg, tplPath)
}

func preparePythonWrapper(workDir string, submissionMsg models.SubmissionMessage, tplPath string) ([]string, error) {
	b, err := os.ReadFile(tplPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read template %s: %w", tplPath, err)
	}

	wrapperCode := string(b)
	wrapperCode = strings.ReplaceAll(wrapperCode, "{{FUNCTION_NAME}}", submissionMsg.FunctionName)
	wrapperCode = strings.Replace(wrapperCode, "# USER_CODE_MARKER", submissionMsg.Code, 1)

	if err := workspace.WriteFile(workDir, "wrapper.py", []byte(wrapperCode), 0644); err != nil {
		return nil, fmt.Errorf("failed to write wrapper.py: %w", err)
	}

	return []string{"wrapper.py"}, nil
}

func (PythonAdapter) RunCommand(inputB64 string) []string {
	return []string{"python", "/app/wrapper.py", inputB64}
}

func (PythonAdapter) BatchRunCommand(testsB64 string) []string {
	return []string{"python", "/app/wrapper.py", testsB64}
}
