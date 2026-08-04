package adapters

import "judge-service-go/pkg/models"

// LanguageAdapter isolates language-specific single-test wrapper preparation and execution.
type LanguageAdapter interface {
	Name() string
	PrepareFiles(workDir string, submissionMsg models.SubmissionMessage, problem models.Problem) ([]string, error)
	RunCommand(inputB64 string) []string
}

type CompilingLanguageAdapter interface {
	LanguageAdapter
	CompileCommand() []string
}

type BatchLanguageAdapter interface {
	LanguageAdapter
	PrepareBatchFiles(workDir string, submissionMsg models.SubmissionMessage, problem models.Problem) ([]string, error)
	BatchRunCommand(testsB64 string) []string
}

var AdapterRegistry = map[string]LanguageAdapter{
	"python":     PythonAdapter{},
	"javascript": JavaScriptAdapter{},
	"java":       JavaAdapter{},
	"cpp":        CppAdapter{},
	"go":         GoAdapter{},
	"c":          CAdapter{},
	"csharp":     CSharpAdapter{},
	"typescript": TypeScriptAdapter{},
	"rust":       RustAdapter{},
	"ruby":       RubyAdapter{},
	"php":        PHPAdapter{},
	"kotlin":     KotlinAdapter{},
}

func GetAdapter(language string) (LanguageAdapter, bool) {
	adapter, ok := AdapterRegistry[language]
	return adapter, ok
}
