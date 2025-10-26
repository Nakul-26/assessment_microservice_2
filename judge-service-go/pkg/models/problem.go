package models

import (
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type TestCase struct {
	ID             int         `json:"id" bson:"id"`
	Type           string      `json:"type" bson:"type"`
	Input          interface{} `json:"input" bson:"input"`                   // parsed input (object/array/scalar)
	ExpectedOutput interface{} `json:"expectedOutput" bson:"expectedOutput"` // parsed expected output (object/array/scalar)
	IsHidden       bool        `json:"isHidden" bson:"isHidden"`
}

type Problem struct {
	ID          primitive.ObjectID `json:"id" bson:"_id,omitempty"`
	Title       string             `json:"title" bson:"title"`
	Description string             `json:"description" bson:"description"`
	Difficulty  string             `json:"difficulty" bson:"difficulty"`
	TestCases   []TestCase         `json:"testCases" bson:"testCases"`
	// Primary function signature to help frontend/template generation
	FunctionSignature FunctionSignature `json:"functionSignature" bson:"functionSignature"`
	// Optional per-language signatures (legacy/compat)
	FunctionSignatures map[string]string `json:"functionSignatures" bson:"functionSignatures"`
	FunctionName       map[string]string `json:"functionName" bson:"functionName"`

	// Describe expected I/O types so the wrapper generator can parse inputs and post-process outputs
	ExpectedIoType ExpectedIoType `json:"expectedIoType" bson:"expectedIoType"`
}

type FunctionSignature struct {
	Language string `json:"language" bson:"language"`
	Template string `json:"template" bson:"template"`
}

type InputParameter struct {
	Name string `json:"name" bson:"name"`
	Type string `json:"type" bson:"type"`
}

type ExpectedIoType struct {
	InputParameters []InputParameter `json:"inputParameters" bson:"inputParameters"`
	OutputType      string           `json:"outputType" bson:"outputType"`
}
