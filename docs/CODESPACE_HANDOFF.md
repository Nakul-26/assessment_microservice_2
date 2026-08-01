# Codespace / Docker environment handoff

This file exists because the work below was planned and partly implemented from a Windows
machine with **no Docker, no Go toolchain, and no browser automation** — so a lot of it is
"implemented but unverified" or "deliberately not attempted because it needs Docker." That
prior session's chat history and its local memory system do **not** carry over to a fresh
`claude` terminal session in GitHub Codespace — this doc is the handoff artifact so nothing
gets lost. Read this first, then `docs/PLATFORM_AUDIT_AND_SAAS_ROADMAP.md` (full findings +
roadmap) and `docs/LOCAL_TESTING_NOTES.md` (per-item verification recipes) for full detail —
both are already up to date as of this handoff.

Repo state at handoff: everything below is **already committed to `main`** (nothing
uncommitted, nothing waiting on `git add`). This is a to-do list for the next session, not a
list of pending diffs.

---

## Priority 1 — Verify things that are already implemented (fast, do these first)

Nothing here is expected to fail — these are fixes made without the tooling to confirm them.
Treat any failure as a real bug to fix, not a false alarm.

1. **Go toolchain sanity check** (`judge-service-go/`, no Go available outside Docker/Codespace):
   ```
   go build ./...
   go vet ./...
   go test ./...
   ```
   Covers several unverified changes at once: `strconv.Atoi` env parsing, the Go
   `CompileCmd` dedup (`languages.go`/`GoAdapter`/`main.go` raw-run switch all now share one
   source), the `wrapper.GenerateWrapper` dead Java-template branch removal, and the C7
   executor timeout fix. Pay particular attention to `go_integration_test.go` and, if
   `JUDGE_CENTRAL_COMPARE_JAVA=false` is ever actually exercised in that env,
   `java_integration_test.go` with it set.

