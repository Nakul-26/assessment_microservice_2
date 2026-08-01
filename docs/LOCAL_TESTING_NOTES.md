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
