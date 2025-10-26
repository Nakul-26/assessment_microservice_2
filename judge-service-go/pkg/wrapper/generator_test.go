package wrapper

import (
	"reflect"
	"testing"

	"judge-service-go/pkg/models"
)

func TestParseNamedAssignments(t *testing.T) {
	raw := "nums = [1,2,3]\ntarget = 3"
	exp := models.ExpectedIoType{}
	m, _ := parseInputRaw(raw, exp)
	if _, ok := m["nums"]; !ok {
		t.Fatalf("expected nums key, got: %v", m)
	}
	if _, ok := m["target"]; !ok {
		t.Fatalf("expected target key, got: %v", m)
	}
}

func TestParsePositional(t *testing.T) {
	raw := "[1,2,3]\n3"
	exp := models.ExpectedIoType{InputParameters: []models.InputParameter{{Name: "nums"}, {Name: "target"}}}
	m, _ := parseInputRaw(raw, exp)
	if _, ok := m["nums"]; !ok {
		t.Fatalf("expected nums, got %v", m)
	}
	if !numericEquals(m["target"], 3) {
		t.Fatalf("expected target 3, got %v", m["target"])
	}
}

func TestParseScalarAndJSON(t *testing.T) {
	raw := "42"
	m, _ := parseInputRaw(raw, models.ExpectedIoType{})
	if m["input"] != 42 {
		t.Fatalf("expected 42, got %v", m["input"])
	}

	raw2 := "{\"a\": 1, \"b\": [2,3]}"
	m2, _ := parseInputRaw(raw2, models.ExpectedIoType{})
	if _, ok := m2["input"].(map[string]interface{}); !ok {
		t.Fatalf("expected object, got %T", m2["input"])
	}
}

func TestParseCSVAndSpaceDelimited(t *testing.T) {
	rawCSV := "1,2,3"
	m, _ := parseInputRaw(rawCSV, models.ExpectedIoType{})
	if !reflect.DeepEqual(m["input"], []interface{}{1, 2, 3}) {
		t.Fatalf("expected [1 2 3], got %v", m["input"])
	}

	rawSpace := "4 5 6"
	m2, _ := parseInputRaw(rawSpace, models.ExpectedIoType{})
	if !reflect.DeepEqual(m2["input"], []interface{}{4, 5, 6}) {
		t.Fatalf("expected [4 5 6], got %v", m2["input"])
	}
}

func numericEquals(a interface{}, b float64) bool {
	switch v := a.(type) {
	case int:
		return float64(v) == b
	case float64:
		return v == b
	case int64:
		return float64(v) == b
	default:
		return false
	}
}
