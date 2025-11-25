package models

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	// "reflect"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// TestCase defines the structure for a single test case.
type TestCase struct {
	Input          []interface{} `json:"input" bson:"input"`
	ExpectedOutput interface{}   `json:"expectedOutput" bson:"expectedOutput"`
	IsHidden       bool          `json:"isHidden" bson:"isHidden,omitempty"`
}

// FunctionDefinition holds the name and template for a function in a specific language.
type FunctionDefinition struct {
	Name     string `json:"name" bson:"name"`
	Template string `json:"template" bson:"template"`
}

// Problem defines the structure for a programming problem.
type Problem struct {
	ID                  primitive.ObjectID            `json:"_id" bson:"_id,omitempty"`
	Title               string                        `json:"title" bson:"title"`
	Description         string                        `json:"description" bson:"description"`
	Difficulty          string                        `json:"difficulty" bson:"difficulty"`
	TestCases           []TestCase                    `json:"testCases,omitempty" bson:"testCases,omitempty"`
	TestsJSON           json.RawMessage               `json:"testsJSON,omitempty" bson:"testsJSON,omitempty"` // store raw JSON (safer)
	FunctionDefinitions map[string]FunctionDefinition `json:"functionDefinitions,omitempty" bson:"functionDefinitions,omitempty"`
	ExpectedIoType      ExpectedIoType                `json:"expectedIoType,omitempty" bson:"expectedIoType,omitempty"`
	Tags                []string                      `json:"tags,omitempty" bson:"tags,omitempty"`
	IsPremium           bool                          `json:"isPremium,omitempty" bson:"isPremium,omitempty"`
	CreatedAt           primitive.DateTime            `json:"createdAt,omitempty" bson:"createdAt,omitempty"`
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

// ParseTestsJSON attempts to populate p.TestCases from p.TestsJSON if TestCases is empty.
// Returns error on invalid JSON.
func (p *Problem) ParseTestsJSON() error {
	if len(p.TestsJSON) == 0 {
		// nothing to parse
		return nil
	}
	var cases []TestCase
	if err := json.Unmarshal(p.TestsJSON, &cases); err == nil {
		p.TestCases = cases
		return nil
	}
	// fallback: sometimes the tests JSON is an array of arrays [ [inputs], expected ]
	// Try to unmarshal to generic array and convert
	var generic []interface{}
	if err := json.Unmarshal(p.TestsJSON, &generic); err != nil {
		return fmt.Errorf("failed to unmarshal tests JSON: %w", err)
	}
	// Convert to TestCase slice
	cases = make([]TestCase, 0, len(generic))
	for _, item := range generic {
		// item is expected to be [inputs, expectedOutput] or {"input":..., "expectedOutput":...}
		switch v := item.(type) {
		case map[string]interface{}:
			// object form
			inputIntf, _ := v["input"].([]interface{})
			tc := TestCase{
				Input:          normalizeNumbers(inputIntf),
				ExpectedOutput: normalizeValue(v["expectedOutput"]),
			}
			// try to extract isHidden if present
			if b, ok := v["isHidden"].(bool); ok {
				tc.IsHidden = b
			}
			cases = append(cases, tc)
		case []interface{}:
			// array form: [inputArray, expectedOutput, (optional) isHidden]
			if len(v) >= 2 {
				// first element expected to be []interface{}
				inputArr := []interface{}{}
				if arr, ok := v[0].([]interface{}); ok {
					inputArr = normalizeNumbers(arr)
				}
				expected := normalizeValue(v[1])
				tc := TestCase{
					Input:          inputArr,
					ExpectedOutput: expected,
				}
				if len(v) >= 3 {
					if b, ok := v[2].(bool); ok {
						tc.IsHidden = b
					}
				}
				cases = append(cases, tc)
			}
		default:
			// unsupported type; skip
		}
	}
	p.TestCases = cases
	return nil
}

// normalizeNumbers converts JSON-decoded numbers (float64) to int64 when they look like integers.
// This helps when users provide numbers expecting ints.
func normalizeNumbers(arr []interface{}) []interface{} {
	if arr == nil {
		return nil
	}
	out := make([]interface{}, len(arr))
	for i, v := range arr {
		out[i] = normalizeValue(v)
	}
	return out
}

func normalizeValue(v interface{}) interface{} {
	switch vv := v.(type) {
	case float64:
		if isWholeNumber(vv) {
			// convert to int64 if safe
			return int64(vv)
		}
		return vv
	case []interface{}:
		return normalizeNumbers(vv)
	case map[string]interface{}:
		// recursively normalize values inside objects
		m := make(map[string]interface{}, len(vv))
		for k, val := range vv {
			m[k] = normalizeValue(val)
		}
		return m
	default:
		// leave as-is for strings, bools, nil etc.
		return vv
	}
}

func isWholeNumber(f float64) bool {
	return math.Mod(f, 1.0) == 0
}

// ValidateBasic performs quick validation on the Problem structure and returns an error with details.
func (p *Problem) ValidateBasic() error {
	if p.Title == "" {
		return errors.New("title is required")
	}
	if p.Description == "" {
		return errors.New("description is required")
	}
	// Validate ExpectedIoType and parameters
	for _, ip := range p.ExpectedIoType.InputParameters {
		if ip.Name == "" || ip.Type == "" {
			return fmt.Errorf("invalid input parameter: %+v", ip)
		}
	}
	// Parse tests if needed
	if len(p.TestCases) == 0 && len(p.TestsJSON) > 0 {
		if err := p.ParseTestsJSON(); err != nil {
			return fmt.Errorf("failed to parse tests JSON: %w", err)
		}
	}

	// Basic check: each test's input length should match expected input params (if known)
	if len(p.ExpectedIoType.InputParameters) > 0 {
		for i, tc := range p.TestCases {
			if len(tc.Input) != len(p.ExpectedIoType.InputParameters) {
				return fmt.Errorf("test %d: input length %d does not match expected params %d", i, len(tc.Input), len(p.ExpectedIoType.InputParameters))
			}
		}
	}
	return nil
}
