package models

type TestCase struct {
	Input          []interface{} `json:"input"`
	ExpectedOutput []interface{} `json:"expectedOutput"`
	IsHidden       bool          `json:"isHidden"`
}

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
