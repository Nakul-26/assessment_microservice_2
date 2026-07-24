# Judge Service (Go) — Detailed Analysis Report

## 1. Overview

The judge service is a **Go-based code evaluation microservice** that executes user-submitted code against test cases and reports structured results. It sits at the heart of the assessment platform, consuming jobs from a RabbitMQ queue, sandboxing execution inside Docker containers, and persisting outcomes in MongoDB with a Redis cache layer.

---

## 2. Architecture

```mermaid
flowchart TD
    A[RabbitMQ\nsubmission_queue] -->|consume| B[main.go\nWorker Pool\n#workers = NumCPU]
    B --> C{Validate\nDecodeMsg}
    C -->|invalid| DLQ[Dead Letter Queue]
    C -->|valid| D[Fetch Problem\nfrom MongoDB]
    D --> E{Central Compare\nenabled?}
    E -->|Yes| F[central_runner.go\nrunSubmissionCentralDetailed]
    E -->|No - Legacy| G[Legacy wrapper\nexecution]
    F --> H{Batch threshold?}
    H -->|>= threshold| I[Batched Execution\nAll tests in 1 container call]
    H -->|< threshold| J[Per-test Execution\n1 container call per test]
    I --> K[comparator.go\nCompare outputs]
    J --> K
    G --> L[processAndStoreResults]
    K --> L
    L --> M[MongoDB\nUpdate submission]
    L --> N[Redis\nCache result]
    L --> O[Update problem\nanalytics counters]
```

### Infrastructure Components

| Component | Role |
|---|---|
| **RabbitMQ** | Async job queue (`submission_queue`) with DLX/DLQ and a 5s TTL retry queue |
| **MongoDB** | Persistent store for `problems` and `submissions` collections |
| **Redis** | 1-hour result cache keyed as `submission:<id>` |
| **Docker** | Isolated sandbox containers per language (pre-warmed pool) |
| **HTTP Server (`:8081`)** | Health (`/health`), stats (`/stats`), and synchronous run (`/run`) endpoints |

---

## 3. Key Components

### 3.1 `main.go` — Orchestration

The entry point boots the entire service:

1. **Container Pool Warm-up** — spawns `poolSize` (default 2) Docker containers per supported language in parallel goroutines
2. **Orphan GC** — removes containers from previous crashed runs at startup; runs periodic GC every 5 minutes for exited/dead containers
3. **Pool Reconciler** — runs every minute to refill the pool if containers were discarded
4. **Worker Pool** — spins up `runtime.NumCPU()` goroutines, each consuming from the RabbitMQ channel
5. **Graceful Shutdown** — catches `SIGINT`/`SIGTERM`, drains workers, then shuts down the container pool

The `processSubmission` function is the main pipeline step: decode → validate → fetch problem → acquire container → prepare files → execute → store results.

### 3.2 `central_runner.go` — Execution Strategies

Two mutually-exclusive execution strategies:

**Per-test mode** (`runSubmissionCentralPerTest`):
- Compiles code once (for compiled languages)
- Runs the sandbox container once per test case, passing inputs as Base64-encoded JSON via CLI argument
- Parses a single JSON result from the container's stderr

**Batched mode** (`runSubmissionCentralBatched`):
- Triggered when `testCount >= batchThreshold` (default 20 for Python, JS, Java, C++)
- Sends all test cases in one container invocation as a Base64-encoded JSON array
- Streams stdout/stderr, parsing JSON-lines from stderr for each test result
- Significantly reduces Docker exec overhead for problems with many test cases

Batching thresholds are configurable via env vars (`JUDGE_BATCH_THRESHOLD_PY`, `_JS`, `_JAVA`, `_CPP`).

### 3.3 Container Pool (`pkg/pool/pool.go`)

