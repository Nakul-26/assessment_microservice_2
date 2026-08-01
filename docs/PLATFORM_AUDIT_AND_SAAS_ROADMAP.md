# Platform Audit & SaaS Roadmap

Generated 2026-07-31. Full-codebase audit requested ahead of a planned pivot to a subscription SaaS product. All findings below were independently spot-checked against source (file:line citations are verified, not taken on trust from the auditing sub-agents).

---

## 0. Reality-check on the pasted "Evolution Plan"

A prior planning document (multi-model `ProblemType`/`ExecutionStrategy`/`StrategyRegistry` architecture, `/api/arventiq/*` REST surface, Function+STDIN+Interactive+SQL+Notebook problem types) was presented as fully implemented ("Status: Completed" on every phase). **None of it exists in this repository.** Verified by repo-wide grep and git log:

- No `ProblemType`, `ExecutionStrategy`, or `StrategyRegistry` anywhere in the codebase.
- `contracts/problem.schema.json` is strictly Function-model-only (`functionName`/`parameters`/`returnType`/`testCases`, `additionalProperties: false`) — no `problemType`, `externalId`, `inputFormat`, `outputFormat`.
- No `/api/arventiq/*` routes.

**What actually exists** (simpler, and real):
- `/api/integration/*` — a working, tested integration surface (shared-secret `TESTING_PLATFORM_KEY` + forwarded student JWT) for an external "Testing Platform" to create assessments, submit solutions, and fetch results. Documented in `docs/INTEGRATION_GUIDE.md`.
- `/api/judge0/*` + judge-service-go `/raw-run` — a Judge0-CE-compatible raw code execution shim (gated by `JUDGE0_SHIM_KEY`), used by an external exam-platform's own grading logic. This is what most of the recent language-support work (Rust/Ruby/PHP/Kotlin/C#) targeted.

Any roadmap or business commitment should be built from this actual baseline, not the aspirational document.

---

## 1. Findings by Severity

### 🔴 Critical

