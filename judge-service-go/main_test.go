package main

import (
	"testing"
	"time"

	"judge-service-go/pkg/models"
)

func TestParseSingleTestOutput_ValidJSON(t *testing.T) {
	out, err := parseSingleTestOutput(`{"output":[1,2]}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Output == nil {
		t.Fatalf("expected output to be present")
	}
}

func TestParseSingleTestOutput_LastLineFallback(t *testing.T) {
	out, err := parseSingleTestOutput("hello\n{\"output\":42}\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Output == nil {
		t.Fatalf("expected parsed output from last line")
	}
}

func TestParseSingleTestOutput_Invalid(t *testing.T) {
	_, err := parseSingleTestOutput("not-json")
	if err == nil {
		t.Fatalf("expected parse error")
	}
}

func TestPerTestTimeout_DefaultAndProblemValue(t *testing.T) {
	if got := perTestTimeout(models.Problem{}); got != defaultSandboxTimeout {
		t.Fatalf("expected default timeout %v, got %v", defaultSandboxTimeout, got)
	}

	problem := models.Problem{TimeLimitMs: 1500}
	if got := perTestTimeout(problem); got != 1500*time.Millisecond {
		t.Fatalf("expected 1500ms timeout, got %v", got)
	}
}
