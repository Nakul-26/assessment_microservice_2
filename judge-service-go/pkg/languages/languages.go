package languages

type Language struct {
	ID             string
	Name           string
	FileExt        string
	Image          string
	CompileCmd     []string // Optional compile command
	RunCmd         []string   // Actual command to run
	WrapperTemplate string
}

var Languages = map[string]Language{
	"javascript": {
		ID:             "javascript",
		Name:           "JavaScript",
		FileExt:        ".js",
		Image:          "node:20-alpine",
		RunCmd:         []string{"node", "/app/submission.js"},
		WrapperTemplate: "js_wrapper.tpl",
	},
	"python": {
		ID:             "python",
		Name:           "Python",
		FileExt:        ".py",
		Image:          "python:3.10-alpine",
		RunCmd:         []string{"python", "/app/submission.py"},
		WrapperTemplate: "python_wrapper.tpl",
	},
	"java": {
		ID:             "java",
		Name:           "Java",
		FileExt:        ".java",
		Image:          "openjdk:17-jdk-alpine",
		CompileCmd:     []string{"javac", "/app/submission.java"},
		RunCmd:         []string{"java", "-cp", "/app", "Main"},
		WrapperTemplate: "java_wrapper.tpl",
	},
}