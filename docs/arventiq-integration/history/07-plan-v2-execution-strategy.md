# Coding Platform Integration Plan — V2

**Audience:** Coding Platform Developer (You)
**Status:** architecture stabilized; ready to move into low-level design / implementation planning
**Supersedes (does not replace):** `plan`, `what to do`, `what to do 2`, `3`, `CODING_PLATFORM_INTEGRATION_PLAN.md`, `ARVENTIQ_INTEGRATION_REPORT.md` — this document is the synthesis of that whole discussion thread. Keep the earlier files as history; this is the one to build from.

---

## 1. What changed since V1

V1 (`CODING_PLATFORM_INTEGRATION_PLAN.md`) correctly identified the problem-model question as the single blocking decision but couldn't answer it — no real Arventiq data existed yet. That data now exists (Arventiq's `supabase_schema.sql` + a real `questions`/`test_cases` payload + a real judge-result payload). It settles the question with evidence, not inference:

**Arventiq is a stdin/stdout judge, not a function-signature judge.** `code_snippet` reads from `sys.stdin`; `test_cases.input`/`expected_output` are raw text; there is no `functionName`, no typed `parameters`, no `returnType` anywhere in the schema or the sample payload. Your Go judge hard-requires all three (`pkg/models/submission_message.go:66`, `pkg/models/problem.go:176`). "Problem Sync" (V1's Decision 1, Option A) solves *where* problems live, not *what shape* they are — syncing a stdin-shaped problem into a function-shaped store doesn't produce something your judge can execute.

That reframes the project from "build an adapter" to "decide whether the Coding Platform natively speaks two problem models." The conclusion reached in discussion — and the one this document adopts — is **yes**, framed as a platform capability (Multi-Model Problem Support), not an Arventiq-specific patch, because stdin/stdout is the dominant model industry-wide and every future non-LeetCode-style integration will hit the same wall.

---

## 2. Architecture

Two independent, orthogonal dimensions inside the judge:

```text
Dimension 1 — Language           Dimension 2 — Problem Model
  Python                            Function        (existing)
  C++                                STDIN          (new)
  Java                               Interactive    (future)
  Go                                 SQL             (future)
  JavaScript                         Notebook        (future)
```

- **Language** → existing `LanguageAdapter` interface (`pkg/central/adapters/`). Unchanged.
- **Problem Model** → new `ExecutionStrategy` interface. New.

```text
Submission
    ↓
LanguageAdapter  +  ExecutionStrategy
    ↓
  Prepare
    ↓
  Execute
    ↓
  ParseResult
    ↓
  Compare
    ↓
  Result
```

```go
type ExecutionStrategy interface {
    Prepare(problem *models.Problem, code string, workDir string) ([]string /* files */, error)
    Execute(ctx context.Context, containerID string, files []string, input TestInput) (stdout, stderr string, err error)
    ParseResult(stdout, stderr string) (actual interface{}, err error)
    Compare(actual, expected interface{}, config CompareConfig) (passed bool, details string)
}
```

Why split `ParseResult` from `Compare` (refinement over the earlier `Evaluate()` idea): they fail differently. A parse failure means the harness/output contract broke (report as an error/crash). A compare failure means the program ran fine and produced a wrong answer (report as a normal wrong-answer verdict). Collapsing them loses that distinction in error reporting.

**Where the strategies actually diverge:**

| Stage | `FunctionExecutionStrategy` (existing behavior, now formalized) | `StdinExecutionStrategy` (new) |
|---|---|---|
| Prepare | Generate wrapper from template, embed function name/types/test data, write wrapper + user code | Write user code as-is, no wrapper |
| Execute | Run via `RunInContainer` — inputs passed as base64-encoded CLI arg | Run via new `RunInContainerWithStdin` — inputs piped to process stdin |
| ParseResult | Parse JSON blob from **stderr** | Read raw text from **stdout** |
| Compare | `pkg/comparator` — type-aware structural/deep compare | New text comparator — exact match in MVP, normalization flags in Phase 2 |

### `RunInContainerWithStdin` — additive, zero regression risk

`pkg/executor/executor.go::RunInContainer` currently has **no stdin parameter at all** (verified: zero occurrences of `Stdin` in that file). The function-wrapper model never needed it. Rather than touching the existing signature — which is exercised by an extensive existing test suite (`central_runner_test.go`, `certification_suite_test.go`, `contamination_test.go`, `*_integration_test.go` per language, stress/leak tests) — add a new sibling function using Docker's `ContainerExecAttach(..., AttachStdin: true)` and write the test input to the returned connection. `RunInContainer` itself is never modified; the function-mode path is provably untouched.

### The "unmodified pipeline" claim, precisely stated

`Submission → Queue → Judge → Results` is unchanged. What evolves is what happens *inside* the judge worker between "container acquired" and "result parsed" — that's the `ExecutionStrategy` dispatch, entirely new code, additive.

One real, minimal exception, called out explicitly rather than left implicit: both `assessment-api/src/services/submissions.service.js::validateSubmissionMessage` (Node) and `SubmissionMessage.FunctionName == ""` validation (Go, `pkg/models/submission_message.go:66`) currently treat `functionName` as unconditionally required. Both need `functionName` to become conditionally required based on a new `problemType`/`strategy` field on the message envelope. This is a small, precise, well-understood edit — but it is a real change to shared code, not zero-touch. Everything else (RabbitMQ, Mongo `Submission` model, Redis cache, container pool, workspace management) needs no change.

### Refactoring the existing function-mode path into the new interface

Formalizing `ExecutionStrategy` means the existing function-mode logic in `central_runner.go` gets *extracted* into a `FunctionExecutionStrategy` implementation, not rewritten. This is a behavior-preserving refactor and should be verified against the existing test suite (the certification/integration/stress/contamination tests already listed above) before being considered done — the risk here isn't the new stdin code, it's inadvertently changing working, heavily-tested code during extraction.

---

## 3. Node-side changes required (beyond the Go judge)

Not previously made fully explicit — the `Problem` model and submission envelope on the Node side need to carry problem-model information too, or the Go-side strategy dispatch has nothing to key off of:

- `Problem` schema: add `problemType: "function" | "stdin"`, and for stdin problems, `inputFormat`/`outputFormat` (already present in Arventiq's schema, worth storing even if only descriptive), plus the Phase 2 normalization flags (`normalizeWhitespace`, `normalizeNewlines`, `caseInsensitive`, `ignoreBlankLines`) and `floatTolerance` when that phase lands.
- Submission envelope (`messageBody` in `submissions.service.js`): add `problemType`, make `functionName` conditional on it (see above).
- Problem Sync API (still needed, V1's Decision 1 stands — it now just needs to carry the right shape per `problemType` instead of assuming function-shape always).

---

## 4. Phased roadmap

Sequenced so the Arventiq integration ships on the MVP slice, not on full schema parity. Each phase is independently shippable and validated in production before the next starts.

### Phase 1 — STDIN MVP
Compile → execute → pipe stdin → capture stdout → exact-text compare → time limit → memory limit → hidden/visible test cases.
Includes: `RunInContainerWithStdin`, `StdinExecutionStrategy` (Prepare/Execute/ParseResult/Compare, exact-match only), `problemType` field on both Node `Problem`/submission envelope and Go `SubmissionMessage`/`Problem`, conditional `functionName` validation on both sides, extraction of existing logic into `FunctionExecutionStrategy` (behavior-preserving, test-suite-verified).
Explicitly out of scope: batching (one exec call per test case, same as today's per-test function mode), normalization, weighted scoring, custom checkers.
This alone is sufficient to run the sample "Two Sum" (stdin-style) problem end-to-end.

### Phase 2 — Enhanced comparison
`normalize_whitespace`, `normalize_newlines`, `ignore_blank_lines`, `case_insensitive`, `float_tolerance`. Self-contained change to the stdin `Compare` step only.

### Phase 3 — Advanced judge features
Weighted scoring, subtasks (`question_subtasks`, per-test `weight`/`points`), fractional score reporting. Touches `Submission`/`Problem` schema (no `weight` concept exists today) and the response mapper (Judge0/Arventiq-style verdict payload with `passed_count`/`total_count`/fractional `score`/`cases[]`).

### Phase 4 — Special judge / custom checker
`checker_language`/`checker_code` — a second sandboxed program validates the first program's output. Genuinely a separate subsystem (its own sandboxing, its own execution+timeout handling); build only once Phases 1–3 are proven and there's a real problem that needs it.

**Guiding principle carried through all four phases:** implement the subset required for the current integration, ship it, validate in production, then layer on advanced capabilities — not "implement everything Arventiq's schema could theoretically support."

---

## 5. Integration layer (unchanged from V1, restated for completeness)

- New `/api/arventiq/*` prefix (not the existing `/api/integration/*`, which was built for a different client with student-JWT-forwarding assumptions).
- Auth: shared secret only (`Authorization: Bearer <ARVENTIQ_SECRET>`), no per-candidate JWT. One shared service-account `User` for all Arventiq submissions (mirrors `verifyService`'s existing pattern in `integration.mjs`); candidate/exam identifiers travel as opaque metadata (`externalStudentId`, `externalAssessmentId`) for traceability only.
- Problem Sync API: upserts a `Problem` doc (now `problemType`-aware) ahead of/alongside submission.
- Submission Translator (renamed from "Payload Mapper" — it resolves problems, maps languages, sets `problemType`, handles limits precedence, not just reshapes JSON): stored `Problem` limits win over any request-supplied limits.
- Language-ID mapping table lives in config, not in controller code.
- Response Mapper: translates the internal `Submission`/`testResult` shape into whatever Arventiq expects — will itself become `problemType`-aware once Phase 3 (weighted scoring) lands, since function-mode and stdin-mode results carry different fields.

---

## 6. Definition of Done (V2)

- A request from Arventiq reaches `/api/arventiq/*`, authenticated via shared secret only.
- Problem is synced (or already synced) with `problemType: "stdin"` and stdin-shaped fields.
- Submission is created via the existing Submission Service, `problemType` carried through the envelope.
- RabbitMQ handles it exactly as today.
- Go Judge dispatches to `StdinExecutionStrategy`, executes via `RunInContainerWithStdin`, compares via exact-text match (MVP).
- Function-mode submissions are provably unaffected — verified by the existing certification/integration/stress test suite passing unchanged after the `FunctionExecutionStrategy` extraction.
- Result is mapped back to Arventiq's expected shape.
- No duplicate execution pipeline exists; `RunInContainer` (function mode) is untouched; RabbitMQ/Mongo/Redis/pool/workspace code is untouched.

## 7. Core philosophy (revised)

> The Submission → Queue → Judge → Results pipeline never changes. The Go Judge evolves to support multiple execution strategies — function-based and stdin-based, with room for more — as first-class capabilities of the platform. Arventiq is the first consumer of stdin support, not the reason it exists.
