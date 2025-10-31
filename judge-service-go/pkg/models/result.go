package models

// TestResult represents the result of a single test case
type TestResult struct {
	Test      int         `json:"test"`
	Ok        bool        `json:"ok"`
	Output    interface{} `json:"output,omitempty"`
	Error     string      `json:"error,omitempty"`
	Stack     string      `json:"stack,omitempty"`
	Traceback string      `json:"traceback,omitempty"`
}

// SubmissionResult represents the overall result of a submission
type SubmissionResult struct {
	Status  string       `json:"status"`
	Passed  int          `json:"passed"`
	Total   int          `json:"total"`
	Details []TestResult `json:"details"`
}
