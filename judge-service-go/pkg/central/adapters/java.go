package adapters

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"judge-service-go/pkg/models"
	"judge-service-go/pkg/workspace"
)

type JavaAdapter struct{}

func (JavaAdapter) Name() string {
	return "java"
}

func (JavaAdapter) PrepareFiles(workDir string, submissionMsg models.SubmissionMessage) ([]string, error) {
	tplPath := filepath.Join("pkg", "wrappers", "java_single_wrapper.tpl")
	return prepareJavaWrapper(workDir, submissionMsg, tplPath)
}

func (JavaAdapter) PrepareBatchFiles(workDir string, submissionMsg models.SubmissionMessage) ([]string, error) {
	tplPath := filepath.Join("pkg", "wrappers", "java_batch_wrapper.tpl")
	return prepareJavaWrapper(workDir, submissionMsg, tplPath)
}

func prepareJavaWrapper(workDir string, submissionMsg models.SubmissionMessage, tplPath string) ([]string, error) {
	b, err := os.ReadFile(tplPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read template %s: %w", tplPath, err)
	}

	wrapperCode := strings.ReplaceAll(string(b), "{{FUNCTION_NAME}}", submissionMsg.FunctionName)

	if err := workspace.WriteFile(workDir, "Solution.java", []byte(submissionMsg.Code), 0644); err != nil {
		return nil, fmt.Errorf("failed to write Solution.java: %w", err)
	}
	if err := workspace.WriteFile(workDir, "Main.java", []byte(wrapperCode), 0644); err != nil {
		return nil, fmt.Errorf("failed to write Main.java: %w", err)
	}

	return []string{"Solution.java", "Main.java"}, nil
}

func (JavaAdapter) CompileCommand() []string {
	return []string{"javac", "-cp", "/usr/share/java/gson.jar:.", "/app/Solution.java", "/app/Main.java"}
}

func (JavaAdapter) RunCommand(inputB64 string) []string {
	return []string{"java", "-cp", "/usr/share/java/gson.jar:.", "Main", inputB64}
}

func (JavaAdapter) BatchRunCommand(testsB64 string) []string {
	return []string{"java", "-cp", "/usr/share/java/gson.jar:.", "Main", testsB64}
}
