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
		Image:          "judge-js-env",
		RunCmd:         []string{"node", "/app/wrapper.js"},
		WrapperTemplate: "js_wrapper.tpl",
	},
	"python": {
		ID:              "python",
		Name:            "Python",
		FileExt:         ".py",
		Image:           "judge-py-env",
		RunCmd:          []string{"python", "/app/wrapper.py"},
		WrapperTemplate: "python_wrapper.tpl",
	},
	"java": {
		ID:              "java",
		Name:            "Java",
		FileExt:         ".java",
					Image:           "judge-java-env",
		CompileCmd:      []string{"javac", "/app/GeneratedTester.java"},
					RunCmd:          []string{"java", "-Xmx256m", "-cp", "/app", "GeneratedTester"},		WrapperTemplate: "java_wrapper.tpl",
	},
	"c": {
		ID:              "c",
		Name:            "C",
		FileExt:         ".c",
		Image:           "judge-c-env",
		CompileCmd:      []string{"gcc", "-o", "/app/main", "/app/main.c"},
		RunCmd:          []string{"/app/main"},
		WrapperTemplate: "c_wrapper.tpl",
	},
	"csharp": {
		ID:              "csharp",
		Name:            "C#",
		FileExt:         ".cs",
		Image:           "judge-csharp-env",
		CompileCmd:      []string{"mcs", "-out:/app/main.exe", "/app/main.cs"},
		RunCmd:          []string{"mono", "/app/main.exe"},
		WrapperTemplate: "csharp_wrapper.tpl",
	},
}