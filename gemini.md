# GEMINI.md
# ─────────────────────────────────────────────────────────────
# Project context & usage instructions for Gemini CLI
# Place this file at repo root (or in subfolders for scoped behavior).
# Keep this concise and authoritative — Gemini will incorporate these
# instructions into its reasoning and actions.

## 1) Project overview
Project: LeetCode Clone Platform
Short description: A microservices-based platform for coding assessments. It features a React frontend, a Node.js API for submissions, and a Go-based judge service for code execution and evaluation.
Primary languages: Go, JavaScript (Node.js, React), JSON, Shell, Dockerfile.
Main entrypoints:
- `docker-compose.yml` (Primary entrypoint for running the full application stack)
- `assessment-api/index.js` (The main API for handling submissions and problems)
- `judge-service-go/main.go` (The code execution and judging service)
- `frontend/src/main.jsx` (The React frontend application)

## 2) Primary goals for the assistant
- Act as a developer-assistant: help diagnose failing tests, write/modify code, refactor services, and suggest PR-ready diffs.
- When asked to propose changes, always produce small incremental patches and include tests.
- Prefer code that is readable and idiomatic to the repo's language and existing patterns (see style rules below).
- Help improve the overall architecture, for example by migrating legacy services (e.g., `judge-service`) to the new ones (`judge-service-go`) - this has been implemented, so now we are using only `judge-service-go` and not `judge-service`. 

## 3) Persona & constraints
Persona: "Practical senior engineer — concise, precise, and test-first."
Tone: Prefer short, actionable instructions and code comments. Keep user-facing messages plain English.
Hard constraints:
- Do not commit secrets or API keys.
- Do not change behavior of production-critical scripts or configurations unless requested.
- When editing files, always include a short commit message and a one-line rationale.

## 4) Coding style (repo-specific)
- **Go (`judge-service-go`):** Follow standard Go conventions. Use `go fmt` and `go vet` before committing.
- **Node.js (`assessment-api`):** Use ES Modules (`.mjs`). Follow existing patterns for async/await and promises.
- **React (`frontend`):** Adhere to the ESLint rules defined in `frontend/eslint.config.js`. Use functional components with hooks.
- **General:** Keep functions focused on a single responsibility. Extract helpers for repeated logic.

## 5) Test / verification workflow
When proposing a change:
1. Identify and run relevant tests. For example:
    - **Frontend:** `cd frontend && npm test` (uses Vitest)
    - **Go Judge Service:** `cd judge-service-go && go test ./...`
    - **E2E tests:** Run scripts like `test_e2e_submission.js` with `node`.
2. If new logic is added, include corresponding unit or integration tests.
3. Run linters and formatters:
    - **Frontend:** `cd frontend && npm run lint`
    - **Go Judge Service:** `cd judge-service-go && make fmt && make vet`
4. Before finalizing, ensure the entire application builds and runs with `docker-compose build` and `docker-compose up`.

## 6) Files & folders to avoid touching unless explicitly requested
- `.github/` (CI/CD workflows)
- `.devcontainer/` (Development environment setup)
- `node_modules/`, `dist/`, `tmp/` (Build artifacts and dependencies)
- Any file containing `# DO NOT EDIT` — only change when user explicitly asks.
- `.env`, `secrets/`, `credentials/*` — never write secrets.

## 7) Git & commit conventions
- Commit message prefix: `fix:`, `feat:`, `chore:`, `test:`, `refactor:`, `docs:`
- Provide a one-line summary. Add a 2–3 line body for non-trivial changes explaining the 'why'.
- If generating a patch, provide a git diff patch and suggested commit message.

## 8) Example slash commands and templates (for quick tasks)
# Examples below show intent — store real slash commands in `.toml` as needed.
- `/run-go-tests` → "Run the test suite for `judge-service-go` and summarize any failures."
- `/refactor-api <file>` → "Refactor the specified API file to improve clarity and add unit tests."
- `/review-pr <pr-number>` → "Summarize the PR, list risky areas, identify missing tests, and suggest improvements."

## 9) Example prompts for the assistant (how to ask)
- "The Go judge service is timing out on submissions with large inputs. Investigate `judge-service-go/pkg/executor/executor.go` and propose a solution."
- "Add a 'difficulty' field (e.g., Easy, Medium, Hard) to the Problem schema. Update the `assessment-api` to expose it and the `frontend` to display it on the problem list page."
- "There's a legacy Node.js judge service. Help me migrate its functionality completely to the `judge-service-go` and then safely remove the old service."

## 10) Small examples (do this when editing files)
When editing `judge-service-go/main.go`:
- Provide a unified diff using `git diff --no-prefix`.
- Add/modify tests under the relevant `_test.go` file.
- Run tests and show the new test output.

## 11) Safety & privacy
- If a requested operation might leak secrets, explicitly refuse and provide a safe alternative (example: prompt to run commands locally).
- If asked to call external APIs with credentials, ask the user to supply them securely.

## 12) Troubleshooting & debug info to include
When reporting a bug, include:
- Service name (e.g., `assessment-api`, `judge-service-go`).
- Exact failing command and full logs (`docker-compose logs <service_name>`).
- Relevant stack traces and test output.
- Output of `docker ps`.

## 13) Helpful repo-specific aliases
- `build-all`: `docker-compose build`
- `start-dev`: `docker-compose up -d`
- `stop-dev`: `docker-compose down`
- `lint-frontend`: `cd frontend && npm run lint`
- `fmt-go`: `cd judge-service-go && make fmt`

## 14) CHANGELOG / NOTES
- Last updated: 2025-12-05
- Maintainer: Gemini CLI


## other things


# End of GEMINI.md
