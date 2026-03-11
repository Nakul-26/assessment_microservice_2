package adapters

import "judge-service-go/pkg/models"

// LanguageAdapter isolates language-specific single-test wrapper preparation and execution.
type LanguageAdapter interface {
	Name() string
	PrepareFiles(workDir string, submissionMsg models.SubmissionMessage) ([]string, error)
	RunCommand(inputB64 string) []string
}

type BatchLanguageAdapter interface {
	LanguageAdapter
	PrepareBatchFiles(workDir string, submissionMsg models.SubmissionMessage) ([]string, error)
	BatchRunCommand(testsB64 string) []string
}

var AdapterRegistry = map[string]LanguageAdapter{
	"python":     PythonAdapter{},
	"javascript": JavaScriptAdapter{},
}

func GetAdapter(language string) (LanguageAdapter, bool) {
	adapter, ok := AdapterRegistry[language]
	return adapter, ok
}
