package main

import (
	"bufio"
	"encoding/json"
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
	processed, err := appendBatchedResults(result, strings.NewReader(stdout), problem)
	if err != nil {
		t.Fatalf("appendBatchedResults failed: %v", err)
	}
	if processed != 2 {
		t.Fatalf("expected 2 processed tests, got %d", processed)
	}
	if result.Passed != 1 || result.Total != 2 {
		t.Fatalf("unexpected totals: passed=%d total=%d", result.Passed, result.Total)
	}
	if result.PassedCount != 1 || result.TotalCount != 2 {
		t.Fatalf("unexpected count aliases: passedCount=%d totalCount=%d", result.PassedCount, result.TotalCount)
	}
	if result.FirstFailedTest != 2 {
		t.Fatalf("expected first failed test 2, got %d", result.FirstFailedTest)
	}
	if result.Details[1].Error != "Runtime Error" {
		t.Fatalf("expected runtime error for second test, got %+v", result.Details[1])
	}
	if result.Status != models.SubmissionStatusRuntimeError {
		t.Fatalf("expected overall status %q, got %q", models.SubmissionStatusRuntimeError, result.Status)
	}
	if result.Details[0].TimeMs < 0 || result.Details[1].TimeMs < 0 {
		t.Fatalf("expected non-negative timeMs for batched tests, got %+v", result.Details)
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
	if result.FirstFailedTest != 2 {
		t.Fatalf("expected first failed test 2, got %d", result.FirstFailedTest)
	}
}

func TestTestResultJSONIncludesTimeMsWhenZero(t *testing.T) {
	payload, err := json.Marshal(models.TestResult{Test: 1, Ok: true, TimeMs: 0})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	if !strings.Contains(string(payload), "\"timeMs\":0") {
		t.Fatalf("expected timeMs in json payload, got %s", payload)
	}
}

func TestSubmissionResultJSONIncludesCountAliases(t *testing.T) {
	result := models.NewSubmissionResult()
	result.AddTestResult(models.TestResult{Test: 1, Ok: true})
	result.AddTestResult(models.TestResult{Test: 2, Ok: false})

	payload, err := result.ToJSON()
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	jsonStr := string(payload)
	if !strings.Contains(jsonStr, "\"passedCount\":1") {
		t.Fatalf("expected passedCount in json payload, got %s", jsonStr)
	}
	if !strings.Contains(jsonStr, "\"totalCount\":2") {
		t.Fatalf("expected totalCount in json payload, got %s", jsonStr)
	}
	if !strings.Contains(jsonStr, "\"firstFailedTest\":2") {
		t.Fatalf("expected firstFailedTest in json payload, got %s", jsonStr)
	}
	if !strings.Contains(jsonStr, "\"status\":\"Wrong Answer\"") {
		t.Fatalf("expected Wrong Answer status in json payload, got %s", jsonStr)
	}
}

func TestSubmissionResultUpdateStatusPriority(t *testing.T) {
	tests := []struct {
		name            string
		details         []models.TestResult
		want            string
		wantFirstFailed int
	}{
		{
			name: "accepted",
			details: []models.TestResult{
				{Test: 1, Ok: true},
				{Test: 2, Ok: true},
			},
			want:            models.SubmissionStatusAccepted,
			wantFirstFailed: -1,
		},
		{
			name: "wrong answer",
			details: []models.TestResult{
				{Test: 1, Ok: true},
				{Test: 2, Ok: false},
			},
			want:            models.SubmissionStatusWrongAnswer,
			wantFirstFailed: 2,
		},
		{
			name: "runtime error overrides wrong answer",
			details: []models.TestResult{
				{Test: 1, Ok: false},
				{Test: 2, Ok: false, Error: models.SubmissionStatusRuntimeError},
			},
			want:            models.SubmissionStatusRuntimeError,
			wantFirstFailed: 1,
		},
		{
			name: "timeout overrides runtime error",
			details: []models.TestResult{
				{Test: 1, Ok: false, Error: models.SubmissionStatusRuntimeError},
				{Test: 2, Ok: false, Error: models.SubmissionStatusTimeLimitExceeded},
			},
			want:            models.SubmissionStatusTimeLimitExceeded,
			wantFirstFailed: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := models.NewSubmissionResult()
			for _, detail := range tt.details {
				result.AddTestResult(detail)
			}
			if result.Status != tt.want {
				t.Fatalf("expected status %q, got %q", tt.want, result.Status)
			}
			if result.FirstFailedTest != tt.wantFirstFailed {
				t.Fatalf("expected firstFailedTest %d, got %d", tt.wantFirstFailed, result.FirstFailedTest)
			}
		})
	}
}

func TestSubmissionResultUnmarshalBackfillsCountAliases(t *testing.T) {
	var result models.SubmissionResult
	if err := json.Unmarshal([]byte(`{"status":"finished","passed":2,"total":3}`), &result); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if result.PassedCount != 2 || result.TotalCount != 3 {
		t.Fatalf("expected count aliases from legacy fields, got passedCount=%d totalCount=%d", result.PassedCount, result.TotalCount)
	}
	if result.FirstFailedTest != -1 {
		t.Fatalf("expected firstFailedTest default -1 for no details, got %d", result.FirstFailedTest)
	}

	var aliasOnly models.SubmissionResult
	if err := json.Unmarshal([]byte(`{"status":"finished","passedCount":4,"totalCount":5}`), &aliasOnly); err != nil {
		t.Fatalf("unmarshal alias-only failed: %v", err)
	}
	if aliasOnly.Passed != 4 || aliasOnly.Total != 5 {
		t.Fatalf("expected legacy fields backfilled from aliases, got passed=%d total=%d", aliasOnly.Passed, aliasOnly.Total)
	}
	if aliasOnly.FirstFailedTest != -1 {
		t.Fatalf("expected firstFailedTest default -1 for alias-only payload, got %d", aliasOnly.FirstFailedTest)
	}
}

func TestSubmissionResultNormalizeCountsDerivesFirstFailedFromDetails(t *testing.T) {
	result := models.SubmissionResult{
		Status: models.SubmissionStatusAccepted,
		Details: []models.TestResult{
			{Ok: true},
			{Ok: false},
			{Test: 3, Ok: false},
		},
	}

	result.NormalizeCounts()

	if result.FirstFailedTest != 2 {
		t.Fatalf("expected first failed fallback index 2, got %d", result.FirstFailedTest)
	}
}
