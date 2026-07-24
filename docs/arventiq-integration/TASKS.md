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

- [x] Add `problemType: "function" | "stdin"` to `assessment-api/models/Problem.mjs` — done via a mongoose function-based `required` (`isFunctionProblem`) on `functionName`/`returnType`, not just app-level validation. Also added `externalId` (unique/sparse — maps a synced problem back to its source system's own id, needed for Problem Sync upsert; not called out explicitly in the original plan but required to make upsert-by-external-id work at all)
- [x] Add `inputFormat`/`outputFormat` (descriptive) to `Problem.mjs` for stdin problems
- [x] Add `problemType` to the submission envelope in `assessment-api/src/services/submissions.service.js` (`messageBody`) — landed as part of a `buildJudgeMessageBody`/`buildJudgeTests` extraction shared by `submitSolution` and all three `rejudge*` functions, so the envelope logic (incl. `problemType` and conditional `functionName`) lives in exactly one place instead of 4 near-identical copies. Confirmed live: an existing function-mode problem (3Sum) submitted end-to-end through the real stack still returns `Accepted` with hidden test cases correctly redacted for the student view — no regression.
- [x] Update `validateSubmissionMessage` in `submissions.service.js` — `functionName` required only when `problemType !== "stdin"` (mirrors the Go-side condition exactly)
- [x] New `assessment-api/src/config/env.js` entry: `ARVENTIQ_SECRET` (same production-required guard pattern as `TESTING_PLATFORM_KEY`)
- [x] New `verifyArventiq` middleware (`assessment-api/src/middleware/arventiq.mjs`) — shared secret only (`Authorization: Bearer <ARVENTIQ_SECRET>`), no student JWT. Deviates from `verifyService`'s mock `req.user` in one necessary way: `Submission.userId` is a required ref, so this lazily creates and caches one real, persisted `User` doc (`arventiq-service@system.internal`, bcrypt-hashed random placeholder password, unreachable via login) rather than a mock object with no `_id`. Confirmed only one such user is ever created across repeated requests.
- [x] New routes under `assessment-api/src/routes/arventiq.routes.js`, mounted at `/arventiq` in `routes/index.js` (giving both `/api/arventiq/*` and `/api/v1/arventiq/*`, consistent with every other route in the app); added an `arventiqLimiter` in `app.js` mirroring `integrationLimiter`
- [x] Problem Sync endpoint (`POST /api/arventiq/problems` — upsert by `externalId`, `problemType`-aware). Deliberately does **not** reuse `problems.service.js::createProblem`'s deep-validation gate (ajv `contracts/problem.schema.json` + wrapper-generation + reference-solution check) — that machinery assumes function-mode (`parameters`/`returnType`/a reference solution) unconditionally and Arventiq's schema has none of that. Arventiq problems get their own lighter, `problemType`-aware validation instead.
- [x] Submission Translator (`arventiq.service.js::submitArventiqSolution`) — resolves `externalId` → internal `Problem._id`, maps `code_language` via the new config table, then delegates to `submissionsService.submitSolution` (extended with optional `externalStudentId`/`externalAssessmentId` params) rather than duplicating submission-creation/publish logic. "Limits precedence (stored Problem wins)" turned out to already be structurally guaranteed: the Go judge always re-fetches the `Problem` doc fresh from MongoDB by id for the async queue path and uses its `timeLimitMs`/`memoryLimitMb`/`testCases` — the outbound message's own `tests`/limits fields are only ever consulted on the synchronous ephemeral `/run` path, which Arventiq's flow doesn't use. So there was no precedence conflict to resolve, just nothing to get wrong.
- [x] Language-ID mapping table — `assessment-api/src/config/arventiqLanguages.js` (config, not inline, as specified)
- [x] Response Mapper (`arventiq.service.js::mapSubmissionToArventiqVerdict`) — internal `Submission`/`testResult` → Arventiq's `verdict`/`score`/`passed_count`/`total_count`/`cases[]` shape from `history/04`. Known gap, not solved in this milestone: per-test-case correlation back to Arventiq's original `test_cases` rows is positional (array order), not by their own `test_cases.id` — fine as long as sync preserves order (it does), but there's no explicit `externalId` stored per test case yet. `memory_kb`/`max_memory_kb` are always `null` (the Go judge doesn't populate `TestResult.MemoryKB` yet). `weight`/`group` are hardcoded to `1.0`/`null` (Phase 3 — subtasks/weighted scoring — not implemented).

## Milestone 4 — Integration Testing
*End-to-end, once 1–3 are done.*

- [x] Sync a real Arventiq problem via the new Problem Sync API — 2026-07-24, the sample "Two Sum" payload from `history/04-arventiq-real-schema-and-payload.md`, against the live `docker compose` stack
- [x] Submit code through `/api/arventiq/*` → RabbitMQ → Go Judge → result — verified both a correct solution (`accepted`, 3/3 including the hidden case) and a wrong one (`wrong_answer`, 0/3, correct per-case `actual` output)
- [x] Verify verdict shape matches what Arventiq expects — response matches `history/04`'s sample shape (`verdict`/`score`/`passed_count`/`total_count`/`cases[]`)
- [x] Auth failure cases — missing `Authorization` header → 401; confirmed via live request. (Wrong-secret case not separately exercised but is the same code path as missing — `token !== env.ARVENTIQ_SECRET` — so not expected to differ)
- [ ] Queue/judge failure cases (judge down, malformed problem) — not exercised; judge was up for all manual testing so far

---

## Deferred (Phase 2–4 of `PLAN.md` §5 — not started until the above is proven in production)

- [ ] Output normalization (whitespace/newline/case/float-tolerance) — stdin `Comparator`
- [ ] Weighted scoring / subtasks — schema + response mapper
- [ ] Custom checker / special judge
