package models

import (
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// TestCase defines the structure for a single test case.
type TestCase struct {
	Input          []interface{} `json:"input" bson:"input"`
	ExpectedOutput interface{}   `json:"expectedOutput" bson:"expectedOutput"`
	IsHidden       bool          `json:"isHidden" bson:"isHidden"`
}

// FunctionDefinition holds the name and template for a function in a specific language.
type FunctionDefinition struct {
	Name     string `json:"name" bson:"name"`
	Template string `json:"template" bson:"template"`
}

// Problem defines the structure for a programming problem.
type Problem struct {
	ID                primitive.ObjectID            `json:"_id" bson:"_id,omitempty"`
	Title             string                        `json:"title" bson:"title"`
	Description       string                        `json:"description" bson:"description"`
	Difficulty        string                        `json:"difficulty" bson:"difficulty"`
	TestCases         []TestCase                    `json:"testCases" bson:"testCases"`
	TestsJSON         []byte                        `json:"testsJSON" bson:"testsJSON"`
	FunctionDefinitions map[string]FunctionDefinition `json:"functionDefinitions" bson:"functionDefinitions"`
	ExpectedIoType    ExpectedIoType                `json:"expectedIoType" bson:"expectedIoType"`
	Tags              []string                      `json:"tags" bson:"tags"`
	IsPremium         bool                          `json:"isPremium" bson:"isPremium"`
	CreatedAt         primitive.DateTime            `json:"createdAt" bson:"createdAt"`
}

// InputParameter describes a single parameter for a function.
type InputParameter struct {
	Name string `json:"name" bson:"name"`
	Type string `json:"type" bson:"type"`
}

// ExpectedIoType describes the input and output types for a problem.
type ExpectedIoType struct {
	FunctionName    string           `json:"functionName" bson:"functionName"`
	InputParameters []InputParameter `json:"inputParameters" bson:"inputParameters"`
	ReturnType      string           `json:"returnType" bson:"returnType"`
}

