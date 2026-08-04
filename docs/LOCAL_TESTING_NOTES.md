# Local/Docker-only testing notes

Things that came up while working against the live deployment (coding.fortifyhub.net)
that need Docker/DB access to actually verify — to check once the GitHub Codespace is up.

## 1. H4 usage metering — confirm `usageevents` writes (unverified)

`judge-service-go` now writes one document per executed submission to the `usageevents`
collection (`{collegeId, userId, submissionId, language, status, elapsedMs, createdAt}`),
inserted from `processAndStoreResults` in `judge-service-go/main.go`. This is deployed and
live (build succeeded on Dokploy), but I have no Mongo connection string in this environment
to confirm the collection is actually being populated correctly, or that `collegeId`/`elapsedMs`
are non-empty on real submissions.

**To check in Codespace**: run a submission end-to-end, then:
```js
db.usageevents.find().sort({ createdAt: -1 }).limit(5)
```
Confirm `collegeId` is populated for a normal (non-integration, non-legacy) user, and
`elapsedMs` is a sane positive number.

## 2. `scripts/test_submission.js` harness login fails against the live site

Ran the harness against `https://coding.fortifyhub.net/api` (`HARNESS_LANGUAGES=python`).
It got past `GET /api/problems` (API ready), then `POST /api/auth/login` for the default
harness account (`judge-harness@example.com` / `HarnessPass123!`) returned:

```
HTTP 401 {"message":"No token"}
```

That exact message string only originates from `verifyToken` in
`assessment-api/src/middleware/auth.mjs:7` — but `/auth/login` itself has no `verifyToken`
middleware in front of it (checked `auth.routes.js` and the route aggregator `index.js`).
A direct `curl` to the same endpoint with deliberately wrong credentials correctly returned
`{"message":"Invalid credentials"}`, so the route itself behaves normally for at least one
input. This suggests something specific to the harness account/request (maybe it doesn't
exist on this DB pre-C2-backfill, or some other code path) rather than a broken login route,
but I couldn't dig further without DB access or without sending real-looking credentials
repeatedly against a live site (avoided doing that from here).

**To check in Codespace**: reproduce locally against a docker-compose stack; if the harness
account doesn't exist yet, `registerOrLogin()` should fall back to registering it — but note
`/auth/register` is now `superadmin`-only post-C2 (`auth.routes.js:9`), so the harness's
open-registration fallback may need a superadmin bootstrap token to work at all in any
environment where public registration is disabled. Worth deciding whether the harness needs
updating for the C2 world, or whether a seeded harness user/college should exist ahead of time.

## 3. C6 remainder — scope the Docker socket via docker-socket-proxy

`judge-service-go` no longer runs as `root` (fixed — now `group_add: DOCKER_GROUP_GID` against
the Dockerfile's non-root `app` user), which closes the worst part of C6 (any RCE in the judge
service escalating straight to a root process with full Docker daemon control). What's still
open: the raw Docker socket (`/var/run/docker.sock`) is still bind-mounted directly into the
container with unscoped access to the whole Docker API, rather than going through something
like Tecnativa's `docker-socket-proxy` that only allow-lists the specific endpoints actually
needed (container create/start/stop/remove, exec create/start/attach, copy-to-container,
container update for the resource-limit reset in `executor.go`).

Deliberately not implemented yet: getting the proxy's allow-list wrong would silently break
code execution for every tenant in production, and there's no way to exercise
container-spawn/exec/upload/resource-update behavior against a proxied socket without a real
Docker environment — not testable from this Windows/no-Docker environment.

**To do in Codespace**: stand up `docker-compose.prod.yml` locally with Docker available, add
a `docker-socket-proxy` service scoped to just the endpoints judge-service-go actually calls
(grep `judge-service-go/pkg/pool/pool.go` and `pkg/executor/executor.go` for the exact Docker
client calls in use), point judge-service-go's Docker client at the proxy instead of the raw
socket via `DOCKER_HOST`, and run the full integration test suite (`go test ./...` in
`judge-service-go`, which includes real container-spawning tests) against it before ever
deploying the change to coding.fortifyhub.net.

## 4. H8 cookie-auth and H10 exceljs migration — need a browser, unverified here

Both changes are automated-test-covered (backend: 4 new supertest cases in `auth.test.js`
covering cookie-only auth, logout clearing the cookie, the CSRF-lite header check, and
Bearer-header-only still working; frontend: build + existing unit tests pass) but neither can
be smoke-tested end-to-end from this Windows/no-browser-automation environment. Since there is
no deployed frontend yet (per [[deployment_and_testing]]), this can only be checked once one is
stood up (locally or in the Codespace):

- **Cookie auth**: sign up/log in via a running frontend, open DevTools → Application → Cookies,
  confirm the `token` cookie is present, `HttpOnly` is checked, and `document.cookie` does NOT
  show it. Confirm subsequent API calls succeed with no `Authorization` header sent (Network
  tab). Click logout, confirm the cookie disappears and a subsequent protected-route call 401s.
- **exceljs migration**: on `/admin/users`, upload a real student-roster `.xlsx` file via the
  bulk-import form and confirm rows parse correctly (this is the actual untrusted-input path
  the H10 CVE concerned — `XLSX.read`/`sheet_to_json` replaced with `exceljs`-backed
  `readWorkbookRows`). Download the sample template, credentials export, and all-users export,
  plus the assessment-results export on `/admin/assessments/:id/results`, and open each in a
  real spreadsheet app to confirm they're valid `.xlsx` files, not just that the download fires.

