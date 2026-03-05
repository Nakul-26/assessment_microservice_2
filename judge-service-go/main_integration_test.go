//go:build integration

package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"judge-service-go/pkg/executor"
	"judge-service-go/pkg/languages"
	"judge-service-go/pkg/models"
	"judge-service-go/pkg/pool"
)

func setupPythonIntegration(t *testing.T) (*executor.Executor, *pool.ContainerPool, *pool.PooledContainer, *languages.Language) {
	t.Helper()

	exec, err := executor.NewExecutor()
	if err != nil {
		t.Skipf("docker client unavailable: %v", err)
	}

	lang := languages.GetLanguage("python")
	if lang == nil {
		t.Fatal("python language config not found")
	}

	p := pool.NewPool(exec.Client(), 1)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := p.WarmUp(ctx, lang.ID, lang.Image, 1); err != nil {
		t.Skipf("python container warm-up failed (is %q image available?): %v", lang.Image, err)
	}

	pc := p.Acquire(lang.ID)
	if pc == nil {
		t.Fatal("failed to acquire pooled python container")
	}

	t.Cleanup(func() {
		p.Release(pc)
	})

	return exec, p, pc, lang
}

func oneTestProblem() models.Problem {
	return models.Problem{
		Title:        "Two Sum",
		Description:  "integration test",
		FunctionName: "two_sum",
		ReturnType:   "array",
		TestCases: []models.TestCase{
			{
				Input:    []interface{}{[]interface{}{float64(2), float64(7), float64(11), float64(15)}, float64(9)},
				Expected: []interface{}{int64(0), int64(1)},
			},
		},
		CompareConfig: models.CompareConfig{Mode: "EXACT"},
	}
}

func runCentralOnce(t *testing.T, exec *executor.Executor, pc *pool.PooledContainer, lang *languages.Language, problem models.Problem, code string) *models.SubmissionResult {
	t.Helper()

	msg := models.SubmissionMessage{
		SubmissionID: "integration-test",
		ProblemID:    "integration-problem",
		Language:     "python",
		FunctionName: "two_sum",
		Code:         code,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	result, err := runSubmissionCentralPython(ctx, exec, pc, lang, msg, problem)
	if err != nil {
		t.Fatalf("runSubmissionCentralPython failed: %v", err)
	}
	if result == nil {
		t.Fatal("nil result")
	}
	return result
}

func TestCentralPythonIntegration_CorrectSolution(t *testing.T) {
	exec, _, pc, lang := setupPythonIntegration(t)
	problem := oneTestProblem()
	code := `
def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        want = target - n
        if want in seen:
            return [seen[want], i]
        seen[n] = i
    return []
`

	result := runCentralOnce(t, exec, pc, lang, problem, code)
	if result.Passed != result.Total || result.Total != 1 {
		t.Fatalf("expected pass 1/1, got %d/%d detail=%+v", result.Passed, result.Total, result.Details)
	}
	if !result.Details[0].Ok {
		t.Fatalf("expected test to pass, detail=%+v", result.Details[0])
	}
}

func TestCentralPythonIntegration_WrongAnswer(t *testing.T) {
	exec, _, pc, lang := setupPythonIntegration(t)
	problem := oneTestProblem()
	code := `
def two_sum(nums, target):
    return [0, 2]
`

	result := runCentralOnce(t, exec, pc, lang, problem, code)
	if result.Passed != 0 || result.Total != 1 {
		t.Fatalf("expected pass 0/1, got %d/%d", result.Passed, result.Total)
	}
	if result.Details[0].Ok {
		t.Fatalf("expected test to fail, detail=%+v", result.Details[0])
	}
}

func TestCentralPythonIntegration_RuntimeError(t *testing.T) {
	exec, _, pc, lang := setupPythonIntegration(t)
	problem := oneTestProblem()
	code := `
def two_sum(nums, target):
    return 1 / 0
`

	result := runCentralOnce(t, exec, pc, lang, problem, code)
	if result.Details[0].Error != "Runtime Error" {
		t.Fatalf("expected Runtime Error, got %q", result.Details[0].Error)
	}
}

func TestCentralPythonIntegration_TimeLimitExceeded(t *testing.T) {
	exec, _, pc, lang := setupPythonIntegration(t)
	problem := oneTestProblem()
	problem.TimeLimitMs = 100
	code := `
def two_sum(nums, target):
    while True:
        pass
`

	result := runCentralOnce(t, exec, pc, lang, problem, code)
	if result.Details[0].Error != "Time Limit Exceeded" {
		t.Fatalf("expected Time Limit Exceeded, got %q detail=%+v", result.Details[0].Error, result.Details[0])
	}
}

func TestCentralPythonIntegration_OutputLimitExceeded(t *testing.T) {
	exec, _, pc, lang := setupPythonIntegration(t)
	problem := oneTestProblem()
	code := `
def two_sum(nums, target):
    print("A" * 100000)
    return [0, 1]
`

	result := runCentralOnce(t, exec, pc, lang, problem, code)
	if result.Details[0].Error != "Output Limit Exceeded" {
		t.Fatalf("expected Output Limit Exceeded, got %q detail=%+v", result.Details[0].Error, result.Details[0])
	}
	if !strings.Contains(result.Details[0].Stdout, "A") {
		t.Fatalf("expected captured stdout to contain user output")
	}
}
