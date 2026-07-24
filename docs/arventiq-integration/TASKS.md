# Implementation Tracker

Working checklist. `PLAN.md` is the architectural reference — consult it whenever a "why" question comes up; this file is just "what's done."

**Order being followed:** Milestone 2 (Go Judge Core) first — self-contained, validated by the existing test suite immediately, no dependency on Node changes. Milestone 1 (Node API) follows once the `problemType`/message-envelope contract it needs to emit is proven stable on the Go side.

---

## Milestone 2 — Go Judge Core
*Extract existing behavior into the new strategy shape; add nothing new yet. Must not change function-mode behavior — the existing test suite is the proof.*

- [x] Define `ProblemType` (`function` | `stdin`) — `pkg/models/problem_type.go`
- [x] Define `ExecutionStrategy` interface — `strategy.go` (root `main` package, not `pkg/central/strategy/`; single `Run` method rather than `Prepare`/`Execute`/`ParseResult`/`Compare` — see `PLAN.md` §3.3 for the deviation rationale, deferred until `StdinExecutionStrategy` exists)
- [x] Extract current `central_runner.go` logic into `FunctionExecutionStrategy` (behavior-preserving — `FunctionExecutionStrategy.Run` pure-delegates to `runSubmissionCentralDetailed`)
- [x] Add Strategy Registry (mirrors `AdapterRegistry` in `pkg/central/adapters/adapter.go` — package-level map + `ResolveStrategy`, see `PLAN.md` §3.4)
- [x] Wire `main.go`/`central_runner.go` dispatch through the registry instead of calling function-mode logic directly (both `processSubmission` and the `/run` HTTP handler; unresolvable non-function problem types are rejected before container acquisition)
- [x] Run full existing test suite — 2026-07-24: `go test ./...` passes except `TestIsCentralCompareEnabled_DefaultsAndOverrides/unsupported_language_stays_legacy` and `TestAppendBatchedResultsParsesJSONLines`, both confirmed pre-existing failures on `main` (reproduced identically via `git stash -u`), unrelated to this refactor — zero regressions from the strategy work. Docker-dependent integration/stress/certification tests not run in this environment (no Docker); not exercised by the strategy dispatch change (adapter/container logic untouched).
- [x] `go vet` / `go build` clean

## Milestone 3 — STDIN MVP
*New capability. Depends on Milestone 2's interface + registry existing.*