**To check in Codespace/locally**: `docker-compose up` (or `npm run dev` in `frontend/` against
a local `assessment-api`), then walk through both bullets above in a real browser.

- **Draft-conflict banner** (added in the Medium-findings cleanup pass): start an assessment
  attempt in one browser tab, let the draft autosave to the server, then open `localStorage`
  in DevTools and hand-edit `assessment-draft:<attemptId>`'s `savedAt` to an old timestamp
  (e.g. `1`) — reloading the workspace should show the dismissible "Draft conflict" warning
  banner. Unverified here since it needs a live attempt + browser DevTools.

## 5. judge-service-go compile-command dedup and dead-code removal — no Go toolchain here

This environment has no Go toolchain at all (`go`/`gofmt` not found), so `judge-service-go`'s
changes from the Medium-findings cleanup pass were reviewed by hand only, not built or tested:

- `pkg/languages/languages.go`: Go's `CompileCmd` now includes the offline-safe env vars
  (`GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GO111MODULE=on GOTOOLCHAIN=local`) that were
  previously only applied to the raw-run legacy path in `main.go`.
- `pkg/central/adapters/go.go`: `GoAdapter.CompileCommand()` now delegates to
  `languages.GetLanguage("go").CompileCmd` instead of a second hardcoded copy.
- `main.go`'s `rawRunFilesAndCommands` Go case now uses `lang.CompileCmd` directly.
- `pkg/wrapper/generator.go`: removed the `lang.ID == "java"` branch (and its
  `buildJavaTestLiterals`/`numericToInt`/`escapeForJavaString` helpers) — it built a Go
  `text/template` from a file that only contains plain `{{FUNCTION_NAME}}` markers, which
  would fail to parse. This branch is only reachable via `JUDGE_CENTRAL_COMPARE_JAVA=false`
  (nothing sets this in tests or normal operation), so it's a broken fallback path, not the
  live Java judging path (`pkg/central/adapters/java.go`'s `JavaAdapter`, untouched).
- `main.go`: the `DEFAULT_POOL_SIZE`/`MAX_EXECUTIONS_PER_CONTAINER` env-var parses now use
  `strconv.Atoi` instead of `fmt.Sscanf(val, "%d", &target)` (Low finding, pure code-quality —
  behavior is equivalent, `strconv` added to the import block).

**To check in Codespace/locally**: `go build ./...` and `go vet ./...` in `judge-service-go/`
to confirm everything still compiles, then run `go test ./...` (includes real
container-spawning integration tests per language, per the C6 notes above) — pay particular
attention to `go_integration_test.go` (the compile-command change) and, if the
`JUDGE_CENTRAL_COMPARE_JAVA` env var is ever actually exercised in that environment,
`java_integration_test.go` with it set to `false`.

## 6. Backend lint cleanup — `problemDifficultyStats` fix has no test coverage

While clearing the backend's ~27 pre-existing ESLint violations (to flip the CI lint gate from
`continue-on-error` to blocking), the unused `difficulty` variable in
`submissions.service.js`'s `getMyAnalytics` turned out to be a real bug: `problemDifficultyStats`
was only incremented in the fallback branch (when `sub.problemId` needed a manual re-fetch), never
in the common case where `problemId` arrives pre-populated with tags — so the "average difficulty"
figure in student analytics was systematically wrong. Fixed to increment in both branches, but
there's no existing test fixture for `getMyAnalytics` to extend cheaply, so this fix is
code-reviewed only.

**To check in Codespace/locally**: seed a student with a mix of Easy/Medium/Hard solved
submissions where `problemId` comes back populated (the normal `findByUserId` path), call
`GET /api/v1/submissions/my/analytics`, and confirm the returned average-difficulty figure
actually reflects the seeded mix instead of defaulting to "Medium".

## 7. `backup_db.sh` container auto-detection — unverified without Docker

H11 flagged that `scripts/backup_db.sh` hardcoded `codespace_mongo` (the dev compose container
name via `container_name:` in `docker-compose.yml`), which doesn't exist in prod —
`docker-compose.prod.yml` sets no `container_name` on its `mongo` service, so Compose/Dokploy
auto-generates one that varies by deployment, meaning the script would silently produce an empty
backup (redirected stdout with no error surfaced) against the actual prod stack. Fixed by
resolving the container at runtime via `docker ps --filter "name=mongo" --format '{{.Names}}'`
(falls back to a clear failure message if nothing matches), with a `MONGO_CONTAINER_NAME` env var
to override detection entirely. Not runnable here — no Docker in this environment.

**To check in Codespace/locally**: run `docker compose up -d mongo` (dev) and confirm
`./scripts/backup_db.sh` finds `codespace_mongo` automatically; then simulate the prod case by
renaming/relaunching without `container_name` set (or just run it against
`docker-compose.prod.yml`) and confirm it still finds the right container without needing
`MONGO_CONTAINER_NAME`. Also confirm the failure path: stop all mongo containers and confirm the
script exits with the "No running mongo container found" message instead of silently writing an
empty/failed backup file.
