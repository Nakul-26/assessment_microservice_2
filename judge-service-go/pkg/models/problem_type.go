package models

// ProblemType distinguishes how a problem is executed and judged.
type ProblemType string

const (
	// FunctionProblem is the existing LeetCode-style model: a named function
	// with typed parameters/return value, invoked via a generated wrapper.
	FunctionProblem ProblemType = "function"
	// StdinProblem is a competitive-programming-style model: a full program
	// reads from stdin and writes to stdout; output is compared as text.
	StdinProblem ProblemType = "stdin"
)

// EffectiveType returns p.Type, defaulting to FunctionProblem when unset so
// that problems persisted before this field existed keep their current behavior.
func (p Problem) EffectiveType() ProblemType {
	if p.Type == "" {
		return FunctionProblem
	}
	return p.Type
}

// EffectiveType returns sm.ProblemType, defaulting to FunctionProblem when
// unset for the same backward-compatibility reason as Problem.EffectiveType.
func (sm SubmissionMessage) EffectiveType() ProblemType {
	if sm.ProblemType == "" {
		return FunctionProblem
	}
	return sm.ProblemType
}
