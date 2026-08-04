# Codespace / Docker environment handoff

## 🔴 ACTIVE INCIDENT — read this section first

**Production submissions are down** at `coding.fortifyhub.net` (the judge0-shim-only deployment
— no frontend deployed there, just `/api/judge0/*` and `/api/integration/*` consumed by an
external exam platform). This was discovered and is being actively debugged; it is NOT resolved.
Continue from here — don't re-derive this from scratch.

### How to test

```
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X POST \
  'https://coding.fortifyhub.net/api/judge0/submissions?base64_encoded=true&wait=true' \
  -H 'Content-Type: application/json' \
  -H 'x-rapidapi-key: <JUDGE0_API_KEY from .env>' \
  -d '{"language_id":71,"source_code":"'"$(printf 'print(1)' | base64 -w0)"'","stdin":""}'
```
`language_id: 71` = python (see `LANGUAGE_ID_MAP` in `judge0Shim.service.js` for others).
`stdout`/`stderr`/`compile_output` in the response are base64 — decode to read them. A passing
run looks like `status.id: 3` (ACCEPTED) with the program's real stdout.

### Regressions found and fixed so far (all committed to `main`)

The whole chain started from the C6 non-root-hardening change (judge-service-go now runs as a
non-root `app` user instead of root) plus a `/app` tmpfs migration (`e38d1f3`, multi-tenancy
commit) — three independent regressions surfaced sequentially as each was fixed and the next
error appeared:

1. **Workspace dir permission-denied** (`mkdir /tmp/judge-workspaces/judge-XXXX: permission
   denied`) — a host dir left root-owned from before the non-root switch. **Fixed** (commit
   `27676d2`): renamed `RootDir` in `judge-service-go/pkg/workspace/manager.go` from
   `/tmp/judge-workspaces` to `/tmp/judge-exec-workspaces` so the non-root user creates (and
   owns) a fresh dir instead of needing host access to chown the old one. **Confirmed fixed** —
   error stopped appearing in logs after this deployed.

2. **Docker socket permission-denied** (`dial unix /var/run/docker.sock: connect: permission
   denied`) — `DOCKER_GROUP_GID` in `docker-compose.prod.yml`'s `group_add` defaulted to `999`,
   didn't match the host's real Docker group GID. **Fixed**: user ran
   `stat -c '%g' /var/run/docker.sock` inside the judge-service-go container terminal (via
   Dokploy's UI — no host/SSH terminal access exists, only container terminals), got `992`, set
   `DOCKER_GROUP_GID=992` as a Dokploy env var and redeployed. **Confirmed fixed** — no more
   "no available containers" 503s.

3. **File upload to container 404s** (`failed to upload files to container: API error (404):
   Could not find the file /app/sub-raw-... in container ...`) — **root cause identified, fix
   deployed but NOT YET CONFIRMED WORKING, this is where debugging stopped**. Commit `e38d1f3`
   switched the sandbox containers' `/app` from a host bind-mount to a tmpfs mount (deliberate —
   stops a submission from filling host disk), but nothing accounted for the fact that the
   per-submission subdirectory (`/app/sub-<id>`, created by `workspace.NewSubmissionWorkspace`
   via `os.MkdirTemp` on the HOST staging dir) used to auto-exist inside the container via the
   bind mount and now doesn't exist in the tmpfs at all until something creates it there.
   Docker's `PutContainerArchive`/`UploadToContainer` requires the destination directory to
   already exist, hence the 404. **This affects every submission path**, not just the raw-run
   shim — `RunInContainerStream`/`CompileInContainer` (the real exam-grading path) share the
   same `copyFilesToContainer` function.

   **Fix applied** (commit `713bf50`, `judge-service-go/pkg/executor/executor.go`):
   `copyFilesToContainer` now execs `mkdir -p <containerWorkDir>` as root inside the target
   container before uploading the tar (same pattern as the existing root-exec `/tmp` cleanup
   step in `RunRawWithStdin`). Also see commit `b379135` (`judge0Shim.service.js`) — a
   *separate*, already-confirmed-working fix that surfaces `raw.error` into the `stderr` field
   of the shim's response, since previously an internal judge-service-go error came back to the
   client as empty `stdout`/`stderr` with no indication anything was wrong — that's what made
   this diagnosable via curl at all.

   **Why this isn't confirmed fixed yet**: after what was reported as a full rebuild + redeploy
   (container IDs in the error response were cross-checked against the freshest pool-warmup log
   and do match the newest process), the live test **still returns the exact same 404** with no
   change in error shape (no "failed to create workspace dir" wrapper message, which the new
   mkdir-failure path would produce — meaning either the mkdir exec is succeeding but the
   upload still can't see the directory, or commit `713bf50`'s code still isn't the binary
   actually running). This was not resolved before handing off to Codespace.

### Next steps (do these first, in order)

1. **Confirm the running binary actually matches `713bf50`.** Don't trust "a rebuild was done"
   at face value again — from a real Docker-capable terminal, rebuild judge-service-go
   explicitly (`docker compose -f docker-compose.prod.yml build --no-cache judge-service-go` or
   equivalent) and confirm the build step actually recompiles (watch for real `go build` output,
   not a cache hit), before redeploying.
2. If the binary is confirmed current and the 404 still happens, **exec into a live sandbox
   container directly** (`docker exec -it <containerId> sh`) while judge-service-go is idle and
   manually run `mkdir -p /app/sub-test && ls -la /app/` to check: does the mkdir actually
   succeed as root under this tmpfs mount (`rw,nosuid,nodev,size=512m`, see `pool.go`'s
   `createContainer`)? Does the directory persist / is it visible via a fresh `docker exec`?
   This isolates "mkdir doesn't actually work under this tmpfs for some reason" from "the new
   code isn't running."
3. Also worth checking directly: does `fsouza/go-dockerclient`'s `UploadToContainer` (calls
   Docker's `PUT /containers/{id}/archive`) have some quirk with tmpfs-mounted destinations
   specifically vs regular overlay filesystem paths — e.g. try uploading to a non-tmpfs path in
   the same container (there isn't an obvious one here, but worth a literature check) or add a
   temporary debug log right before/after the mkdir exec call in `copyFilesToContainer`
   (`judge-service-go/pkg/executor/executor.go`, ~line 178) printing the mkdir's own stdout/
   stderr/exit code, since right now a mkdir failure would be silent unless it hits the wrapped
   error return.
4. Once fixed and confirmed via the curl test above returning `status.id: 3`, also smoke-test at
   least one **compiled** language (e.g. `language_id: 62` for Java, or `54` for C++) since
   compilation exercises the same workspace path but with an extra exec step — the interpreted
   Python-only testing so far hasn't covered that.

### Constraints to remember

- **No host/VPS terminal access at all** — only container terminals via Dokploy's UI. Any fix
  must be deployable through code + Dokploy env vars/redeploy, never a host-level command.
- User handles all `git commit`/`push`/Dokploy redeploy actions themselves — report fixes as
  ready, don't ask permission to commit/deploy, and don't attempt it directly.
- Live secrets for testing (`JUDGE0_API_KEY`, etc.) are in the repo's `.env` file (gitignored,
  already present on this machine).

---

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
