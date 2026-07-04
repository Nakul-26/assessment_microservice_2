# 🏆 Coding Assessment Microservice Platform

A robust, enterprise-grade online judge and coding assessment platform. Designed for scalability, security, and high performance, this system allows organizations to host coding contests, evaluate student performance, and automate the grading of programming tasks across multiple languages.

---

## 🏗️ System Architecture & Workflow

The platform leverages a modern microservices architecture designed to decouple the frontend dashboard, API gateway/management, and execution sandbox for high security and performance.

### Architecture Topology

```mermaid
graph TD
    subgraph Client Layer
        A[React Frontend]
    end

    subgraph API Gateway / Server Layer
        B[Assessment API Node.js / Express]
    end

    subgraph Data & Caching Layer
        C[(MongoDB)]
        D[(Redis Caching & Stats)]
    end

    subgraph Messaging & Queue Layer
        E[RabbitMQ Broker]
        E1[submission_queue]
        E2[submission_queue_retry]
        E3[submission_dlx]
        E4[submission_dead_letters]
        E --> E1
        E --> E2
        E --> E3
        E3 --> E4
    end

    subgraph Execution & Judging Layer
        F[Go Judge Service]
        G[Docker Daemon Host / var/run/docker.sock]
        H[Container Pool Reconciler/GC]
        I[Language Runtime Containers]
        I1[Python]
        I2[NodeJS]
        I3[Java]
        I4[C/C++]
        I5[Go]
        I6[C#]
    end

    A <-->|HTTP / JWT| B
    B <-->|Mongoose| C
    B <-->|ioredis| D
    B -->|Publish Submission| E1
    
    F -->|Subscribe| E1
    F <-->|Direct Result Update| C
    F <-->|Stats & Diagnostics| D
    F <-->|Docker SDK| G
    G -->|Manage| H
    H -->|Pre-warm / Recycle| I
    I --> I1 & I2 & I3 & I4 & I5 & I6
    F -->|Mount Workspace & Execute Code| I
```

