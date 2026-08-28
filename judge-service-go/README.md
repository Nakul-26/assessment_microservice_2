# Judge Service (Go)

A high-performance, multi-language code judge microservice written in Go. It securely executes submitted code inside isolated Docker containers, evaluates results against test cases, and persists structured verdicts to MongoDB and Redis.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Supported Languages](#supported-languages)
- [Configuration](#configuration)
- [HTTP API](#http-api)
- [Adding a New Language](#adding-a-new-language)
- [Adding New Questions](#adding-new-questions)
- [Data Models](#data-models)
- [Development](#development)
- [Running Tests](#running-tests)

---

## How It Works

### High-Level Flow

```
User submits code
       │
       ▼
  RabbitMQ queue  ──► Judge Service (Go)
                             │
                    ┌────────▼─────────┐
                    │ Validate message  │
                    │ Fetch problem     │
                    │ Acquire container │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────────────────────────┐
                    │         Execute in Docker sandbox      │
                    │                                        │
                    │  Interpreted langs  │  Compiled langs  │
                    │  (Python, JS, TS)   │  (Java, C, C++,  │
                    │                     │   C#, Go)         │
                    │   Run directly      │  Compile → Run    │
                    └────────────────────┬─────────────────-─┘
                                         │
                              ┌──────────▼───────────┐
                              │  Compare output vs    │
                              │  expected (comparator)│
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼──────────────────┐
                              │  Store result in MongoDB      │
                              │  Cache result in Redis (1hr)  │
                              └──────────────────────────────┘
```

### Submission Lifecycle

1. **Receive** — A `SubmissionMessage` is consumed from the `submission_queue` RabbitMQ queue.
2. **Validate** — Schema version, required fields, code size (max 200KB), and function name format are checked.
3. **Fetch Problem** — The problem definition is loaded from MongoDB by `problemId`, including test cases, type signatures, and resource limits.
4. **Acquire Container** — A pre-warmed Docker container for the target language is reserved from the container pool (30s timeout). If none are free, the message is routed to a retry queue with a 5s TTL.
5. **Prepare Files** — A language-specific test harness (wrapper) is generated that wraps the user's function, deserialises inputs, calls the function, and emits structured JSON output.
6. **Execute** — The code runs inside the sandboxed container with CPU/memory/time limits enforced.
7. **Compare** — Each test output is compared against the expected value using the problem's `CompareConfig` (supports float tolerance, order-insensitive arrays, deep structural comparison).
8. **Store** — The `SubmissionResult` is written to MongoDB and cached in Redis.
9. **Release Container** — The container is returned to the pool (or discarded if it encountered a poisonous error).

### Execution Strategies

The service automatically selects between two execution strategies:

| Strategy | When | Description |
|---|---|---|
| **Per-test** | < batch threshold (20) | Container is invoked once per test case. More isolated. |
| **Batched** | ≥ batch threshold (20) | All test cases sent in a single container invocation. Significantly faster for many tests. |

Thresholds are configurable per-language via environment variables. Batching is supported for Python, JavaScript, Java, and C++.

### Container Pool

A pool of pre-warmed Docker containers is maintained for each language. Each language has its
own `[Min, Max]` bounds (`JUDGE_POOL_MIN_<ABBR>`/`JUDGE_POOL_MAX_<ABBR>`, both falling back to
`DEFAULT_POOL_SIZE` if unset) rather than one global size — `Min` containers are always kept
warm; `Max` is only reached if autoscaling grows a language's pool under load. This eliminates
Docker startup latency from the hot path.

- Containers are evicted after **100 executions** (configurable) to prevent state contamination between submissions.
- Containers are automatically discarded on timeout, OOM, or runtime crash and replaced by the pool reconciler.
- Orphaned containers from previous service restarts are cleaned up at startup.
- **Autoscaling** (`JUDGE_POOL_AUTOSCALE_ENABLED`, off by default): a background loop grows a
  language's live pool toward its `Max` when callers are queueing to acquire a container (rising
  `Acquire()` wait time, or any acquire timeouts), and shrinks it back toward `Min` when idle,
  bounded by `JUDGE_POOL_GLOBAL_CAP` — a hard ceiling on the total container count summed across
  *all* languages, since they all share the same host's CPU. See `pkg/pool/pool.go`
  (`StartAutoscaler`, `decideScale`) for the algorithm.

---

## Architecture

```
judge-service-go/
├── main.go                     # Service entry point: boot, pool warm-up, worker loop
├── central_runner.go           # Per-test and batched execution strategies
├── pkg/
│   ├── languages/
│   │   └── languages.go        # Language registry (image, compile cmd, run cmd)
│   ├── central/adapters/
│   │   ├── adapter.go          # LanguageAdapter interface + registry
│   │   ├── python.go           # Python adapter (single + batch)
│   │   ├── javascript.go       # JavaScript adapter
│   │   ├── typescript.go       # TypeScript adapter
│   │   ├── java.go             # Java adapter (compiling + batch)
│   │   ├── go.go               # Go adapter (compiling)
│   │   ├── c.go                # C adapter (compiling)
│   │   ├── cpp.go              # C++ adapter (compiling + batch)
│   │   └── csharp.go           # C# adapter (compiling)
│   ├── executor/
│   │   ├── executor.go         # Docker exec wrapper (run/compile/stream)
│   │   └── errors.go           # Typed execution errors (TLE, MLE, compile fail)
│   ├── pool/
│   │   └── pool.go             # Container pool (acquire, release, discard, reconcile)
│   ├── wrapper/
│   │   └── generator.go        # Template-based wrapper code generator
│   ├── wrappers/               # Wrapper templates per language
│   │   ├── python_single_wrapper.tpl
│   │   ├── python_batch_wrapper.tpl
│   │   ├── js_single_wrapper.tpl
│   │   ├── js_batch_wrapper.tpl
│   │   ├── java_single_wrapper.tpl
│   │   ├── java_batch_wrapper.tpl
│   │   ├── cpp_single_wrapper.tpl
│   │   ├── cpp_batch_wrapper.tpl
│   │   ├── c_wrapper.tpl
│   │   ├── go_wrapper.tpl
│   │   ├── csharp_wrapper.tpl
│   │   └── ts_wrapper.tpl
│   ├── comparator/
│   │   └── comparator.go       # Recursive value comparator
│   ├── models/
│   │   ├── problem.go          # Problem + TestCase models, ValidateBasic
│   │   ├── result.go           # SubmissionResult + TestResult models
│   │   ├── submission.go       # Submission document model
│   │   └── submission_message.go # RabbitMQ message schema + validation
│   ├── types/
│   │   └── types.go            # Type grammar: number, string, array<T>, tree<T>, etc.
│   ├── workspace/              # Temp directory management
│   ├── metrics/                # Runtime metrics (GC, pool)
│   └── util/                   # Utilities (code unescaping)
└── environments/               # Docker build contexts per language
    ├── python/
    ├── javascript/
    ├── java/
    ├── c/
    ├── cpp/
    ├── csharp/
    └── go/
```

---

## Supported Languages

| Language | ID | Docker Image | Compiled | Batch Support |
|---|---|---|---|---|
| Python | `python` | `judge-py-env` | No | ✅ |
| JavaScript | `javascript` | `judge-js-env` | No | ✅ |
| TypeScript | `typescript` | `judge-js-env` | No | ❌ |
| Java | `java` | `judge-java-env` | Yes (`javac`) | ✅ |
| Go | `go` | `judge-go-env` | Yes (`go build`) | ❌ |
| C | `c` | `judge-c-env` | Yes (`gcc`) | ❌ |
| C++ | `cpp` | `judge-cpp-env` | Yes (`g++`) | ✅ |
| C# | `csharp` | `judge-csharp-env` | Yes (`dotnet build`) | ❌ |

---

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_URL` | `amqp://user:password@rabbitmq:5672` | RabbitMQ connection URL |
| `SUBMISSION_QUEUE` | `submission_queue` | Queue name for incoming submissions |
| `MONGO_URI` | `mongodb://mongo:27017/assessment_db` | MongoDB connection URI |
| `REDIS_URI` | `redis://redis:6379` | Redis connection URI |
| `HEALTH_PORT` | `8081` | Port for internal HTTP server |
| `DEFAULT_POOL_SIZE` | `2` | Fallback Min (and Max, unless overridden) pool size for any language without a per-language override below |
| `JUDGE_POOL_MIN_<ABBR>` / `JUDGE_POOL_MAX_<ABBR>` | see `main.go` | Per-language pool bounds. `<ABBR>` is one of `PY, JS, TS, JAVA, C, CPP, CS, GO, RS, RB, PHP, KT`. Max only matters once autoscaling is enabled |
| `JUDGE_POOL_GLOBAL_CAP` | `60` | Hard ceiling on total containers summed across all languages combined |
| `JUDGE_POOL_AUTOSCALE_ENABLED` | `false` | Grow/shrink each language's live pool between its Min/Max based on Acquire() wait time |
| `JUDGE_POOL_AUTOSCALE_INTERVAL` | `15` (seconds) | How often the autoscaler re-evaluates each language |
| `JUDGE_POOL_SCALE_UP_THRESHOLD_MS` / `JUDGE_POOL_SCALE_DOWN_THRESHOLD_MS` | `150` / `20` | Average Acquire() wait (ms) above/below which a language scales up/down |
| `JUDGE_POOL_SCALE_UP_COOLDOWN` / `JUDGE_POOL_SCALE_DOWN_COOLDOWN` | `20` / `180` (seconds) | Minimum time between consecutive scale-ups/scale-downs for one language (asymmetric — scale up fast, down slow) |
| `JUDGE_WORKER_CONCURRENCY` | `24` | Concurrent RabbitMQ submission workers / prefetch count (deliberately above core count — workers are I/O-bound on Docker calls) |
| `MAX_EXECUTIONS_PER_CONTAINER` | `100` | Evict container after N executions |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `JUDGE_CENTRAL_COMPARE_PY` | `true` | Enable central compare for Python |
| `JUDGE_CENTRAL_COMPARE_JS` | `true` | Enable central compare for JavaScript |
| `JUDGE_CENTRAL_COMPARE_JAVA` | `true` | Enable central compare for Java |
| `JUDGE_CENTRAL_COMPARE_CPP` | `true` | Enable central compare for C++ |
| `JUDGE_CENTRAL_COMPARE_C` | `true` | Enable central compare for C |
| `JUDGE_BATCH_THRESHOLD_PY` | `20` | Batch execution threshold for Python |
| `JUDGE_BATCH_THRESHOLD_JS` | `20` | Batch threshold for JavaScript |
| `JUDGE_BATCH_THRESHOLD_JAVA` | `20` | Batch threshold for Java |
| `JUDGE_BATCH_THRESHOLD_CPP` | `20` | Batch threshold for C++ |

---

## HTTP API

The service exposes a lightweight internal HTTP server (default port `8081`).

### `GET /health`

Returns a simple liveness check.

```json
{ "status": "healthy" }
```

### `GET /stats`

Returns container pool and GC/reconcile/acquire-wait metrics. `pool` now includes each
language's configured `min`/`max`/current `target` alongside live `available`/`in_use` counts,
and `metrics.acquire_wait` has per-language cumulative Acquire() call counts, average wait, and
timeout counts — the signal the autoscaler acts on.

```json
{
  "pool": {
    "available": { "python": 3, "java": 1 },
    "in_use": { "python": 1, "java": 3 },
    "min": { "python": 4, "java": 4 },
    "max": { "python": 8, "java": 8 },
    "target": { "python": 4, "java": 6 },
    "global_cap": 60
  },
  "metrics": {
    "acquire_wait": {
      "python": { "count": 120, "wait_nanos": 450000, "waited_count": 3, "timeout_count": 0 },
      "java": { "count": 40, "wait_nanos": 8200000, "waited_count": 22, "timeout_count": 1 }
    }
  }
}
```

### `POST /run`

Synchronously executes code and returns the result (no RabbitMQ). Useful for "Run Code" (not Submit) flows.

**Request body** (`SubmissionMessage`):
```json
{
  "schemaVersion": "1",
  "submissionId": "temp-123",
  "problemId": "temp",
  "language": "python",
  "code": "def twoSum(nums, target): ...",
  "functionName": "twoSum",
  "returnType": "array<number>",
  "parameters": [
    { "name": "nums", "type": "array<number>" },
    { "name": "target", "type": "number" }
  ],
  "tests": [
    { "inputs": [[2, 7, 11, 15], 9], "expected": [0, 1] }
  ]
}
```

If `problemId` is `"temp"` or not found in the database, the service uses the `tests` field inline (ephemeral mode — no DB persistence needed).

**Response** (`SubmissionResult`):
```json
{
  "status": "Accepted",
  "passed": 1,
  "total": 1,
  "maxTimeMs": 42,
  "elapsedMs": 156,
  "details": [
    {
      "test": 1,
      "passed": true,
      "input": [[2, 7, 11, 15], 9],
      "output": [0, 1],
      "expected": [0, 1],
      "timeMs": 42
    }
  ]
}
```

---

## Adding a New Language

Adding support for a new language requires changes in **5 places**. Estimated time: 30–60 minutes.

### Step 1 — Build a Docker Image

Create a directory `environments/<lang>/` with a `Dockerfile` that installs the runtime or compiler. The image should have:
- The runtime/compiler available at a well-known path
- Any required libraries (e.g., JSON parsing libraries for C)
- A working directory at `/app`

Tag the image as `judge-<lang>-env`.

### Step 2 — Register the Language

Add an entry to the `Languages` map in [`pkg/languages/languages.go`](pkg/languages/languages.go):

```go
"ruby": {
    ID:              "ruby",
    Name:            "Ruby",
    FileExt:         ".rb",
    Image:           "judge-ruby-env",
    RunCmd:          []string{"ruby", "/app/wrapper.rb"},
    WrapperTemplate: "ruby_wrapper.tpl",
},
```

For compiled languages, also add a `CompileCmd`.

### Step 3 — Write a Wrapper Template

Create `pkg/wrappers/ruby_wrapper.tpl`. The wrapper must:

1. Accept a Base64-encoded JSON argument (the test inputs)
2. Decode the JSON and extract the inputs array
3. Call the user's function with the decoded arguments
4. Print the result to **stderr** as a JSON object: `{"output": <value>}`
5. Let the user's `print`/`puts` go to **stdout** (they are captured separately)

The function name is injected via `{{FUNCTION_NAME}}` and the user's code via `# USER_CODE_MARKER`.

Example structure (pseudo-code):
```
# USER_CODE_MARKER  ← user's code is inserted here

require 'json'
require 'base64'

input_b64 = ARGV[0]
payload = JSON.parse(Base64.decode64(input_b64))
inputs = payload["inputs"]

begin
  result = {{FUNCTION_NAME}}(*inputs)
  STDERR.puts JSON.generate({ output: result })
rescue => e
  STDERR.puts JSON.generate({ error: e.message, traceback: e.backtrace.join("\n") })
end
```

### Step 4 — Create a Language Adapter

Create `pkg/central/adapters/ruby.go`:

```go
package adapters

import (
    "judge-service-go/pkg/languages"
    "judge-service-go/pkg/models"
    "judge-service-go/pkg/workspace"
    "judge-service-go/pkg/wrapper"
    "strings"
    "fmt"
)

type RubyAdapter struct{}

func (RubyAdapter) Name() string { return "ruby" }

func (RubyAdapter) PrepareFiles(workDir string, msg models.SubmissionMessage, problem models.Problem) ([]string, error) {
    lang := languages.GetLanguage("ruby")
    code, err := wrapper.GenerateWrapper(problem, lang, msg.FunctionName, "ruby_wrapper.tpl")
    if err != nil {
        return nil, err
    }
    finalCode := strings.Replace(code, "# USER_CODE_MARKER", msg.Code, 1)
    if err := workspace.WriteFile(workDir, "wrapper.rb", []byte(finalCode), 0644); err != nil {
        return nil, fmt.Errorf("failed to write wrapper.rb: %w", err)
    }
    return []string{"wrapper.rb"}, nil
}

func (RubyAdapter) RunCommand(inputB64 string) []string {
    return []string{"ruby", "/app/wrapper.rb", inputB64}
}
```

Then register it in [`pkg/central/adapters/adapter.go`](pkg/central/adapters/adapter.go):

```go
var AdapterRegistry = map[string]LanguageAdapter{
    // ... existing entries ...
    "ruby": RubyAdapter{},
}
```

### Step 5 — Enable Central Compare

Add a case to `isCentralCompareEnabled()` in [`main.go`](main.go):

```go
case "ruby":
    if raw, ok := os.LookupEnv("JUDGE_CENTRAL_COMPARE_RUBY"); ok {
        return isTruthyEnv(raw)
    }
    return true
```

---

## Adding New Questions

No code changes are required. Questions are MongoDB documents in the `problems` collection. Insert a document with the following structure:

```json
{
  "title": "Two Sum",
  "description": "Given an array of integers nums and a target integer, return the indices of the two numbers that add up to target.",
  "difficulty": "Easy",
  "functionName": "twoSum",
  "returnType": "array<number>",
  "parameters": [
    { "name": "nums",   "type": "array<number>" },
    { "name": "target", "type": "number" }
  ],
  "testCases": [
    { "inputs": [[2, 7, 11, 15], 9], "expected": [0, 1], "isSample": true },
    { "inputs": [[3, 2, 4], 6],      "expected": [1, 2], "isHidden": true },
    { "inputs": [[3, 3], 6],         "expected": [0, 1], "isHidden": true }
  ],
  "timeLimitMs": 2000,
  "memoryLimitMb": 256,
  "compareConfig": {
    "mode": "STRUCTURAL",
    "orderInsensitive": true,
    "floatTolerance": 0
  },
  "tags": ["array", "hash-map"],
  "isPremium": false
}
```

### Type System

Valid types for `parameters[].type` and `returnType`:

| Type | Example |
|---|---|
| `number` | Integer or float |
| `string` | A string |
| `boolean` | True/false |
| `array<T>` | `array<number>`, `array<string>` |
| `matrix<T>` | `matrix<number>` (2D array) |
| `tree<T>` | `tree<number>` (binary tree) |
| `linkedlist<T>` | `linkedlist<number>` |
| `void` | Function returns nothing |

### Compare Config

| Field | Description |
|---|---|
| `mode` | `"STRUCTURAL"` (default) — deep comparison |
| `floatTolerance` | e.g. `1e-5` — acceptable absolute error for floats |
| `orderInsensitive` | `true` — arrays treated as sets (order doesn't matter) |

### Sample vs Hidden Tests

- **`isSample: true`** — shown to the user in the problem statement and during "Run Code"
- **`isHidden: true`** — only used during "Submit"; not shown to the user
- Tests with neither flag set are treated as hidden by default

---

## Data Models

### SubmissionResult

```json
{
  "status": "Accepted | Wrong Answer | Runtime Error | Time Limit Exceeded | Memory Limit Exceeded | Compilation Error",
  "executionPath": "central | legacy",
  "passed": 3,
  "passedCount": 3,
  "total": 3,
  "totalCount": 3,
  "maxTimeMs": 124,
  "firstFailedTest": -1,
  "elapsedMs": 450,
  "startedAt": "2026-01-01T00:00:00Z",
  "finishedAt": "2026-01-01T00:00:00.45Z",
  "details": [ /* TestResult[] */ ]
}
```

### TestResult

```json
{
  "test": 1,
  "passed": false,
  "input": [[2, 7, 11, 15], 9],
  "output": [1, 0],
  "expected": [0, 1],
  "error": "Wrong Answer",
  "errorType": "wrong_answer | timeout | runtime | memory_limit",
  "timeMs": 42,
  "stdout": "debug print output...",
  "traceback": "stack trace if available"
}
```

---

## Development

### Prerequisites

- Go 1.22+
- Docker
- RabbitMQ, MongoDB, Redis (available via docker-compose in the root of the monorepo)

### Run with Hot Reload

```bash
make dev
# or
air -c .air.toml
```

### Build

```bash
go build -o judge-service .
```

### Docker Build

```bash
docker build -t judge-service-go .
```

---

## Running Tests

```bash
# Unit tests only (fast)
go test ./pkg/...

# Integration tests (requires Docker and language images)
go test -v -tags=integration ./...

# Specific language integration test
go test -v -run TestPython ./...
go test -v -run TestJava ./...
go test -v -run TestCpp ./...

# Benchmarks
go test -bench=. ./...

# Stress tests
go test -v -run TestStress ./...
```

> **Note**: Integration tests spin up real Docker containers. Ensure all `judge-*-env` images are built before running them.