2. **`scripts/backup_db.sh`** (H11's concrete bug fix):
   ```
   docker compose up -d mongo   # dev stack — container_name: codespace_mongo
   ./scripts/backup_db.sh       # should auto-detect codespace_mongo
   ```
   Then simulate the prod case (no explicit `container_name`, e.g. run against
   `docker-compose.prod.yml`'s mongo service or a manually-renamed container) and confirm it
   still finds the right container via `docker ps --filter name=mongo` without needing
   `MONGO_CONTAINER_NAME`. Also stop all mongo containers and confirm the script exits with
   "No running mongo container found" instead of silently writing an empty backup.

3. **H4 usage metering** — confirm `usageevents` is actually being populated:
   ```js
   db.usageevents.find().sort({ createdAt: -1 }).limit(5)
   ```
   after running a submission end-to-end. Confirm `collegeId` is populated for a normal user
   and `elapsedMs` is a sane positive number.

4. **H8 cookie auth + CSRF check** — needs a running frontend + browser:
   - Log in, open DevTools → Application → Cookies: confirm a `token` cookie exists, is
     `HttpOnly`, and does **not** show up in `document.cookie`.
   - Confirm subsequent API calls succeed with no `Authorization` header (Network tab).
   - Log out, confirm the cookie clears and a subsequent protected-route call 401s.
   - Confirm `/api/integration/*` and `/api/judge0/*` (external partners, Bearer-header/shared
     -secret only, never send cookies) still work unaffected —
     `assessment-api/src/middleware/auth.mjs`'s `extractToken` checks the cookie first but
     falls back to the `Authorization` header.

5. **H10 `exceljs` migration** — needs a browser:
   - `/admin/users` bulk-import: upload a real student-roster `.xlsx`, confirm rows parse.
   - Download the sample template, credentials export, all-users export, and the
     assessment-results export (`/admin/assessments/:id/results`) — open each in a real
     spreadsheet app (Excel/LibreOffice) to confirm they're valid files, not just that the
     download fires.

6. **Draft-conflict banner** (`AssessmentWorkspace.jsx`): start an attempt in one tab, let the
   draft autosave, then in DevTools hand-edit `localStorage`'s
   `assessment-draft:<attemptId>`'s `savedAt` to an old timestamp (e.g. `1`) and reload —
   should show a dismissible "Draft conflict" warning banner.

7. **`problemDifficultyStats` analytics fix** (`submissions.service.js`'s `getMyAnalytics`) —
   no test coverage yet: seed a student with a mix of Easy/Medium/Hard solved submissions
   where `problemId` arrives pre-populated (normal `findByUserId` path), call
   `GET /api/v1/submissions/my/analytics`, confirm the average-difficulty figure reflects the
   seeded mix instead of defaulting to "Medium".

8. **`scripts/test_submission.js` harness login 401** — unresolved investigation, not a fix:
   ```
   HARNESS_LANGUAGES=python node scripts/test_submission.js
   ```
   against a local stack. Against the live site this got a `401 {"message":"No token"}` on
   `POST /api/auth/login` for the harness account, which is suspicious since `/auth/login` has
   no `verifyToken` middleware in front of it. A direct `curl` with wrong credentials
   correctly returned `{"message":"Invalid credentials"}`, so the route itself isn't broken —
   likely the harness account doesn't exist on that DB, or `registerOrLogin()`'s fallback to
   `/auth/register` fails because that route is now `superadmin`-only post-multi-tenancy. May
   need a seeded harness user/college, or an updated harness that can bootstrap one.

---

## Priority 2 — Real implementation work that needs Docker (not just verification)

9. **C6 remainder — scope the Docker socket via `docker-socket-proxy`**. Currently
   judge-service-go runs non-root but still has the raw `/var/run/docker.sock` bind-mounted
   with full, unscoped Docker API access. Stand up `docker-compose.prod.yml` locally, add a
   `docker-socket-proxy` (e.g. Tecnativa's) allow-listing only the endpoints actually used
   (grep `judge-service-go/pkg/pool/pool.go` and `pkg/executor/executor.go` for the exact
   Docker client calls — container create/start/stop/remove, exec create/start/attach,
   copy-to-container, container update for the resource-limit reset), point judge-service-go's
   Docker client at the proxy via `DOCKER_HOST`, and run the full `go test ./...` (includes
   real container-spawning tests) against it **before** this ever touches
   `coding.fortifyhub.net`. Getting the allow-list wrong silently breaks code execution for
   every tenant — this is the reason it was deferred rather than guessed at blind.

10. **H11 remainder — real replication + tested restore path** for Mongo/Redis/RabbitMQ. The
    backup script itself is fixed (see Priority 1 #2); there is still no replication/clustering
    and no one has ever actually run a *restore* from one of these backups. Worth doing a full
    backup → simulate data loss → restore → verify drill before calling this closed.

11. **H12 / Phase 3 — horizontal scale-out**. judge-service-go is bound to a single host's
    Docker socket with sandbox images built locally, no shared registry. Motivated by the
    already-measured CPU-bound ceiling on the current VPS (~7 req/s interpreted languages,
    ~8-12 req/min slow-compile languages — see the `capacity_vps_limits` context, or just
    re-measure). Real work: get sandbox images into a registry, decouple judge-service-go from
    one host (Docker-in-Docker or Kubernetes Jobs-based executor pool).

12. **CI gates smoke test**. `.github/workflows/ci.yml` now has `security-audit` (npm audit /
    audit-ci), `secret-scan` (gitleaks), and blocking lint on both `assessment-api` and
    `frontend`. These have not been watched run green on an actual push from this repo yet —
    push a trivial branch/PR (or trigger via `gh workflow run` / `act` locally if available) and
    confirm all jobs pass, especially `assessment-api`'s lint (recently flipped from
    non-blocking to blocking) and the `frontend` `audit-ci` allowlist for its one
    documented-unfixable `react-router` advisory.

13. **`scripts/backfill_college_id.mjs`** — still needs to be run against the real production
    database before/at any second-customer cutover (per the C2 tenant-scoping fix). Confirm
    it's idempotent-safe to run again if it's ever unclear whether it already ran, then run it
    for real once there's DB access to prod (or its staging equivalent).

---

## Priority 3 — Known-open items that don't strictly need Docker, but need either a browser or a bigger design call (lower priority, do after 1-2)

- **H3** — integration `/results/:_id` auth is weaker than other integration routes (service-key
  only, no per-assessment scoping). Deliberately left as-is: the documented partner contract
  (`docs/INTEGRATION_GUIDE.md:86`) says service-key-only is the intended auth for this route,
  and there's no `externalId`/`createdBy` marker to scope by yet. Real fix needs a per-partner
  key + `externalId` design, not a quick patch — see the H3 entry in the roadmap doc for the
  full reasoning before touching this.
- **IDE/run/submit logic dedup** between `AssessmentWorkspace.jsx` (1250 lines) and
  `ProblemPage.jsx` (539 lines) into a shared hook. Needs a browser to verify a refactor of the
  live code-run/submit path (used in both graded exams and practice mode) doesn't regress
  either flow.
- **Other language adapters' `CompileCommand`/`RunCommand` dedup** (only Go's was unified —
  the others append per-language wrapper-protocol args, so it's a bigger, untested refactor of
  the sandbox execution path). Needs Docker + each language's toolchain to verify safely.
- **Secrets rotation** — no mechanism exists for `TESTING_PLATFORM_KEY`/`JUDGE0_SHIM_KEY`
  (static shared secrets for the two external integrations).
- **Console-only, unstructured logging** throughout `assessment-api` — no structured
  logger/log aggregation.
- **No in-repo frontend prod deployment/health config** (`docker-compose.prod.yml` explicitly
  excludes the frontend today — there's no deployed frontend at all yet).
- **Phase 4** (the old aspirational multi-model `ProblemType`/`ExecutionStrategy` plan) is
  fully unstarted and intentionally deprioritized until Phases 1-3 are solid — don't pick this
  up early even if it looks appealing; see §0 and §3 of the roadmap doc for why.

---

## Where to look for more detail

- `docs/PLATFORM_AUDIT_AND_SAAS_ROADMAP.md` — the full findings table (every item above has a
  fuller writeup there, searchable by its ID: C6, H3, H11, H12, etc.) and the phased roadmap.
- `docs/LOCAL_TESTING_NOTES.md` — per-item "what to run, what to expect" recipes for most of
  the Priority 1 items above (this doc's §1-§7 map onto Priority 1 #2-#7 here).
- `docs/INTEGRATION_GUIDE.md` — the documented contract for `/api/integration/*`, relevant to
  H3.
