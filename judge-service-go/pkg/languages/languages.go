package languages

// Language describes how to compile/run code for a language and which wrapper template to use.
type Language struct {
	ID              string   // short id (key in the map)
	Name            string   // human friendly name
	FileExt         string   // file extension including leading dot (e.g. ".java")
	Image           string   // docker image name used to run/compile
	CompileCmd      []string // optional compile command (executed inside container)
	RunCmd          []string // command used to run the program/test harness
	WrapperTemplate string   // template file name (relative to wrapper/templates or configured path)
}

// Languages defines supported languages. The WrapperTemplate is assumed to be located
// in the wrapper package template directory (e.g. pkg/wrapper/templates/<name>).
var Languages = map[string]*Language{
	"javascript": {
		ID:              "javascript",
		Name:            "JavaScript",
		FileExt:         ".js",
		Image:           "judge-js-env",
		RunCmd:          []string{"node", "/app/wrapper.js"},
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
		ID:   "java",
		Name: "Java",
		// User submissions are written to Solution.java and wrapper to GeneratedTester.java
		FileExt: ".java",
		Image:   "judge-java-env",
		// Compile both the user file (Solution.java) and the harness (GeneratedTester.java)
		// NOTE: avoid globbing like /app/*.java if your exec doesn't expand globs.
		CompileCmd:      []string{"javac", "/app/Solution.java", "/app/GeneratedTester.java"},
		RunCmd:          []string{"java", "-Xmx256m", "-cp", "/app", "GeneratedTester"},
		WrapperTemplate: "java_wrapper.tpl",
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

// GetLanguage returns a pointer to the Language configuration for the given id.
// It returns nil if the language is not found.
func GetLanguage(id string) *Language {
	if l, ok := Languages[id]; ok {
		return l
	}
	return nil
}
