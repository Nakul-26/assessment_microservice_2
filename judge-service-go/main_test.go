package main

import (
	"bufio"
	"errors"
	"strings"
	"testing"
	"time"

	"judge-service-go/pkg/models"
)

func TestParseSingleTestOutput_ValidJSON(t *testing.T) {
	out, err := parseSingleTestOutput(`{"output":[1,2]}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Output == nil {
		t.Fatalf("expected output to be present")
	}
}

func TestParseSingleTestOutput_LastLineFallback(t *testing.T) {
	out, err := parseSingleTestOutput("hello\n{\"output\":42}\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Output == nil {
		t.Fatalf("expected parsed output from last line")
	}
}

func TestParseSingleTestOutput_Invalid(t *testing.T) {
	_, err := parseSingleTestOutput("not-json")
	if err == nil {
		t.Fatalf("expected parse error")
	}
}

func TestPerTestTimeout_DefaultAndProblemValue(t *testing.T) {
	if got := perTestTimeout(models.Problem{}); got != defaultSandboxTimeout {
		t.Fatalf("expected default timeout %v, got %v", defaultSandboxTimeout, got)
	}

	problem := models.Problem{TimeLimitMs: 1500}
	if got := perTestTimeout(problem); got != 1500*time.Millisecond {
		t.Fatalf("expected 1500ms timeout, got %v", got)
	}
}

func TestReadBoundedLineRejectsOversizedLine(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader("123456\n"))
	_, err := readBoundedLine(reader, 4)
	if !errors.Is(err, errBatchedOutputLimitExceeded) {
		t.Fatalf("expected output limit error, got %v", err)
	}
}

func TestAppendBatchedResultsParsesJSONLines(t *testing.T) {
	result := models.NewSubmissionResult()
	problem := models.Problem{
		TestCases: []models.TestCase{
			{Expected: float64(3)},
			{Expected: float64(5)},
		},
		CompareConfig: models.CompareConfig{Mode: "EXACT"},
	}

	stdout := "{\"test\":1,\"output\":3}\n{\"test\":2,\"error\":\"boom\"}\n"
	processed, err := appendBatchedResults(result, stdout, problem)
	if err != nil {
		t.Fatalf("appendBatchedResults failed: %v", err)
	}
	if processed != 2 {
		t.Fatalf("expected 2 processed tests, got %d", processed)
	}
	if result.Passed != 1 || result.Total != 2 {
		t.Fatalf("unexpected totals: passed=%d total=%d", result.Passed, result.Total)
	}
	if result.Details[1].Error != "Runtime Error" {
		t.Fatalf("expected runtime error for second test, got %+v", result.Details[1])
	}
}

func TestAppendMissingBatchedResultsMarksRemainingFailed(t *testing.T) {
	result := models.NewSubmissionResult()
	result.AddTestResult(models.TestResult{Test: 1, Ok: true})

	problem := models.Problem{
		TestCases: []models.TestCase{
			{Expected: float64(3)},
			{Expected: float64(5)},
			{Expected: float64(8)},
		},
	}

	appendMissingBatchedResults(result, problem, 1, "Runtime Error")
	if result.Total != 3 {
		t.Fatalf("expected 3 total tests, got %d", result.Total)
	}
	if result.Details[1].Error != "Runtime Error" || result.Details[2].Error != "Runtime Error" {
		t.Fatalf("expected remaining tests marked failed, got %+v", result.Details)
	}
}