### End-to-End Submission Lifecycle
1.  **Initiation**: The student writes a solution in [AssessmentWorkspace.jsx](file:///D:/nakul/leetcode_clone/frontend/src/pages/AssessmentWorkspace.jsx) or [ProblemPage.jsx](file:///D:/nakul/leetcode_clone/frontend/src/pages/ProblemPage.jsx) and clicks **Submit**.
2.  **API Reception**: The submission request is handled by [submissions.routes.js](file:///D:/nakul/leetcode_clone/assessment-api/src/routes/submissions.routes.js) and dispatched to [submissions.controller.js](file:///D:/nakul/leetcode_clone/assessment-api/src/controllers/submissions.controller.js) / [submissions.service.js](file:///D:/nakul/leetcode_clone/assessment-api/src/services/submissions.service.js).
3.  **Database Insertion**: The submission is persisted in the MongoDB `submissions` collection with state `Pending`.
4.  **Queueing**: [evaluation.service.js](file:///D:/nakul/leetcode_clone/assessment-api/src/services/evaluation.service.js) checks if the submission queue length is below a backpressure ceiling of 5,000. If safe, it publishes a persistent message to RabbitMQ's `submission_queue`. If overloaded, it applies backpressure by rejecting with HTTP 503.
5.  **Consumption**: The Go Judge Service ([main.go](file:///D:/nakul/leetcode_clone/judge-service-go/main.go)) consumes the submission message. It fetches the problem details (test cases, memory limit, time limit, function constraints) directly from MongoDB.
6.  **Execution**:
    *   The judge reserves a pre-warmed container from the [ContainerPool](file:///D:/nakul/leetcode_clone/judge-service-go/pkg/pool/pool.go) via [Executor](file:///D:/nakul/leetcode_clone/judge-service-go/pkg/executor/executor.go).
    *   A unique workspace folder is allocated on the host system (using `tmpfs` mounts to bypass slow storage layers).
    *   The student's code is wrapped inside a secure boilerplate adapter ([wrappers](file:///D:/nakul/leetcode_clone/judge-service-go/pkg/wrappers)) that restricts access to unsafe standard libraries (like `os` or `eval` in Python) and injects standard coding structures (like `TreeNode`, `ListNode`).
    *   The code compiles and executes against the inputs inside the container. Execution metrics (CPU time, RAM consumption, output bytes) are monitored.
7.  **Comparison & Evaluation**:
    *   The raw results are captured and sent to the [comparator](file:///D:/nakul/leetcode_clone/judge-service-go/pkg/comparator/comparator.go) which supports `EXACT` and `STRUCTURAL` comparison modes (handling floats within tolerance levels, linked list/tree equivalence, and order-insensitive sets).
8.  **Finalizing**:
    *   The Go judge updates the database state directly to `Success` or `Fail` and caches stats on Redis.
    *   The user's React frontend page automatically updates via periodic fetching or WebSocket state reload.

---

## 📂 Codebase Modules & Directory Structure

Here is a summary of the workspace:

*   [docker-compose.yml](file:///D:/nakul/leetcode_clone/docker-compose.yml): Main orchestrator containing MongoDB, Redis, RabbitMQ, Node.js API, Go Judge, and pre-warm container environments.
*   [assessment-api/](file:///D:/nakul/leetcode_clone/assessment-api): Node.js + Express API backend.
    *   [index.js](file:///D:/nakul/leetcode_clone/assessment-api/index.js) / [src/server.js](file:///D:/nakul/leetcode_clone/assessment-api/src/server.js): API Gateway entry points.
    *   [src/app.js](file:///D:/nakul/leetcode_clone/assessment-api/src/app.js): Core middleware, CORS, rate limiters, and Swagger specs.
    *   [src/routes/](file:///D:/nakul/leetcode_clone/assessment-api/src/routes): Endpoint routers defining route protections.
    *   [src/controllers/](file:///D:/nakul/leetcode_clone/assessment-api/src/controllers): Route request logic handlers.
    *   [src/services/](file:///D:/nakul/leetcode_clone/assessment-api/src/services): Domain logic services (Assessments, Problems, Submissions, Cache, Evaluation, Preview).
    *   [models/](file:///D:/nakul/leetcode_clone/assessment-api/models): Mongoose BSON models (e.g. `Assessment`, `Problem`, `User`, `Submission`, `AuditLog`).
*   [judge-service-go/](file:///D:/nakul/leetcode_clone/judge-service-go): Go-based high performance judging sandbox.
    *   [main.go](file:///D:/nakul/leetcode_clone/judge-service-go/main.go): Daemon running parallel worker goroutines, handling graceful shutdowns, and DLQ setups.
    *   [pkg/pool/pool.go](file:///D:/nakul/leetcode_clone/judge-service-go/pkg/pool/pool.go): Pre-warmed container pooling engine with reconcilers & auto-eviction.
    *   [pkg/executor/executor.go](file:///D:/nakul/leetcode_clone/judge-service-go/pkg/executor/executor.go): Handles Docker SDK interactions, container creation, and environment parameters.
    *   [pkg/wrappers/](file:///D:/nakul/leetcode_clone/judge-service-go/pkg/wrappers): Code templates for language-specific environments to lock down imports and inject standard utilities.
    *   [environments/](file:///D:/nakul/leetcode_clone/judge-service-go/environments): Independent Dockerfiles for compiling and running Python, JavaScript, Java, C, C++, Go, and C#.
*   [frontend/](file:///D:/nakul/leetcode_clone/frontend): React frontend.
    *   [src/main.jsx](file:///D:/nakul/leetcode_clone/frontend/src/main.jsx) / [src/App.jsx](file:///D:/nakul/leetcode_clone/frontend/src/App.jsx): Entry point.
    *   [src/pages/](file:///D:/nakul/leetcode_clone/frontend/src/pages): Visual pages including authentication, dashboard, live metrics, workspace IDE, problem management, analytics.
*   [contracts/](file:///D:/nakul/leetcode_clone/contracts): JSON schemas validating problem structures ([problem.schema.json](file:///D:/nakul/leetcode_clone/contracts/problem.schema.json)) and submission payloads ([submission.schema.json](file:///D:/nakul/leetcode_clone/contracts/submission.schema.json)).
*   [scripts/](file:///D:/nakul/leetcode_clone/scripts): Maintenance and utility scripts.
    *   [scripts/backup_db.sh](file:///D:/nakul/leetcode_clone/scripts/backup_db.sh) / [scripts/restore_db.sh](file:///D:/nakul/leetcode_clone/scripts/restore_db.sh): Database backup & restoration scripts.
    *   [scripts/test_submission.js](file:///D:/nakul/leetcode_clone/scripts/test_submission.js): Submissions end-to-end integration harness.

---

## 🛡️ Key Features & Enterprise Controls

### 🧑‍💼 Assessment Lifecycles
*   **Drafting**: Faculty can plan assessments, lock problems, specify points, start/end dates, and enforce allowed languages.
*   **Locked Assessments**: Excludes updates once live to maintain assessment integrity.
*   **Attempts**: Creates separate attempts per student with personal expiration timers that automatically run auto-submissions.
*   **Announcements**: Real-time broadcasts during assessments.
*   **Grace Time**: Faculty can add grace periods for individual student attempts.

### 🚫 Anti-Cheating & Integrity Management
*   **Tab Switching Detection**: Tracks focus loss (`visibilitychange`). Dispatches a `TAB_SWITCH` violation event and warning.
*   **DevTools / Shortcut Blocker**: Intercepts F12, inspect console shortcuts, print screen, view-source commands, Ctrl+S, Ctrl+P, and custom keyboard cuts/pastes.
*   **Copy-Paste Restrictions**: Select-start, copy, paste, and cut are disabled in the coding workspace. Violation events are recorded.
*   **Fullscreen Mode Enforcement**: Locks the student's browser window. If fullscreen is exited, logs `FULLSCREEN_EXIT` and triggers a visual timer warning which can timeout/lock the attempt.

### 🚀 High-Performance Judge Features
*   **Container Pooling**: Pre-warms runtime containers for C, C++, Python, JavaScript, Java, Go, and C#, achieving zero cold starts.
*   **Safety Isolation**: Restricts system bindings. Disables network adapters on sandbox containers and locks down dangerous operations (like writing to `/etc` or invoking sys-commands) via wrapper code injectors.
*   **Structural Comparisons**: Supports complex objects such as matrices, binary tree structures, and doubly linked lists.

---

## 🚀 Getting Started & Local Setup

### Prerequisites
*   Docker Desktop (with Compose)
*   Node.js v20+

### Quick Start
1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/Nakul-26/leetcode-clone.git
    cd leetcode-clone
    ```
2.  **Spin Up the Stack**:
    ```bash
    docker-compose up -d --build
    ```
3.  **Seed Default problems & Judge Certifications**:
    ```bash
    # Seed Problem Sets
    docker compose exec -T assessment-api node scripts/seed_problems_api.mjs
    
    # Run Judge Certification Seed
    docker exec -it codespace_assessment_api node scripts/seed_certification_set.mjs
    ```
4.  **Launch Dashboard Ports**:
    *   **Frontend Client**: [http://localhost:5173](http://localhost:5173)
    *   **API Gateway & Swagger Docs**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
    *   **RabbitMQ Management Console**: [http://localhost:15672](http://localhost:15672) (User: `user` / Pass: `password`)

---

## 🧪 Testing & Quality Verification

Run tests from the root or sub-directories:

### Root Level Command Scripts
*   **Full Test Suite**: `npm test`
*   **E2E Integration Harness**: `npm run test:submission` (Runs locally) or `npm run test:submission:docker` (Runs in Compose network)
*   **E2E UI Playwright Tests**: `npm run test:e2e`

### Sub-Module Specific Tests
*   **Go Judge Unit Tests**:
    ```bash
    cd judge-service-go
    go test ./...
    ```
*   **Go Judge Integration Tests (Requires Docker)**:
    ```bash
    cd judge-service-go
    go test -v -tags=integration .
    ```
*   **API Unit/Integration Suite**:
    ```bash
    cd assessment-api
    npm test
    ```
*   **Frontend UI Tests**:
    ```bash
    cd frontend
    npm test
    ```

---

## ⚙️ Service Environment Variables

### Assessment API Backend Environment Settings
| Variable | Purpose | Default Value |
| :--- | :--- | :--- |
| `PORT` | Node server listening port | `3000` |
| `MONGO_URI` | Connection URI for persistence | `mongodb://mongo:27017` |
| `MONGO_DB_NAME` | Database catalog name | `assessment_db` |
| `REDIS_URI` | Redis instance connection URI | `redis://localhost:6379` |
| `RABBITMQ_URI` | RabbitMQ broker connection URI | `amqp://localhost` |
| `JWT_SECRET` | Secret key signing access tokens | `dev_secret_change_me` |
| `TESTING_PLATFORM_KEY`| Integration auth service key | `testing_platform_secret` |

### Go Judge Environment Settings
| Variable | Purpose | Default Value |
| :--- | :--- | :--- |
| `RABBITMQ_URL` | RabbitMQ broker connection URI | `amqp://user:password@rabbitmq:5672` |
| `SUBMISSION_QUEUE` | Main incoming submissions queue name| `submission_queue` |
| `MONGO_URI` | Connection URI for database reading | `mongodb://mongo:27017/assessment_db`|
| `REDIS_URI` | Cache & stats store connection URI | `redis://redis:6379` |
| `DEFAULT_POOL_SIZE` | Warmed container pool size per lang | `2` |
| `LOG_LEVEL` | Logging detail constraints | `debug` |

---

## 🧹 Maintenance & Backup Operations

### Database Backups
To secure critical data, run:
```bash
./scripts/backup_db.sh
```
This produces a compressed gzip archive of the MongoDB state under the `backups/` directory.

### Restoring Databases
To recover state:
```bash
./scripts/restore_db.sh <backup_filename.gz>
```
> [!CAUTION]
> This command completely overrides any active databases. Always verify on staging environments first.

### Sandbox Garbage Collection
The Go Judge service runs a background sweeper to evict containers exceeding `MAX_EXECUTIONS_PER_CONTAINER` (default 100) or orphaned instances. To manually flush all Docker components:
```bash
./scripts/cleanup_judge.sh
```
