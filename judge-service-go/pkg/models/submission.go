package models

import (
	"encoding/json"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Submission status constants to avoid typos
const (
	StatusPending  = "Pending"
	StatusRunning  = "Running"
	StatusSuccess  = "Success"
	StatusFail     = "Fail"
	StatusError    = "Error"
	StatusFinished = "finished"
)

// Submission represents a user's submission entry stored in Mongo.
type Submission struct {
	ID        primitive.ObjectID `json:"_id" bson:"_id,omitempty"`
	ProblemID primitive.ObjectID `json:"problemId" bson:"problemId"`
	UserID    primitive.ObjectID `json:"userId,omitempty" bson:"userId,omitempty"`
	Language  string             `json:"language" bson:"language"`
	Code      string             `json:"code,omitempty" bson:"code,omitempty"`     // consider size limits
	Status    string             `json:"status" bson:"status"`                     // use status constants
	Output    string             `json:"output,omitempty" bson:"output,omitempty"` // aggregated compiler/runtime output
	// Prefer a concrete type for test results to avoid type-assert overhead:
	TestResult *SubmissionResult `json:"testResult,omitempty" bson:"testResult,omitempty"`
	// If you want to store raw JSON instead, use:
	// TestResult json.RawMessage `json:"testResult,omitempty" bson:"testResult,omitempty"`

	CreatedAt time.Time `json:"createdAt" bson:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt" bson:"updatedAt"`
}

// NewSubmission creates a Submission with sane defaults and timestamps.
func NewSubmission(problemID, userID primitive.ObjectID, language, code string) *Submission {
	now := time.Now().UTC()
	return &Submission{
		ID:        primitive.NewObjectID(),
		ProblemID: problemID,
		UserID:    userID,
		Language:  language,
		Code:      code,
		Status:    StatusPending,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

// SetStatus updates the submission status and UpdatedAt
func (s *Submission) SetStatus(status string) {
	s.Status = status
	s.UpdatedAt = time.Now().UTC()
}

// AttachResult attaches a SubmissionResult (parsed from runner output) and sets status accordingly.
func (s *Submission) AttachResult(result *SubmissionResult, rawOutput string) {
	s.TestResult = result
	s.Output = rawOutput
	s.UpdatedAt = time.Now().UTC()

	if result != nil {
		result.NormalizeCounts()

		switch result.Status {
		case SubmissionStatusAccepted:
			s.Status = StatusSuccess
		case SubmissionStatusWrongAnswer:
			s.Status = StatusFail
		case SubmissionStatusRuntimeError, SubmissionStatusTimeLimitExceeded:
			s.Status = StatusError
		default:
			s.Status = StatusError
		}
	}
}

// ToJSON returns the JSON bytes of the submission (useful for Redis caching).
func (s *Submission) ToJSON() ([]byte, error) {
	return json.Marshal(s)
}

// FromJSON loads submission fields from bytes into the struct (non-destructive).
func (s *Submission) FromJSON(b []byte) error {
	return json.Unmarshal(b, s)
}
