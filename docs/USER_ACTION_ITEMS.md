# Things only you can do

This is the running list of items from `docs/CODESPACE_HANDOFF.md` that need an action
only you can take — prod DB access, `git commit`/push, Dokploy redeploy, or a scoping
decision. Everything else in that checklist is done/verified in this Codespace. Update
this list as items get done or new ones come up; don't let it go stale.

## 1. Review, commit, and push the working-tree changes

Nothing in this Codespace has been committed or pushed — that's deliberately left to you.
Current uncommitted files (`git status`):

- `docker-compose.yml`, `docker-compose.prod.yml` — the docker-socket-proxy migration
  (item #9). Verified working against the local dev stack; `docker-compose.prod.yml` is
  validated via `docker compose config` but never deployed.
- `assessment-api/src/services/preview.service.js`, `judge-service-go/main_test.go`,
  `scripts/test_submission.js` — smaller fixes/test corrections from earlier this session
  (see git diff for each; already described in prior handoff context).
- `assessment-api/package-lock.json`, `frontend/package-lock.json` — dependency-only
  bumps (`npm audit fix`) that closed 2 real high-severity vulnerabilities
  (`nanoid`, `ip-address`) found while smoke-testing the CI security-audit job (item
  #12). No `package.json` changes, no major version bumps, tests/lint re-verified clean
  after. **Update 2026-08-08:** the `npm audit fix` run had left
  `assessment-api/package-lock.json` internally inconsistent (stray/duplicate
  `@emnapi/*` entries, one version mismatch) — harmless to `npm install` but fatal to
  `npm ci`, which is what `assessment-api/Dockerfile` uses, so `docker compose up
  --build` was failing on the `assessment-api` image. Fixed by deleting
  `node_modules`/`package-lock.json` and regenerating from `package.json` with a plain
  `npm install`. Re-verified: `npm ci` clean, `npm audit --audit-level=high` → 0
  vulnerabilities, `npm test` → 79/79, and a full `docker compose up --build -d` now
  brings up all containers with `/api/health` reporting mongodb/redis/rabbitmq/judge
  all `connected`. `frontend/package-lock.json` did not have this problem.

## 2. Deploy the docker-socket-proxy change to prod (item #9)

`docker-compose.prod.yml` is edited and locally validated but **not deployed**. Once you
commit/push and redeploy via Dokploy:

- Make sure whatever pulls/builds images for the prod stack picks up the new
  `docker-socket-proxy` service (image: `tecnativa/docker-socket-proxy:latest` — no
  custom build, just a pull).
- You can **remove the `DOCKER_GROUP_GID` env var from Dokploy** — it's no longer read
  anywhere now that `judge-service-go` doesn't touch `docker.sock` directly.
- After redeploy, re-run the curl smoke test in `CODESPACE_HANDOFF.md`'s "How to test"
  section against `coding.fortifyhub.net` to confirm submissions still work through the
  proxy in prod, the same way it was verified locally.

## 3. Confirm the CI `judge-certification` job on a real push (item #12)

Local simulation of every CI job passed except one inconclusive result: the Docker-heavy
integration/certification Go suite (`go test -tags=integration ./...`) timed out after
10 minutes in this Codespace — traced to resource contention (65 containers competing
for 4 CPUs, since the dev stack's own 48-container warm pool was already running), not a
code or docker-socket-proxy regression (`DOCKER_HOST` was unset for that run, so it hit
the raw socket, not the proxy). GitHub's hosted runners won't have that contention, but
this hasn't actually been watched run on one yet. Push a trivial branch/PR (or use
`gh workflow run`) and confirm `judge-certification` and the Playwright `e2e` job (not
exercised locally at all) both go green.

## 4. Scope H12 horizontal scale-out (item #11)

Not started — this is a real infra/design project (getting sandbox images into a
registry, decoupling judge-service-go from a single host's Docker socket), not something
to guess at. Worth a deliberate conversation about scope/timeline before picking it up.

## 5. Run `scripts/backfill_college_id.mjs` against production (item #13)

Per your instruction, deliberately left untouched — this Codespace has no production DB
credentials. Needs to run before/at any second-customer cutover (see the C2 tenant-scoping
fix). Confirm it's safe to re-run if it's ever unclear whether it already ran, then run it
for real once you have DB access to prod (or its staging equivalent).

## 6. Priority 3 (lower priority, deprioritized by design)

Untouched, no action needed yet: H3 integration-route auth scoping, IDE run/submit logic
dedup between `AssessmentWorkspace.jsx`/`ProblemPage.jsx`, other language adapters'
`CompileCommand`/`RunCommand` dedup, secrets rotation mechanism, structured logging,
no in-repo frontend prod deploy config, and the aspirational Phase 4 multi-model plan.
See `docs/CODESPACE_HANDOFF.md`'s Priority 3 section and
`docs/PLATFORM_AUDIT_AND_SAAS_ROADMAP.md` for full detail on each.

## Housekeeping note

The H11 restore drill (item #10) left an extra backup file in `backups/` from testing
(`assessment_db_20260808_052619.gz`, alongside the pre-existing one). Harmless — the
backup script auto-prunes anything older than 7 days — but delete it now if you'd rather
not wait.
