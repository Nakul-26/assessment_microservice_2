package main

import (
	"context"

	"judge-service-go/pkg/central/adapters"
	"judge-service-go/pkg/executor"
	"judge-service-go/pkg/models"
	"judge-service-go/pkg/pool"
)

// ExecutionStrategy dispatches submission execution based on a problem's
// ProblemType (see pkg/models/problem_type.go). This is the seam between
// "how do I run this problem" (strategy) and "what language is it in"
// (adapters.LanguageAdapter) — the two are orthogonal.
//
// Kept as a single Run method rather than a finer-grained
// Prepare/Execute/ParseResult/Compare split (see
// docs/arventiq-integration/PLAN.md §3.3 for that conceptual model).
//
// Revisited now that StdinExecutionStrategy (stdin_runner.go) exists: it
// needed its own compile-once/run-per-test loop, its own error
// classification, its own TestResult bookkeeping — all hand-written to
// mirror runSubmissionCentralPerTest's shape rather than sharing it through
// common Prepare/Execute/ParseResult/Compare seams. That's duplication (the
// two loops are structurally near-identical, differing mainly in what
// Execute/ParseResult/Compare mean per PLAN.md §3.3's stage table), not a
// monolith, so it wasn't worth blocking the MVP on. If a third strategy
// shows up, or a bug has to be fixed in both loops in lockstep more than
// once, extract the shared per-test-loop skeleton for real; until then, Run
// is sufficient and this is the last revisit note this file needs.
type ExecutionStrategy interface {
	Run(
		ctx context.Context,
		exec *executor.Executor,
		pooledContainer *pool.PooledContainer,
		submissionMsg models.SubmissionMessage,
		problem models.Problem,
		adapter adapters.LanguageAdapter,
	) (result *models.SubmissionResult, cleanupFailed bool, err error)
}

// FunctionExecutionStrategy wraps the existing function-wrapper execution
// path behind ExecutionStrategy. It is a pure delegation — no behavior
// changes — so the existing test suite continues to prove correctness.
type FunctionExecutionStrategy struct{}

func (FunctionExecutionStrategy) Run(
	ctx context.Context,
	exec *executor.Executor,
	pooledContainer *pool.PooledContainer,
	submissionMsg models.SubmissionMessage,
	problem models.Problem,
	adapter adapters.LanguageAdapter,
) (*models.SubmissionResult, bool, error) {
	return runSubmissionCentralDetailed(ctx, exec, pooledContainer, submissionMsg, problem, adapter)
}

// StdinExecutionStrategy handles ProblemType: stdin problems — a full
// program reads from stdin and writes to stdout, compared as text (see
// pkg/models/problem_type.go, docs/arventiq-integration/PLAN.md §3.3). It
// ignores the LanguageAdapter parameter (that's the function-mode wrapper
// adapter) and resolves its own StdinLanguageAdapter from
// submissionMsg.Language via adapters.GetStdinAdapter.
type StdinExecutionStrategy struct{}

func (StdinExecutionStrategy) Run(
	ctx context.Context,
	exec *executor.Executor,
	pooledContainer *pool.PooledContainer,
	submissionMsg models.SubmissionMessage,
	problem models.Problem,
	_ adapters.LanguageAdapter,
) (*models.SubmissionResult, bool, error) {
	return runSubmissionStdinDetailed(ctx, exec, pooledContainer, submissionMsg, problem)
}

// StrategyRegistry maps a ProblemType to the ExecutionStrategy that handles
// it, mirroring adapters.AdapterRegistry's language dispatch pattern.
var StrategyRegistry = map[models.ProblemType]ExecutionStrategy{
	models.FunctionProblem: FunctionExecutionStrategy{},
	models.StdinProblem:    StdinExecutionStrategy{},
}

// ResolveStrategy returns the ExecutionStrategy registered for problemType,
// defaulting an unset type to models.FunctionProblem for backward
// compatibility with problems that predate the ProblemType field.
func ResolveStrategy(problemType models.ProblemType) (ExecutionStrategy, bool) {
	if problemType == "" {
		problemType = models.FunctionProblem
	}
	strategy, ok := StrategyRegistry[problemType]
	return strategy, ok
}
