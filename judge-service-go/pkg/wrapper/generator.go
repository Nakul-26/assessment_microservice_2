package wrapper

import (

	"fmt"
	"os"
	"path/filepath"


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





	return tpl, nil
}