A per-language channel-based pool:
- Channels act as the bounded concurrent queue — `Acquire` blocks until a container is available or context times out
- `Release` returns a healthy container; `Discard` forcibly removes a suspect container and spawns a replacement
- Containers are evicted after `MAX_EXECUTIONS_PER_CONTAINER` executions (default 100), preventing state contamination
- The pool `Monitor` goroutine detects dead containers; the `Reconciler` goroutine keeps pool sizes stable

Container "poisoning" heuristics: TLE, MLE, runtime errors, OOM, "no such container" messages all trigger discard.

### 3.4 Language Adapters (`pkg/central/adapters/`)

Each language implements the `LanguageAdapter` interface:

```go
type LanguageAdapter interface {
    Name() string
    PrepareFiles(workDir string, ...) ([]string, error)
    RunCommand(inputB64 string) []string
}
```

Languages that compile also implement `CompilingLanguageAdapter` (adds `CompileCommand() []string`).
Languages supporting batching implement `BatchLanguageAdapter` (adds `PrepareBatchFiles` and `BatchRunCommand`).

Current adapters: **Python, JavaScript, TypeScript, Java, Go, C, C++, C#**

### 3.5 Wrapper Generator (`pkg/wrapper/generator.go`)

Generates language-specific test harness code from templates stored in `pkg/wrappers/*.tpl`. The generator:
- Reads the template file for the target language
- Embeds function name, test cases (as JSON literals for compiled languages), and type info
- Applies language-specific code generation (e.g., builds Java `Gson` deserializer calls, C/C++ function call dispatchers)
- Inserts a `// USER_CODE_MARKER` or `# USER_CODE_MARKER` for the user's submitted code

Templates cover 15 files across per-test and batched variants for each language.

### 3.6 Comparator (`pkg/comparator/comparator.go`)

A recursive, type-aware value comparator supporting:
- **Numbers**: float tolerance (`FloatTolerance` config field)
- **Arrays**: order-sensitive (default) or `orderInsensitive` matching
- **Maps/Objects**: recursive key-value comparison
- **nil ↔ empty slice**: treated as equal (handles serialisation edge cases)
- **Fallback**: `reflect.DeepEqual` for booleans, strings, etc.

Comparison config is set per-problem via the `CompareConfig` struct.

### 3.7 Type System (`pkg/types/types.go`)

Defines a simple generic type grammar validated via regex:
- Primitives: `number`, `string`, `boolean`, `void`
- Generics: `array<T>`, `matrix<T>`, `tree<T>`, `linkedlist<T>`, `graph<T>`
- Recursive nesting supported (e.g., `array<array<number>>`)

All `Problem.ReturnType` and `Parameter.Type` fields are validated against this grammar at submission time.

### 3.8 Models

| Model | Key Fields |
|---|---|
| `Problem` | `functionName`, `parameters`, `returnType`, `testCases`, `timeLimitMs`, `memoryLimitMb`, `compareConfig` |
| `TestCase` | `inputs []interface{}`, `expected interface{}`, `isSample`, `isHidden` |
| `SubmissionMessage` | `submissionId`, `problemId`, `language`, `code`, `functionName`, `tests` (optional inline) |
| `SubmissionResult` | `status`, `passed`, `total`, `details []TestResult`, `maxTimeMs`, `elapsedMs` |
| `TestResult` | `passed`, `input`, `output`, `expected`, `error`, `errorType`, `timeMs`, `traceback` |

---

## 4. Execution Flow (Detailed)

