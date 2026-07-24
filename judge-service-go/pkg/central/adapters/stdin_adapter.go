package adapters

import (
	"fmt"

	"judge-service-go/pkg/workspace"
)

// StdinLanguageAdapter isolates language-specific source preparation and
// execution for ProblemType: stdin (pkg/models/problem_type.go). Unlike
// LanguageAdapter, there is no generated wrapper — the user's program is
// written to disk as-is and reads its own input from stdin, so RunCommand
// takes no per-call argument (test input is piped in by
// executor.RunInContainerWithStdin instead).
type StdinLanguageAdapter interface {
	Name() string
	PrepareFiles(workDir string, code string) ([]string, error)
	RunCommand() []string
}

// CompilingStdinLanguageAdapter is implemented by stdin adapters whose
// language needs a compile step before RunCommand can execute.
type CompilingStdinLanguageAdapter interface {
	StdinLanguageAdapter
	CompileCommand() []string
}

// StdinAdapterRegistry mirrors AdapterRegistry's dispatch shape for the
// stdin problem model. Deliberately a smaller language set than
// AdapterRegistry for the MVP (see docs/arventiq-integration/TASKS.md
// Milestone 3) — languages not listed here return ok=false from
// GetStdinAdapter, which the stdin runner turns into a clean submission
// error rather than a panic.
var StdinAdapterRegistry = map[string]StdinLanguageAdapter{
	"python":     PythonStdinAdapter{},
	"javascript": JavaScriptStdinAdapter{},
	"cpp":        CppStdinAdapter{},
	"c":          CStdinAdapter{},
	"go":         GoStdinAdapter{},
}

func GetStdinAdapter(language string) (StdinLanguageAdapter, bool) {
	adapter, ok := StdinAdapterRegistry[language]
	return adapter, ok
}

type PythonStdinAdapter struct{}

func (PythonStdinAdapter) Name() string { return "python" }

func (PythonStdinAdapter) PrepareFiles(workDir string, code string) ([]string, error) {
	if err := workspace.WriteFile(workDir, "solution.py", []byte(code), 0644); err != nil {
		return nil, fmt.Errorf("failed to write solution.py: %w", err)
	}
	return []string{"solution.py"}, nil
}

func (PythonStdinAdapter) RunCommand() []string {
	return []string{"python", "/app/solution.py"}
}

type JavaScriptStdinAdapter struct{}

func (JavaScriptStdinAdapter) Name() string { return "javascript" }

func (JavaScriptStdinAdapter) PrepareFiles(workDir string, code string) ([]string, error) {
	if err := workspace.WriteFile(workDir, "solution.js", []byte(code), 0644); err != nil {
		return nil, fmt.Errorf("failed to write solution.js: %w", err)
	}
	return []string{"solution.js"}, nil
}

func (JavaScriptStdinAdapter) RunCommand() []string {
	return []string{"node", "/app/solution.js"}
}

type CppStdinAdapter struct{}

func (CppStdinAdapter) Name() string { return "cpp" }

func (CppStdinAdapter) PrepareFiles(workDir string, code string) ([]string, error) {
	if err := workspace.WriteFile(workDir, "main.cpp", []byte(code), 0644); err != nil {
		return nil, fmt.Errorf("failed to write main.cpp: %w", err)
	}
	return []string{"main.cpp"}, nil
}

func (CppStdinAdapter) CompileCommand() []string {
	return []string{"g++", "-O2", "-o", "/app/main", "/app/main.cpp"}
}

func (CppStdinAdapter) RunCommand() []string {
	return []string{"/app/main"}
}

type CStdinAdapter struct{}

func (CStdinAdapter) Name() string { return "c" }

func (CStdinAdapter) PrepareFiles(workDir string, code string) ([]string, error) {
	if err := workspace.WriteFile(workDir, "main.c", []byte(code), 0644); err != nil {
		return nil, fmt.Errorf("failed to write main.c: %w", err)
	}
	return []string{"main.c"}, nil
}

func (CStdinAdapter) CompileCommand() []string {
	return []string{"gcc", "-O2", "-o", "/app/main", "/app/main.c", "-lm"}
}

func (CStdinAdapter) RunCommand() []string {
	return []string{"/app/main"}
}

type GoStdinAdapter struct{}

func (GoStdinAdapter) Name() string { return "go" }

func (GoStdinAdapter) PrepareFiles(workDir string, code string) ([]string, error) {
	if err := workspace.WriteFile(workDir, "main.go", []byte(code), 0644); err != nil {
		return nil, fmt.Errorf("failed to write main.go: %w", err)
	}
	return []string{"main.go"}, nil
}

func (GoStdinAdapter) CompileCommand() []string {
	return []string{"sh", "-c", "go mod init solution 2>/dev/null || true; go build -o main ."}
}

func (GoStdinAdapter) RunCommand() []string {
	return []string{"./main"}
}