| # | Finding | Location | Failure Scenario |
|---|---|---|---|
| C1 | `TESTING_PLATFORM_KEY` defaults to the hardcoded string `arventiq_secret_key`, silently defeating the app's own fail-fast check | `docker-compose.prod.yml:119`; guard at `assessment-api/src/config/env.js:21-23` only checks the var is *set*, not non-default | An operator forgets to set the real key in Dokploy → the service starts fine with a publicly-known-from-source default → anyone can forge `x-service-key: arventiq_secret_key` and hit every `/api/integration/*` route as a privileged service account. |
| ~~C2~~ | ~~No tenant/college scoping enforced on core entities~~ — **fixed**, with an important correction found along the way: the pre-existing `collegeId` checks in `questions.service.js` (cited in this report as "already solid") were actually **dead code in production** — `auth.service.js`'s `jwt.sign(...)` never included `collegeId` in the token payload, so every `req.user.collegeId` read on the backend was silently `undefined`. Fixed as part of this: (1) `collegeId` is now signed into the JWT on login/register; (2) a real `College` model now backs the field (was a dangling ref before); (3) `collegeId` added to `Assessment`, `Submission`, `AssessmentAttempt`; (4) `assessments.repo.js`/`assessmentAttempts.repo.js`/`submissions.repo.js` by-id lookups now take a `collegeId` scope parameter (`{_id, collegeId}` in one query, 404s instead of leaking existence) used throughout `assessments.service.js` (`updateAssessment`, `deleteAssessment`, `lockAssessment`/`unlockAssessment`, `getAssessmentAttendance`, `getAssessmentAnalytics`, `listAssessmentAttempts`, `resolveChallenge`, etc.) and `submissions.service.js`'s `getSubmissionById`; `superadmin` bypasses scoping by design. `scripts/backfill_college_id.mjs` is a one-time idempotent script to stamp the existing single-tenant data with a real `College` row before this ships. **Known gap left open on purpose**: any user without a `collegeId` yet (pre-backfill, or the `/api/integration/*` service-key mock user) resolves to *unscoped* rather than *scoped-to-nothing* — run the backfill promptly, and note the integration partner's assessments still aren't stamped (same underlying gap as H3, needs the per-partner-key/externalId design, not solved here). 45/45 assessment-api tests still pass unmodified (none of them set `collegeId`, so they exercise the unscoped/legacy path). | `models/College.mjs`, `models/Assessment.mjs`, `models/Submission.mjs`, `models/AssessmentAttempt.mjs`, `src/services/auth.service.js`, `src/services/assessments.service.js`, `src/services/submissions.service.js`, `src/repositories/*.repo.js`, `scripts/backfill_college_id.mjs` |
| C3 | Faculty permission check always passes due to a boolean-logic bug | `assessment-api/src/services/questions.service.js:147` — `!(user.role === 'admin' \|\| user.role === 'superadmin' \|\| user.role === 'faculty')` — verified exactly as written | Any faculty account (regardless of college/ownership) can edit or overwrite any other faculty's private question. |
| C4 | Rate limiting doesn't cover the legacy route prefix | `assessment-api/src/app.js:66-72` — limiters mounted only under `/api/v1`, but `app.use("/api", routes)` mounts the identical router unprotected | Login brute-forcing is trivial by hitting `/api/auth/login` instead of `/api/v1/auth/login`. |
| ~~C5~~ | ~~Self-registration UI lets a user pick `admin`/`superadmin` as their own role~~ — **retracted, see note** | `frontend/src/pages/RegisterPage.jsx:124-129` | Initially flagged as exploitable via direct API call, but `assessment-api/src/routes/auth.routes.js:9` already gates `POST /api/auth/register` behind `verifyToken, authorizeRoles("superadmin")` — confirmed by `auth.test.js`, which explicitly asserts unauthenticated registration returns 401. So this is genuinely dead code (the component also isn't routed in `App.jsx`), not a live vulnerability. Downgraded to a Low/hygiene item: either wire it into an admin-only "create user" flow or delete it — it serves no purpose sitting unrouted in the bundle. (This was caught and reverted after an initial incorrect fix attempt — a reminder to check the full route→middleware→controller chain before trusting a single-file read.) |
| C6 | judge-service-go runs as **root** in production with the **Docker socket** and host `/tmp` bind-mounted | `docker-compose.prod.yml:149` (`user: root`), `:155` (`docker.sock`), `:156` (`/tmp:/tmp`) — overrides the Dockerfile's own non-root `app` user (`judge-service-go/Dockerfile:25,32`) | Any RCE or path-traversal bug in judge-service-go itself (not the sandboxed language containers — this is the *host* process) gives an attacker a root process with full control of the Docker daemon, trivially escalating to full host compromise. The excellent per-container sandbox hardening (see §2) does nothing to mitigate this, since it protects against escape *from* spawned containers, not compromise *of* the judge service itself. |
| C7 | A container-resource-reset call has no timeout, can hang forever, and silently starves the container pool | `judge-service-go/pkg/executor/executor.go:492` and `:664` — `e.UpdateContainerResources(context.Background(), ...)` ignores the caller's own context/timeout entirely | If Docker's daemon stalls even briefly (plausible under real concurrent load), the call blocks forever. Since a container is only released back to the pool after this returns, one stuck call permanently removes a container — with the default pool size of 2 per language, a couple of unlucky hangs during a burst silently zero out that language's entire capacity with no crash and no alert. |

### 🟠 High

| # | Finding | Location |
|---|---|---|
| H1 | `JWT_SECRET` has an insecure default (`"dev_secret_change_me"`) with **no** production fail-fast guard, unlike the other secrets | `assessment-api/src/config/env.js:11` |
| H2 | Unauthenticated ReDoS via unescaped `$regex` search on public endpoints | `assessment-api/src/services/problems.service.js:241`, `questions.service.js:17` |
| H3 | Integration "auth" for results is weaker than the other integration routes — `GET /api/integration/results/:_id` only requires `verifyService` (the shared `x-service-key`), not `verifyIntegrationStudent` like the other routes on the same router; `listAssessmentAttempts` then only checks `user.role !== 'student'`, and `verifyService` auto-fills `req.user = {role: 'admin'}` when no real user is attached | `assessment-api/src/routes/integration.routes.js:34`; `assessment-api/src/services/assessments.service.js:220-235` | Anyone holding the single shared `TESTING_PLATFORM_KEY` can pull the full attempt roster for **any** assessment ID by guessing/incrementing it. **Investigated, deliberately not changed**: `docs/INTEGRATION_GUIDE.md:86` documents this route's contract as "Auth: Service Key only (Backend-to-Backend)" — the exam-platform partner genuinely never sends a student JWT here, so bolting on `verifyIntegrationStudent` would break the live, documented integration, not just close a gap. There's also no `createdBy`/`externalId` marker distinguishing integration-created assessments (`createAssessment`'s controller passes `req.user._id`, which is `undefined` for pure service-key calls), so there's no data to scope by even if we wanted to. This is really C2/tenant-scoping wearing a different hat: as long as there's exactly one shared secret for the whole system, "any assessment" and "an assessment this partner should see" are the same set. Real fix requires the Phase 1 tenant model (or, short of that, a per-partner key + an `externalId` stamped at creation time to scope results lookups by). |
| ~~H4~~ | ~~Zero usage/submission metering anywhere — hard blocker for metered billing~~ — **fixed**: `submitSolution` now stamps `collegeId` onto the `SubmissionMessage` published to the queue (same struct `RetryCount`/C2 already extended); judge-service-go's `processAndStoreResults` writes one `usageevents` document per executed submission (`{collegeId, userId, submissionId, language, status, elapsedMs, createdAt}`), reusing the `SubmissionResult.ElapsedMs` the central runner / wrapper already computes rather than timing anything a second time. A new `UsageEvent` Mongoose model (`assessment-api/models/UsageEvent.mjs`) documents the schema/indexes for reporting even though the writes come from Go directly into the same collection (mirroring how judge-service-go already writes `submissions` directly). Best-effort: a metering-write failure is logged and never blocks or delays the submission's own result. **Known gap**: submissions that never execute (retry budget exhausted, `markSubmissionExecutionFailed`) emit no usage event — by design, since no compute was actually consumed — and any submission whose collegeId is empty (same pre-backfill / integration-mock-user gap as C2) is stored with no `collegeId` field rather than a zero-value one. | `judge-service-go/pkg/models/submission_message.go`, `judge-service-go/main.go` (`processAndStoreResults`, `processSubmission`), `assessment-api/src/services/submissions.service.js`, `assessment-api/models/UsageEvent.mjs` |
| H5 | Container pool has zero tenant isolation — one global pool per language, shared across all customers | `judge-service-go/main.go:55` (`defaultPoolSizePerLang = 2`), `pkg/pool/pool.go` | 
| ~~H6~~ | ~~No disk quota on the execution workspace bind mount~~ — **fixed**: `/app` is now a `size=512m` tmpfs (same pattern as the existing `/tmp` tmpfs), not a host bind mount, so writes made by the executed program are bounded and memory-backed instead of landing on real host disk. Confirmed safe: file delivery into the container already goes over the Docker `UploadToContainer` API (`copyFilesToContainer`), not the bind mount, and nothing ever reads generated files back from the host side afterward — the host directory is now purely a staging area for the Go process itself. | `judge-service-go/pkg/pool/pool.go` (`createContainer`) |
| ~~H7~~ | ~~Unbounded retry loop with no max-attempt cap~~ — **fixed**: `SubmissionMessage.RetryCount` now travels with the message; after `MaxSubmissionRetries` (12, ~60s at the retry queue's 5s TTL) the submission is marked failed in Mongo (`markSubmissionExecutionFailed`) and acked off the queue instead of retrying forever | `judge-service-go/pkg/models/submission_message.go`, `judge-service-go/main.go` (`processSubmission`) |
| H8 | JWT stored in `localStorage` — exfiltratable by any future XSS | `frontend/src/pages/LoginPage.jsx:21-22`, `src/api.js:60` |
| H9 | Exam countdown trusts the client's own clock; a student can stall a timer indefinitely by turning back their system clock | `frontend/src/pages/AssessmentWorkspace.jsx:163-168, 358-364` |
| H10 | Known-vulnerable `xlsx@0.18.5` dependency (unpatched prototype-pollution/ReDoS advisories) used for admin bulk-import | `frontend/package.json`, `assessment-api/package.json` |
| H11 | No replication/clustering for Mongo/Redis/RabbitMQ; the DB backup script targets the dev container name and would silently fail to find anything in the actual prod deployment | `scripts/backup_db.sh:15` vs. dev-only container name `codespace_mongo` in `docker-compose.yml:39` — prod compose sets no matching name |
| H12 | No horizontal-scaling path — judge-service-go binds a single host's Docker socket, sandbox images are built locally with no shared registry/orchestration | `docker-compose.prod.yml`, `.github/workflows/` |

### 🟡 Medium

- Contradictory CORS config (`origin: "*"` with `credentials: true` — browsers reject this combination outright), `assessment-api/src/app.js:47-51`.
- Error responses leak internals (`error.message` returned directly on 500s across `admin.routes.js`).
- Fragile `req.user.id` vs `req.user._id` coupling in submissions controller, held together by a single backfill line in `auth.mjs:12-14`.
- Duplicated compile/run command definitions across three places per language (`languages.go`, adapter files, and inline in `main.go`'s raw-run switch) — already caused one real drift (Go's offline-build fix wasn't applied to the legacy path).
- Leftover exploratory/debug comments shipped to `main` (`judge-service-go/pkg/central/adapters/csharp.go:27-33`).
- `JavaAdapter` reads templates via a relative-path `os.ReadFile` bypassing the shared `wrapper.GenerateWrapper` helper every other adapter uses — a second, divergent code path.
- Inconsistent API versioning on the frontend (some calls hit `/api/v1/...`, others the legacy `/api/...`), silently swallowed into `console.error` if it ever breaks.
- Local-draft-over-server-draft merge on assessment resume with no conflict warning (`AssessmentWorkspace.jsx:130-137`).
- CI runs tests only — no dependency audit, no secret scanning, no lint gate.
- Frontend has no in-repo prod deployment/health config at all (explicitly excluded from `docker-compose.prod.yml`).

### 🟢 Low / Code Quality

- `fmt.Sscanf` used for env-var integer parsing instead of `strconv.Atoi`.
- `/health`, `/stats`, `/run`, `/raw-run` on judge-service-go have no auth of their own — acceptable only under the network-topology assumption that the service is never exposed publicly, which is a single misconfiguration away from being wrong.
- `Math.random()` used for exam problem-order shuffling (not currently security-relevant).
- Console-only, unstructured logging throughout `assessment-api`.
- Duplicated IDE/run/submit logic between `AssessmentWorkspace.jsx` and `ProblemPage.jsx` instead of a shared hook.
- No `.env.example` to steer new environments away from dev-default secrets.
- No secrets-rotation mechanism for the two static shared-secret integrations.

---

## 2. What's Already Solid (don't rebuild this)

The actual sandbox hardening for **executing untrusted code** is good and shouldn't be second-guessed:
- `NetworkMode: "none"`, `ReadonlyRootfs: true`, `CapDrop: ALL` / `CapAdd: KILL`, `no-new-privileges`, and a 128 PID limit are all correctly applied per pooled container (`judge-service-go/pkg/pool/pool.go:467-482`).
- No host env vars/secrets are ever injected into execution containers.
- Per-submission workspaces are isolated with symlink/path-escape validation (`pkg/workspace/safety.go`) and cleaned up between reuses.
- Function names are regex-sanitized before being spliced into generated source; all compiler/interpreter invocations pass args via the Docker exec API as argv arrays, never through a shell string — no shell-injection path was found from user-controlled code.
- No secrets or credentials were ever committed to git history (verified via full-history search) — general git hygiene on secret handling has been good, aside from two old vendored `node_modules` trees.

The gap is entirely at the *host/platform* layer (C6, C2/C3, H1-H7), not in the untrusted-code sandbox itself.

---

## 3. Realistic SaaS Roadmap

Grounded in the actual codebase state above, not the aspirational plan. Ordered by what blocks the pivot vs. what's a later differentiator.

### Phase 0 — Stop the bleeding (before any customer conversations)
Fix the Critical findings. All are contained, well-understood changes, not architecture rewrites:
- Remove the `TESTING_PLATFORM_KEY` fallback default (C1); add the same `NODE_ENV==='production'` fail-fast guard to `JWT_SECRET` (H1).
- Fix the `questions.service.js` boolean bug (C3) — one-line fix.
- Extend rate limiting to the legacy `/api` prefix, or remove the legacy prefix entirely if nothing still depends on it (C4).
- Decide `RegisterPage`'s fate: delete it, or wire it up with role locked server-side (C5) — audit the actual `/api/auth/register` handler's trust of the `role` field regardless.
- Stop overriding judge-service-go back to root in prod; if the Docker socket must stay mounted, scope it via a proxy (e.g. Tecnativa's docker-socket-proxy) rather than raw access (C6).
- Add a timeout to the `UpdateContainerResources` call in `executor.go` so a Docker stall can't permanently starve the pool (C7).

### Phase 1 — Real multi-tenancy

This is the actual "evolution" the business needs, not the multi-problem-model strategy pattern from the old plan. Scoped against the real schema, not in the abstract:

**C2 — tenant scoping — implemented** (see the C2 entry in §1 for the full diff and the JWT bug found along the way; `scripts/backfill_college_id.mjs` still needs to be run against production before/at cutover).
- The `collegeId` pattern already exists on `User` (`models/User.mjs:21`) and `Question` (`models/Question.mjs:14`, plus a real `visibility: Private/College/Public` enum) — but there is **no `College` model backing it**; it's a dangling `ObjectId` ref with no collection. Since a real `College`/tenant anchor is needed anyway as the Phase 2 billing subject (a subscription belongs to a college, not a user), create that model first rather than inventing a parallel `tenantId` field — two competing scoping keys on the same documents is worse than one done properly.
- Add `collegeId` to `Assessment`, `Submission`, `AssessmentAttempt` (all three currently have zero tenant field). `Problem` intentionally stays global/shared — confirm with the business that the problem bank is meant to be a shared library across all customers (like the current single-tenant reality suggests), not per-tenant content; if a customer ever wants private problems, that's what `Question` already models.
- Migration is cheap right now: production is single-tenant today, so backfilling `collegeId` on every existing `Assessment`/`Submission`/`AssessmentAttempt` row with the one real college is a one-time script, not a data-modeling problem. Get the field in place *before* the second customer signs, not after.
- Enforcement pattern (matches `questions.service.js:135`'s existing `if (!data.collegeId && user.collegeId) data.collegeId = user.collegeId`): derive `collegeId` server-side from `req.user.collegeId`, never accept it from the request body. Push the check down into the repo layer (`assessments.repo.js`, `assessmentAttempts.repo.js`, `submissions.repo.js`) as a required parameter on every by-id lookup — e.g. `findById(id, collegeId)` que­ries `{_id: id, collegeId}` in one shot and 404s instead of leaking existence, rather than today's fetch-then-trust-the-caller pattern in `assessments.service.js` (`updateAssessment`, `deleteAssessment`, `lockAssessment`, `getAssessmentAttendance`, `getAssessmentAnalytics` all take just an `id`). A signature change at the repo layer makes "forgot to scope this one" a compile-time-visible gap instead of a silent one. `superadmin` bypasses scoping (cross-tenant support access); `admin`/`faculty`/`student` are always scoped to their own college.
- This closes H3 as a side effect: once integration-created assessments get stamped with a `collegeId` (or a per-partner-key-derived id) the same way, `/results/:_id` can filter by it instead of trusting the shared secret to imply "any assessment."

**H4 — usage metering — implemented** (see the H4 entry in §1 for the full diff).
- Currently zero: `submissions.service.js` and `problems.service.js` do not persist duration, counts, or any aggregate anywhere — confirmed by reading `submitSolution`/`rejudgeSubmission` end to end.
- judge-service-go already computes real wall-clock execution time per submission (`main.go:471`, `elapsedMs := time.Since(start).Milliseconds()`, stored today only inside the per-submission `TimeMs` result field) — that's the actual compute-seconds signal billing needs, and it's computed in exactly one place. Add a second, small write there: a `usage_events` (or `UsageEvent` Mongo collection) insert of `{collegeId, userId, language, submissionId, elapsedMs, outcome, createdAt}` alongside the existing submission-result write, rather than trying to reconstruct usage later from `Submission.createdAt`/`updatedAt` deltas (lossy, and couples metering to document mutation timing).
- `collegeId` needs to reach judge-service-go for this to be taggable — either stamp it onto the `SubmissionMessage` payload in `submissions.service.js`'s `submitSolution` (same struct `RetryCount` just got added to) or resolve it by joining back through `Submission.userId → User.collegeId` in an aggregation step. Carrying it on the message is simpler and avoids a query per event.
- This is additive and low-risk — it doesn't touch the execution or grading path, just appends one write next to a write that already happens.

**H5 — pool tenant isolation**
- `judge-service-go/main.go:1277` creates exactly one process-wide `pool.NewPool` sized by `defaultPoolSizePerLang = 2` (main.go:55) — pools are keyed by language only, `Acquire(ctx, langID)` has no tenant dimension at all.
- Important constraint from the measured VPS ceiling (already documented separately): the box is CPU-bound with a small measured throughput ceiling per language. **Literal per-tenant pools would fragment already-scarce capacity, not fix isolation** — splitting 2 containers per language across N tenants gets worse, not better, as N grows. The real near-term fix isn't dedicated pools, it's fair scheduling on top of the shared one: a per-`collegeId` submission rate limit/quota (ties directly into the H4 usage events above — same data feeds both), so one noisy tenant can't starve acquisition for everyone else while waiting on Phase 3's actual scale-out (H12, dedicated capacity per tenant or horizontal nodes).
- Concretely: add a token-bucket or sliding-window limiter keyed by `collegeId` at submission-publish time (`submissions.service.js:submitSolution`, before `publishSubmissionMessage`) rather than inside judge-service-go — rejecting over-quota submissions before they ever enter the queue is cheaper than rejecting them after a container was already tied up.

**Sequencing**: C2's `College` model + `collegeId` backfill has to land first — H4's events and H5's quotas are both keyed by it. Do C2 → H4 → H5 in that order, not in parallel.

### Phase 2 — Billing & self-serve
- Stripe (or equivalent) subscription integration, tied to the Phase 1 tenant model and metering events.
- Self-serve signup/onboarding flow, admin console for plan/seat management.
- Usage-limit enforcement (soft warnings + hard caps) surfaced in the frontend — `isPremium` already exists as an inert flag on `Problem`; this is where it'd actually get wired to something.

### Phase 3 — Scale-out infrastructure
- Address H12: get sandbox images into a registry, decouple judge-service-go from a single host's Docker socket (e.g. a Docker-in-Docker or Kubernetes-Jobs-based executor pool) so judge capacity can scale horizontally across nodes — directly motivated by the CPU-bound ceiling already measured on the current single VPS (~7 req/s for interpreted languages, ~8-12 req/min for slow-compile languages).
- Real DB/queue replication and a working, tested backup/restore path (H11).
- CI gates: dependency audit, secret scanning, lint, before any deploy.

### Phase 4 — Differentiation (where the old plan's ideas fit)
Only after 0-3 are done does the original multi-model vision make sense as a real feature investment:
- `ProblemType`/`ExecutionStrategy` abstraction, STDIN-style competitive-programming problems as a first-class type (not just the external raw-execution shim), then Interactive/SQL/Notebook as the market actually asks for them.
- Weighted scoring, custom checkers (special judge) — genuine differentiators once the tenancy/billing foundation exists to sell them against.

---

## 4. Sources

Four parallel subsystem audits (assessment-api, judge-service-go, frontend, infra/deployment/secrets), each independently researched, then cross-checked: docker-compose user/socket/mount config, the questions-service permission bug, the frontend route-guard gap, the dead `RegisterPage`, and the no-timeout executor call were all re-verified directly against source before inclusion in this report.