- [x] `RunInContainerWithStdin` — `pkg/executor/executor.go`, mirrors `RunInContainer`/`RunInContainerStream`'s compile+run+cleanup lifecycle but attaches stdin via a new `runExecWithStdinTimeout` (`AttachStdin: true` + `StartExecOptions.InputStream`); `RunInContainer` itself untouched
- [x] `StdinExecutionStrategy` — implemented as the single `Run` method the actual `ExecutionStrategy` interface has (see `PLAN.md` §3.3), not a literal `Prepare`/`Execute`/`ParseResult` split. Lives in `strategy.go` + `stdin_runner.go` (root `main` package, mirroring where `FunctionExecutionStrategy`/`central_runner.go` live). No wrapper, no batching — one exec per test case via `RunInContainerWithStdin`, compile-once-run-per-test for compiled languages (mirrors `runSubmissionCentralPerTest`'s split)
- [x] Minimal exact-text `Comparator` for stdin mode — `pkg/comparator/text.go`, `CompareText` (trailing-whitespace-trimmed exact match; internal-whitespace/case normalization deferred to Phase 2 per `PLAN.md` §5)
- [x] Register `StdinExecutionStrategy` in the Strategy Registry under `ProblemType: stdin` — `strategy.go`
- [x] `SubmissionMessage.FunctionName` validation becomes conditional on `ProblemType` (`pkg/models/submission_message.go:67`) — done as part of Milestone 2's landing (see that section above)
- [x] `Problem.ValidateBasic()` — `FunctionName`/`ReturnType`/`Parameters` requirement becomes conditional on `ProblemType` (`pkg/models/problem.go:177`) — same as above; additionally added a stdin-shape check (`pkg/models/problem.go`) requiring each `TestCase.Input` to be exactly one string element and `Expected` a string, so malformed stdin test data fails validation cleanly instead of panicking the runner
- [x] New: stdin-mode language adapters — `pkg/central/adapters/stdin_adapter.go`, `StdinLanguageAdapter`/`CompilingStdinLanguageAdapter` interfaces + registry, covering `python`/`javascript`/`cpp`/`c`/`go` (the MVP set — not all 8 function-mode languages; unsupported languages get a clean submission error, not a crash, see `GetStdinAdapter`)
- [x] New (bug found during manual testing, not in original plan): `/run`'s ephemeral-problem construction in `main.go` never set `Type: msg.EffectiveType()` on the built `models.Problem`, so a stdin submission with no persisted `Problem` doc silently defaulted to function-mode and failed validation. Fixed.
- [x] Manual end-to-end test: submitted the sample "Two Sum" stdin problem (from `history/04-arventiq-real-schema-and-payload.md`) via `/run` against the real Dockerized stack (`docker compose`) — 2026-07-24. Verified: correct Python solution → Accepted 3/3; deliberately wrong Python solution → Wrong Answer with correct failing test; correct C++ solution → Accepted 2/2 (confirms the compile-once-run-per-test path); unsupported stdin language (Java) → clean 500 with a descriptive error, no crash; existing function-mode submission on the same rebuilt instance → still Accepted (no regression). Note: had to `docker compose build` + `up -d` to pick up source changes — this image's `ENTRYPOINT` runs the baked-in production binary regardless of the bind-mounted `/src` and compose's `command:` override (that override becomes args to the entrypoint, not a shell it runs), so a plain `docker restart` silently keeps serving the old binary. Worth fixing in `docker-compose.yml` (drop the stale `command:`/`working_dir` override, or add `entrypoint: []`) but out of scope here since it's a local dev-loop issue, not part of this integration.
- [x] Confirmed time limit behaves the same as function mode: an infinite-loop Python submission correctly returned `Time Limit Exceeded` at the per-test timeout. Memory limit and hidden-vs-visible test case handling reuse the exact same code paths as function mode (`problem.MemoryLimitMb` passed through unchanged to `RunInContainerWithStdin`; the `/run` handler's sample-only filtering and `TestCase.IsHidden`/`IsSample` are generic across problem types) — not independently exercised with a dedicated OOM/hidden-test manual run, but no stdin-specific code touches either.

## Milestone 1 — Node API
*Depends on Milestone 3's message-envelope contract (`problemType`, conditional `functionName`) being real, not just planned.*

- [ ] Add `problemType: "function" | "stdin"` to `assessment-api/models/Problem.mjs` (note: `functionName`/`returnType` are currently `required: true` unconditionally at the Mongoose schema level — needs conditional `required` function, not just app-level validation)
- [ ] Add `inputFormat`/`outputFormat` (descriptive) to `Problem.mjs` for stdin problems
- [ ] Add `problemType` to the submission envelope in `assessment-api/src/services/submissions.service.js` (`messageBody`)
- [ ] Update `validateSubmissionMessage` in `submissions.service.js` — `functionName` required only when `problemType === "function"`
- [ ] New `assessment-api/src/config/env.js` entry: `ARVENTIQ_SECRET`
- [ ] New `verifyArventiq` middleware — shared secret only, no student JWT, sets `req.user` to the shared service account (mirrors `verifyService` in `integration.mjs`)
- [ ] New routes under `assessment-api/src/routes/arventiq.routes.js`, mounted at `/api/arventiq/*` in `src/app.js`
- [ ] Problem Sync endpoint (`POST /api/arventiq/problems` — upsert, `problemType`-aware)
- [ ] Submission Translator: language-ID mapping table (config, not inline), limits precedence (stored `Problem` wins)
- [ ] Response Mapper: internal `Submission`/`testResult` → Arventiq's expected shape

## Milestone 4 — Integration Testing
*End-to-end, once 1–3 are done.*

- [ ] Sync a real Arventiq problem via the new Problem Sync API
- [ ] Submit code through `/api/arventiq/*` → RabbitMQ → Go Judge → result
- [ ] Verify verdict shape matches what Arventiq expects
- [ ] Auth failure cases (missing/wrong `ARVENTIQ_SECRET`)
- [ ] Queue/judge failure cases (judge down, malformed problem)

---

## Deferred (Phase 2–4 of `PLAN.md` §5 — not started until the above is proven in production)

- [ ] Output normalization (whitespace/newline/case/float-tolerance) — stdin `Comparator`
- [ ] Weighted scoring / subtasks — schema + response mapper
- [ ] Custom checker / special judge
