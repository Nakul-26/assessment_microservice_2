package models

import (
	"encoding/json"
	"time"
)

// TestResult represents the result of a single test case.
type TestResult struct {
	Test       int         `json:"test"`                 // test index (0-based)
	Ok         bool        `json:"ok"`                   // whether test passed
	Output     interface{} `json:"output,omitempty"`     // actual output returned by user code
	Expected   interface{} `json:"expected,omitempty"`   // expected output (useful for UI diffs)
	Error      string      `json:"error,omitempty"`      // short error message, if any
	Stack      string      `json:"stack,omitempty"`      // optional stack trace (for languages that produce it)
	Traceback  string      `json:"traceback,omitempty"`  // python-style traceback or similar
	Stdout     string      `json:"stdout,omitempty"`     // captured stdout for this test
	Stderr     string      `json:"stderr,omitempty"`     // captured stderr for this test
	ExitCode   int         `json:"exitCode,omitempty"`   // process exit code (if applicable)
	DurationMs int64       `json:"durationMs,omitempty"` // time taken for this test in milliseconds
	MemoryKB   int64       `json:"memoryKb,omitempty"`   // memory used (best-effort)
	// Extra fields can be added as needed, but keep them small to avoid huge JSON payloads.
}

// SubmissionResult represents the overall result of a submission.
type SubmissionResult struct {
	Status     string       `json:"status"`               // finished / error / success / fail
	Passed     int          `json:"passed"`               // number of tests passed
	Total      int          `json:"total"`                // total tests executed
	Details    []TestResult `json:"details,omitempty"`    // per-test details
	Stdout     string       `json:"stdout,omitempty"`     // aggregated stdout (if any)
	Stderr     string       `json:"stderr,omitempty"`     // aggregated stderr (if any)
	StartedAt  *time.Time   `json:"startedAt,omitempty"`  // optional timestamps
	FinishedAt *time.Time   `json:"finishedAt,omitempty"`
	ElapsedMs  int64        `json:"elapsedMs,omitempty"`  // total elapsed time for submission
}

// NewSubmissionResult creates a new, empty SubmissionResult with a default status.
func NewSubmissionResult() *SubmissionResult {
	return &SubmissionResult{
		Status:  StatusFinished,
		Passed:  0,
		Total:   0,
		Details: make([]TestResult, 0),
	}
}

// AddTestResult appends a TestResult and updates Passed/Total counters.
// Use this to avoid off-by-one issues when building results.
func (sr *SubmissionResult) AddTestResult(tr TestResult) {
	sr.Details = append(sr.Details, tr)
	sr.Total++
	if tr.Ok {
		sr.Passed++
	}
}

// ToJSON returns the JSON encoding (useful for logging or returning to caller).
func (sr *SubmissionResult) ToJSON() ([]byte, error) {
	return json.Marshal(sr)
}