```
1.  RabbitMQ delivers a SubmissionMessage
2.  JSON decode + validation (schema version, required fields, code size limit)
3.  Function name sanitization (strip invalid identifier chars)
4.  Fetch Problem from MongoDB by ObjectID
5.  ValidateBasic() — ensures title/description/functionName/returnType/parameters
6.  GetLanguage(lang) — lookup language config (Docker image, compile/run cmd)
7.  ContainerPool.Acquire(ctx, lang) — 30s timeout; if none available → retry queue (5s TTL)
8.  Increment container execution count; schedule discard if >= MAX_EXECUTIONS_PER_CONTAINER
9.  Central path:
    a. NewSubmissionWorkspace — creates /submissions/<id>/ on host, /app/<id>/ in container
    b. adapter.PrepareFiles / PrepareBatchFiles — writes wrapper code + user code to disk
    c. Compile (for compiled languages via CompileInContainer)
    d. Per-test or batched run via executor.RunInContainer / RunInContainerStream
    e. Parse results: stderr contains JSON metadata, stdout contains user print output
    f. comparator.Compare for each test output vs expected
10. processAndStoreResults:
    - Update submission doc in MongoDB (status, output, testResult)
    - Increment problem.submissionCount / acceptedCount
    - Cache full submission JSON in Redis (1hr TTL)
11. Ack/Nack the AMQP message
12. Release or Discard the container
```

---

## 5. Security & Sandboxing

- **Docker isolation**: each execution runs inside a pre-built language-specific image
- **Memory limits**: passed to Docker exec as `--memory` constraint (from `problem.MemoryLimitMb`)
- **Time limits**: `context.WithTimeout` wraps each container execution; TLE is detected and reported
- **Output size limits**: stdout capped at 64KB; stderr/logs capped at 4KB; test JSON at 1MB
- **Code size limits**: submissions capped at 200KB
- **Function name sanitisation**: prevents code injection into generated wrapper strings
- **Workspace isolation**: each submission gets its own directory; cleaned up via deferred cleanup and a background sweeper
- **Container eviction**: containers are discarded after 100 uses or on poisonous errors (TLE, OOM, runtime crash)

---

## 6. Observability

- **Structured logging**: `log/slog` with JSON output; level controllable via `LOG_LEVEL` env var
- **Metrics**: `pkg/metrics` package tracks GC events, pool stats via `/stats` endpoint
- **Health endpoint**: `/health` returns `{"status":"healthy"}`
- **Container pool stats**: pool size, in-use counts exposed at `/stats`

---

## 7. Supported Languages

| Language | ID | Docker Image | Compile? | Batch? |
|---|---|---|---|---|
| Python | `python` | `judge-py-env` | No | ✅ (≥20 tests) |
| JavaScript | `javascript` | `judge-js-env` | No | ✅ (≥20 tests) |
| TypeScript | `typescript` | `judge-js-env` | No | ❌ |
| Java | `java` | `judge-java-env` | ✅ `javac` | ✅ (≥20 tests) |
| Go | `go` | `judge-go-env` | ✅ `go build` | ❌ |
| C | `c` | `judge-c-env` | ✅ `gcc` | ❌ |
| C++ | `cpp` | `judge-cpp-env` | ✅ `g++` | ✅ (≥20 tests) |
| C# | `csharp` | `judge-csharp-env` | ✅ `dotnet build` | ❌ |

---

## 8. Configuration (Environment Variables)

| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_URL` | `amqp://user:password@rabbitmq:5672` | RabbitMQ connection string |
| `SUBMISSION_QUEUE` | `submission_queue` | Queue name to consume from |
| `MONGO_URI` | `mongodb://mongo:27017/assessment_db` | MongoDB connection string |
| `REDIS_URI` | `redis://redis:6379` | Redis connection string |
| `HEALTH_PORT` | `8081` | Port for the internal HTTP server |
| `DEFAULT_POOL_SIZE` | `2` | Containers per language in the pool |
| `MAX_EXECUTIONS_PER_CONTAINER` | `100` | Evict container after N executions |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error` |
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

## 9. Adding New Languages — Difficulty Assessment: **Moderate (30–60 min)**

The system is reasonably well designed for language extension. The steps are:

1. **Build a Docker image** — create a `judge-<lang>-env` image with the runtime/compiler installed. Add it to `environments/<lang>/`.
2. **Register in `languages.go`** — add an entry to the `Languages` map with `ID`, `Image`, `FileExt`, `CompileCmd` (if applicable), `RunCmd`, and `WrapperTemplate`.
3. **Write wrapper template(s)** — create `pkg/wrappers/<lang>_single_wrapper.tpl` (and optionally `_batch_wrapper.tpl`). The template must:
   - Accept a Base64-encoded JSON input via stdin/argv
   - Call the user's function with the decoded inputs
   - Print the result as a JSON object `{"output": <value>}` to **stderr**, and user prints to **stdout**
4. **Create a language adapter** — add `pkg/central/adapters/<lang>.go` implementing `LanguageAdapter`. Register it in `AdapterRegistry` in `adapter.go`.
5. **Enable central compare** in `isCentralCompareEnabled()` in `main.go`.

> **Friction points**: The wrapper must carefully handle type serialisation (the Go wrapper generator has bespoke logic for each language's type system — see `generator.go`). C and C++ required hand-written dispatch code for type-safe function invocation. Compiled languages also need compilation step handling.

---

## 10. Adding New Questions — Difficulty Assessment: **Easy (< 5 min)**

Questions are just MongoDB documents in the `problems` collection. There is no code change required. A valid problem document needs:

```json
{
  "title": "Two Sum",
  "description": "Given an array of integers...",
  "functionName": "twoSum",
  "returnType": "array<number>",
  "parameters": [
    { "name": "nums", "type": "array<number>" },
    { "name": "target", "type": "number" }
  ],
  "testCases": [
    { "inputs": [[2, 7, 11, 15], 9], "expected": [0, 1], "isSample": true },
    { "inputs": [[3, 2, 4], 6], "expected": [1, 2], "isHidden": true }
  ],
  "timeLimitMs": 2000,
  "memoryLimitMb": 256,
  "compareConfig": { "mode": "STRUCTURAL", "orderInsensitive": true }
}
```

The type system validates all `parameters[].type` and `returnType` values. The comparator respects `compareConfig` per-problem, so floating-point or order-insensitive problems just need the right config set.

The `/run` HTTP endpoint also supports ephemeral problems — you can pass `tests` inline in the request body without persisting anything to MongoDB.

---

## 11. Strengths

- ✅ **Clean separation of concerns** — orchestration, pooling, execution, comparison, and models are all distinct packages
- ✅ **Dual execution strategies** — batching massively reduces overhead for test-heavy problems
- ✅ **Container pool with eviction** — prevents inter-submission contamination and amortises Docker startup cost
- ✅ **Graceful retry logic** — retry queue with TTL avoids hot-requeue loops when containers are unavailable
- ✅ **Ephemeral problem support** — the `/run` endpoint allows testing without DB persistence
- ✅ **Comprehensive type system** — validates types at submission time, preventing wrapper crashes
- ✅ **Flexible comparison** — float tolerance, order-insensitive arrays, deep structural comparison
- ✅ **Extensive test coverage** — integration tests per language, stress tests, contamination tests, FD leak tests, goroutine leak tests

## 12. Weaknesses / Areas for Improvement

- ⚠️ **Hard-coded container eviction logic** in `main.go` — `shouldDiscardContainer` and `isPoisonousExecutionError` could be better encapsulated in the pool/executor layer
- ⚠️ **Legacy execution path** — the old wrapper-based path (`ExecutionPathLegacy`) still exists in `main.go` but `/run` returns an error for it; the two paths diverge in maintenance burden
- ⚠️ **Batch stdout correlation** — in batch mode, all test cases' `stdout` is shared (the full stdout blob goes to every `TestResult.Stdout`), making per-test print debugging impossible
- ⚠️ **TypeScript has no batch support** — it shares the `judge-js-env` image but isn't wired into `shouldUseBatchedExecution`
- ⚠️ **Workspace sweeper has no per-submission size limit** — large outputs could fill disk before the sweeper runs
- ⚠️ **No rate limiting** on the `/run` HTTP endpoint — it directly acquires from the container pool and could starve async queue workers
- ⚠️ **`isCentralCompareEnabled` is a switch statement** — adding a language requires editing this function in addition to the adapter registry, a minor DRY violation
