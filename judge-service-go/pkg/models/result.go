package models

import (
	"encoding/json"
	"time"
)

const (
	SubmissionStatusAccepted          = "Accepted"
	SubmissionStatusWrongAnswer       = "Wrong Answer"
	SubmissionStatusRuntimeError      = "Runtime Error"
	SubmissionStatusTimeLimitExceeded = "Time Limit Exceeded"
)

// TestResult represents the result of a single test case.
type TestResult struct {
	Test      int         `json:"test"`                // test index (0-based)
	Ok        bool        `json:"ok"`                  // whether test passed
	Output    interface{} `json:"output,omitempty"`    // actual output returned by user code
	Expected  interface{} `json:"expected,omitempty"`  // expected output (useful for UI diffs)
	Error     string      `json:"error,omitempty"`     // short error message, if any
	Stack     string      `json:"stack,omitempty"`     // optional stack trace (for languages that produce it)
	Traceback string      `json:"traceback,omitempty"` // python-style traceback or similar
	Stdout    string      `json:"stdout,omitempty"`    // captured stdout for this test
	Stderr    string      `json:"stderr,omitempty"`    // captured stderr for this test
	ExitCode  int         `json:"exitCode,omitempty"`  // process exit code (if applicable)
	TimeMs    int64       `json:"timeMs"`              // time taken for this test in milliseconds
	MemoryKB  int64       `json:"memoryKb,omitempty"`  // memory used (best-effort)
	// Extra fields can be added as needed, but keep them small to avoid huge JSON payloads.
}

// SubmissionResult represents the overall result of a submission.
type SubmissionResult struct {
	Status      string       `json:"status"`              // Accepted / Wrong Answer / Runtime Error / Time Limit Exceeded
	Passed      int          `json:"passed"`              // number of tests passed
	PassedCount int          `json:"passedCount"`         // alias for UI-facing pass count
	Total       int          `json:"total"`               // total tests executed
	TotalCount  int          `json:"totalCount"`          // alias for UI-facing total count
	Details     []TestResult `json:"details,omitempty"`   // per-test details
	Stdout      string       `json:"stdout,omitempty"`    // aggregated stdout (if any)
	Stderr      string       `json:"stderr,omitempty"`    // aggregated stderr (if any)
	StartedAt   *time.Time   `json:"startedAt,omitempty"` // optional timestamps
	FinishedAt  *time.Time   `json:"finishedAt,omitempty"`
	ElapsedMs   int64        `json:"elapsedMs,omitempty"` // total elapsed time for submission
}

// NewSubmissionResult creates a new, empty SubmissionResult with a default status.
func NewSubmissionResult() *SubmissionResult {
	return &SubmissionResult{
		Status:      SubmissionStatusAccepted,
		Passed:      0,
		PassedCount: 0,
		Total:       0,
		TotalCount:  0,
		Details:     make([]TestResult, 0),
	}
}

// AddTestResult appends a TestResult and updates Passed/Total counters.
// Use this to avoid off-by-one issues when building results.
func (sr *SubmissionResult) AddTestResult(tr TestResult) {
	sr.Details = append(sr.Details, tr)
	sr.Total++
	sr.TotalCount = sr.Total
	if tr.Ok {
		sr.Passed++
	}
	sr.PassedCount = sr.Passed
	sr.UpdateStatus()
}

// NormalizeCounts keeps legacy and UI-facing count aliases in sync.
func (sr *SubmissionResult) NormalizeCounts() {
	if sr == nil {
		return
	}

	switch {
	case sr.PassedCount == 0 && sr.Passed != 0:
		sr.PassedCount = sr.Passed
	case sr.Passed == 0 && sr.PassedCount != 0:
		sr.Passed = sr.PassedCount
	}

	switch {
	case sr.TotalCount == 0 && sr.Total != 0:
		sr.TotalCount = sr.Total
	case sr.Total == 0 && sr.TotalCount != 0:
		sr.Total = sr.TotalCount
	}

	sr.UpdateStatus()
}

// UpdateStatus derives the overall user-facing verdict from per-test results.
func (sr *SubmissionResult) UpdateStatus() {
	if sr == nil {
		return
	}

	hasRuntimeError := false
	for _, detail := range sr.Details {
		switch detail.Error {
		case SubmissionStatusTimeLimitExceeded:
			sr.Status = SubmissionStatusTimeLimitExceeded
			return
		case SubmissionStatusRuntimeError:
			hasRuntimeError = true
		}
	}

	if hasRuntimeError {
		sr.Status = SubmissionStatusRuntimeError
		return
	}
	if sr.PassedCount == sr.TotalCount {
		sr.Status = SubmissionStatusAccepted
		return
	}

	sr.Status = SubmissionStatusWrongAnswer
}

// ToJSON returns the JSON encoding (useful for logging or returning to caller).
func (sr *SubmissionResult) ToJSON() ([]byte, error) {
	sr.NormalizeCounts()
	return json.Marshal(sr)
}

// UnmarshalJSON backfills count aliases from either field naming scheme.
func (sr *SubmissionResult) UnmarshalJSON(data []byte) error {
	type submissionResultAlias SubmissionResult

	var aux submissionResultAlias
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	*sr = SubmissionResult(aux)
	sr.NormalizeCounts()
	return nil
}
