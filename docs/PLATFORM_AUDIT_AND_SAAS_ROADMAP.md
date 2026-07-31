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
| C2 | No tenant/college scoping enforced on core entities (`Assessment`, `Submission`, `Problem`, `AssessmentAttempt`) | `assessment-api/src/services/assessments.service.js` — `updateAssessment`, `deleteAssessment`, `lockAssessment`/`unlockAssessment`, `getAssessmentAttendance`, `getAssessmentAnalytics` take only an `id`, no ownership/college check | Any faculty/admin account from Customer A can update, delete, lock, or pull the full roster analytics for Customer B's assessment by guessing/incrementing a Mongo ObjectId. **This is the actual hard blocker for multi-tenant SaaS**, not the missing architecture from the pasted plan. |
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
| H3 | Integration "auth" for results is effectively any valid student JWT — no ownership check | `assessment-api/src/middleware/integration.mjs:28-32`; `GET /api/integration/results/:_id` has no auth beyond the shared service secret |
| H4 | Zero usage/submission metering anywhere — hard blocker for metered billing | `submissions.service.js`, `problems.service.js` |
| H5 | Container pool has zero tenant isolation — one global pool per language, shared across all customers | `judge-service-go/main.go:55` (`defaultPoolSizePerLang = 2`), `pkg/pool/pool.go` | 
| H6 | No disk quota on the execution workspace bind mount (only `/tmp` is capped) | `judge-service-go/pkg/pool/pool.go:465-481` — a submission writing a huge file can fill the host disk and take down every tenant at once |
| H7 | Unbounded retry loop with no max-attempt cap — a stuck submission can bounce between queues forever instead of surfacing as failed | `judge-service-go/main.go:850-864`, `:1360-1374` |
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
This is the actual "evolution" the business needs, not the multi-problem-model strategy pattern from the old plan:
- Add a proper `tenantId`/`organizationId` to every core entity (`Assessment`, `Submission`, `Problem`, `AssessmentAttempt`) and enforce it at the repository/query layer, not just ad hoc in individual services — the `collegeId` pattern already exists on `User`/`Question`, extend it consistently and add a query-layer guard so a missing check can't happen again.
- Add per-tenant rate limits and quotas (ties into H4/H5).
- Add usage metering (submissions run, compute-seconds consumed) as first-class events — this is the foundation billing will read from.

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
