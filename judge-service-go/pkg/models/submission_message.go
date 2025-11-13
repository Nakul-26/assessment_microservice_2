package models

type SubmissionMessage struct {
	SchemaVersion string     `json:"schemaVersion"`
	SubmissionID  string     `json:"submissionId"`
	ProblemID     string     `json:"problemId"`
	Language      string     `json:"language"`
	Code          string     `json:"code"`
	Tests         []TestCase `json:"tests"`
	FunctionName  string     `json:"functionName"`
	CompareMode   string     `json:"compareMode,omitempty"`
}
