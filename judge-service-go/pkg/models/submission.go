package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Submission struct {
	ID         primitive.ObjectID `json:"_id" bson:"_id,omitempty"`
	ProblemID  primitive.ObjectID `json:"problemId" bson:"problemId"`
	UserID     primitive.ObjectID `json:"userId" bson:"userId"`
	Language   string             `json:"language" bson:"language"`
	Code       string             `json:"code" bson:"code"`
	Status     string             `json:"status" bson:"status"`
	Output     string             `json:"output" bson:"output"`
	TestResult interface{}        `json:"testResult" bson:"testResult"`
	CreatedAt  time.Time          `json:"createdAt" bson:"createdAt"`
	UpdatedAt  time.Time          `json:"updatedAt" bson:"updatedAt"`
}
