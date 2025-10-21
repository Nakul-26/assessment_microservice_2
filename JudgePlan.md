Awesome — below is a **complete, pragmatic implementation plan + code** you can drop into your judge-service. It includes:

* a clear directory layout
* language configs (Python + Node.js; you can add others)
* wrapper/boilerplate generation
* a robust `executor` that runs merged code inside an isolated Docker container (using `dockerode`)
* timeouts, resource limits, output-size caps, JSON-result parsing
* message queue handling sketch (RabbitMQ)
* security hardening recommendations & Docker flags
* example Dockerfiles and `docker-compose` snippets to run the judge worker

I focused on code you can use immediately and extend. Copy/paste, run, and expand.

---

# 1) Directory layout (recommended)

```
judge-service/
├── src/
│   ├── index.js                # main: consume RabbitMQ messages
│   ├── executor.js             # runs code in Docker
│   ├── languages/
│   │    ├── python.js
│   │    └── javascript.js
│   ├── wrappers/
│   │    ├── python_wrapper.tpl
│   │    └── js_wrapper.tpl
│   ├── utils/
│   │    └── safe-io.js
│   └── config.js
├── Dockerfile                   # judge-service container (worker)
├── package.json
└── README.md
```

---

# 2) `package.json` (basic)

```json
{
  "name": "judge-service",
  "version": "1.0.0",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "amqplib": "^0.10.3",
    "dockerode": "^3.3.0",
    "fs-extra": "^11.1.1",
    "uuid": "^9.0.0"
  }
}
```

---

# 3) `src/config.js` — central config

```js
export const RABBITMQ = {
  URL: process.env.RABBITMQ_URL || "amqp://rabbitmq:5672",
  SUBMISSION_QUEUE: process.env.SUBMISSION_QUEUE || "submission_queue",
  RESULT_QUEUE: process.env.RESULT_QUEUE || "submission_results",
};

export const SANDBOX = {
  TIMEOUT_MS: Number(process.env.SANDBOX_TIMEOUT_MS || 5000), // default 5s
  MEMORY_BYTES: Number(process.env.SANDBOX_MEMORY_BYTES || 256 * 1024 * 1024), // 256MB
  CPU_SHARES: Number(process.env.SANDBOX_CPU_SHARES || 512), // relative
  PIDS_LIMIT: Number(process.env.SANDBOX_PIDS_LIMIT || 64),
  MAX_STDOUT_BYTES: Number(process.env.MAX_STDOUT_BYTES || 64 * 1024), // 64KB
};
```

---

# 4) `src/languages/python.js` and `src/languages/javascript.js` — language configs

`src/languages/python.js`:

```js
export default {
  id: "python",
  image: "python:3.11-alpine",
  fileExt: ".py",
  // command args array to run the file inside container
  runCmd: (filePath) => ["python", filePath],
  wrapperTemplate: "python_wrapper.tpl" // file in src/wrappers
};
```

`src/languages/javascript.js`:

```js
export default {
  id: "javascript",
  image: "node:20-alpine",
  fileExt: ".js",
  runCmd: (filePath) => ["node", filePath],
  wrapperTemplate: "js_wrapper.tpl"
};
```

(You can add C/C++ later with compile step + run step.)

---

# 5) `src/wrappers/python_wrapper.tpl` (template)

This wrapper expects the user's function to be defined with the exact signature. It collects results and prints a single JSON object to STDOUT.

```
# wrapper injected by judge (do not expose to users)
import json, sys, traceback

# --- user code will be inserted above this block ---
# USER_CODE_MARKER

def run_tests():
    tests = {{TESTS_JSON}}  # inserted by wrapper generator, array of {"input": [...], "expected": ...}
    results = []
    for i, t in enumerate(tests):
        try:
            out = solution(*t.get("input", []))
            ok = out == t.get("expected")
            results.append({"test": i+1, "ok": ok, "output": out})
        except Exception as e:
            tb = traceback.format_exc()
            results.append({"test": i+1, "ok": False, "error": str(e), "traceback": tb})
    summary = {
        "status": "finished",
        "passed": sum(1 for r in results if r.get("ok")),
        "total": len(results),
        "details": results
    }
    print(json.dumps(summary))
    sys.stdout.flush()

if __name__ == "__main__":
    run_tests()
```

Notes:

* The wrapper expects the user's function to be named `solution` (you can adapt to call specific named functions by renaming / adding call code).
* `{{TESTS_JSON}}` will be replaced by the judge-service with a JSON string of test cases. We keep testcases out of user scope by injecting them at runtime.

---

# 6) `src/wrappers/js_wrapper.tpl` (template)

```
const tests = {{TESTS_JSON}};

async function runTests(solution) {
  const results = [];
  for (let i = 0; i < tests.length; ++i) {
    const t = tests[i];
    try {
      const out = await solution(...(t.input || []));
      const ok = JSON.stringify(out) === JSON.stringify(t.expected);
      results.push({ test: i+1, ok, output: out });
    } catch (err) {
      results.push({ test: i+1, ok: false, error: String(err), stack: err.stack });
    }
  }
  const summary = { status: "finished", passed: results.filter(r=>r.ok).length, total: results.length, details: results };
  console.log(JSON.stringify(summary));
  process.stdout.write(""); // flush
}

(async () => {
  // USER_CODE_MARKER - user's code will be prepended here and should export function 'solution'
  if (typeof solution !== "function") {
    console.log(JSON.stringify({ status: "error", message: "No solution function exported" }));
    process.exit(1);
  }
  await runTests(solution);
})();
```

---

# 7) `src/executor.js` — the core execution/runner

This file handles merging user code + wrapper, creating a temp dir, creating a Docker container via `dockerode`, streaming output with a size cap, enforcing timeout, and returning parsed JSON.

```js
import Docker from "dockerode";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { SANDBOX } from "./config.js";

const docker = new Docker();

const MAX_OUTPUT_BYTES = SANDBOX.MAX_STDOUT_BYTES;

function safeParseJSONFromOutput(output) {
  // sometimes wrapper might print other stuff; find the last JSON blob
  const lastOpen = output.lastIndexOf("{");
  const lastClose = output.lastIndexOf("}");
  if (lastOpen >= 0 && lastClose > lastOpen) {
    try {
      return JSON.parse(output.slice(lastOpen, lastClose + 1));
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * runSubmission
 * @param {Object} opts
 *  - language: language config (from languages/*.js)
 *  - userCode: string
 *  - tests: array of { input: [...], expected: ... }
 *  - timeoutMs: optional override
 */
export async function runSubmission({ language, userCode, tests = [], timeoutMs }) {
  const id = uuidv4();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `submission-${id}-`));
  try {
    const fileName = `submission${language.fileExt}`;
    const filePath = path.join(tmpDir, fileName);

    // Load wrapper template
    const wrapperTpl = await fs.readFile(path.join(process.cwd(), "src", "wrappers", language.wrapperTemplate), "utf8");
    // replace TESTS_JSON placeholder safely
    const testsJson = JSON.stringify(tests);
    const merged = wrapperTpl.replace("{{TESTS_JSON}}", testsJson).replace("# USER_CODE_MARKER", "");
    // Some wrappers prepend user code at top; we will merge by simply writing user code first then wrapper.
    await fs.writeFile(filePath, `${userCode}\n\n\n${merged}`, { mode: 0o644 });

    // create container
    const memory = SANDBOX.MEMORY_BYTES;
    const cpuShares = SANDBOX.CPU_SHARES;
    const pidsLimit = SANDBOX.PIDS_LIMIT;
    const timeout = timeoutMs || SANDBOX.TIMEOUT_MS;

    const createOpts = {
      Image: language.image,
      Cmd: language.runCmd(`/app/${fileName}`),
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      HostConfig: {
        AutoRemove: true,
        NetworkMode: "none",
        Memory: memory,
        CpuShares: cpuShares,
        PidsLimit: pidsLimit,
        ReadonlyRootfs: false, // set to true if image allows working directory mapping
        Binds: [`${tmpDir}:/app:ro`],
        Tmpfs: { "/tmp": "rw,exec,nosuid,size=64m" },
        CapDrop: ["ALL"]
      }
    };

    const container = await docker.createContainer(createOpts);

    // start & attach
    await container.start();
    const stream = await container.attach({ stream: true, stdout: true, stderr: true });

    // stream output with a cap
    let output = "";
    let outputBytes = 0;
    const onData = (chunk) => {
      if (outputBytes >= MAX_OUTPUT_BYTES) return;
      const s = chunk.toString();
      const newBytes = Buffer.byteLength(s);
      if (outputBytes + newBytes > MAX_OUTPUT_BYTES) {
        // append only remaining slice
        const allowed = MAX_OUTPUT_BYTES - outputBytes;
        output += s.slice(0, allowed);
        outputBytes = MAX_OUTPUT_BYTES;
      } else {
        output += s;
        outputBytes += newBytes;
      }
    };
    stream.on("data", onData);

    // enforce timeout
    let timedOut = false;
    const killPromise = new Promise((resolve) => {
      const timer = setTimeout(async () => {
        timedOut = true;
        try {
          await container.kill().catch(()=>{});
        } catch(e) {}
        clearTimeout(timer);
        resolve();
      }, timeout);
    });

    // wait for end or timeout
    const waitRes = await Promise.race([
      container.wait(),
      killPromise
    ]);

    // detach stream
    try { stream.removeAllListeners("data"); } catch (e) {}

    // grab logs too (in-case something remained)
    try {
      const logs = await container.logs({ stdout: true, stderr: true, timestamps: false });
      onData(logs.toString());
    } catch (e) {}

    if (timedOut) {
      return {
        status: "timeout",
        message: `Execution exceeded ${timeout} ms`,
        rawOutput: output
      };
    }

    // parse last JSON from output
    const parsed = safeParseJSONFromOutput(output);
    if (parsed) {
      return {
        status: "ok",
        result: parsed,
        rawOutput: output
      };
    } else {
      // wrapper didn't produce valid JSON result — runtime error, or wrapper error
      return {
        status: "error",
        message: "No valid result produced by wrapper",
        rawOutput: output
      };
    }

  } finally {
    // cleanup tmp
    try { await fs.remove(tmpDir); } catch (e) {}
  }
}
```

Key points:

* Uses Dockerode to create container programmatically (so you can control/monitor).
* Binds a read-only volume (`:ro`) so container cannot modify host files.
* Limits network (`NetworkMode: "none"`), memory, CPU, PIDs, drops capabilities.
* Enforces execution timeout and caps stream length to avoid DoS via huge stdout.

---

# 8) `src/index.js` — RabbitMQ consumer & result publisher

This is a minimal consumer; adapt to your message formats.

```js
import amqplib from "amqplib";
import { RABBITMQ } from "./config.js";
import { runSubmission } from "./executor.js";
import pythonLang from "./languages/python.js";
import jsLang from "./languages/javascript.js";

const LANGS = {
  python: pythonLang,
  javascript: jsLang
};

async function start() {
  const conn = await amqplib.connect(RABBITMQ.URL);
  const ch = await conn.createChannel();
  await ch.assertQueue(RABBITMQ.SUBMISSION_QUEUE, { durable: true });
  await ch.assertQueue(RABBITMQ.RESULT_QUEUE, { durable: true });

  console.log("Judge worker ready, waiting for messages...");

  ch.consume(RABBITMQ.SUBMISSION_QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const body = JSON.parse(msg.content.toString());
      // expected body: { submissionId, problemId, language, code, tests }
      const { submissionId, language: langId, code, tests } = body;
      const lang = LANGS[langId];
      if (!lang) throw new Error(`Unsupported language: ${langId}`);

      // run
      const out = await runSubmission({ language: lang, userCode: code, tests, timeoutMs: undefined });

      // assemble result
      const resultMsg = {
        submissionId,
        language: langId,
        result: out,
        timestamp: Date.now()
      };

      // publish to results queue
      ch.sendToQueue(RABBITMQ.RESULT_QUEUE, Buffer.from(JSON.stringify(resultMsg)), { persistent: true });

      // ack the original message
      ch.ack(msg);
    } catch (err) {
      console.error("Error processing submission:", err);
      // normally you'd nack or move to dead-letter queue
      try { ch.nack(msg, false, false); } catch (e) {}
    }
  }, { noAck: false });
}

start().catch(e => {
  console.error(e);
  process.exit(1);
});
```

---

# 9) Security & hardening checklist (practical)

* **No network:** `NetworkMode: "none"` avoids downloads & exfiltration.
* **Resource limits:** memory/CPU and `pids_limit` prevent fork bombs.
* **CapDrop:** `CapDrop: ["ALL"]` reduces kernel capabilities.
* **Non-root inside image:** Build or choose images that run processes as an unprivileged user (see Dockerfile below).
* **Readonly mounts:** mount the code dir read-only if possible; `tmp` can be tmpfs with limited size.
* **Seccomp/AppArmor:** Add `SecurityOpt` with a stricter seccomp profile or apparmor profile if available. In docker-compose / k8s you can apply.
* **Trim logs:** limit stdout/stderr capture to avoid huge output.
* **Timeout enforcement:** kill runaway processes reliably via Docker API.
* **Result whitelisting:** only accept the well-formed JSON result from wrapper; ignore other prints.
* **Sanitize user code when placing into files** — treat all inputs as untrusted.

---

# 10) Example Dockerfile for judge worker (not the sandbox images)

This is for the judge-service itself (the worker that uses dockerode). The actual sandboxed execution uses official language images.

```dockerfile
FROM node:20-alpine

# Create non-root user for this service
RUN addgroup -S judge && adduser -S judge -G judge

WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm ci --only=production

COPY src ./src
RUN chown -R judge:judge /usr/src/app

USER judge
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
```

Note: the language containers (e.g., `python:3.11-alpine`, `node:20-alpine`) run user code; you may want to create custom small images that add a non-root user and remove package managers to reduce attack surface.

---

# 11) Example `docker-compose.yml` snippet (for local dev)

```yaml
version: "3.8"
services:
  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"

  judge:
    build: .
    environment:
      - RABBITMQ_URL=amqp://rabbitmq:5672
    depends_on:
      - rabbitmq
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # judge needs Docker daemon
```

> **Warning:** mounting docker.sock provides the container high privileges to control Docker — ok in controlled dev but in prod you should run judge workers on host that can access Docker daemon or use alternative (like a remote Docker daemon over TLS) or run under Kubernetes with proper RBAC.

---

# 12) How to add a new language (summary)

1. Add `src/languages/<lang>.js` with image, fileExt, runCmd, wrapperTemplate.
2. Add `src/wrappers/<lang>_wrapper.tpl` for standardized JSON output.
3. Optionally add compile steps in `executor.runSubmission` if language requires compilation.
4. Add to `LANGS` map in `src/index.js`.

---

# 13) Tests & malicious examples to try

* Infinite loop:

  ```py
  while True:
      pass
  ```

  Expect: timeout, container killed.

* Fork bomb (limited by pids_limit, CPU, memory):

  ```py
  import os
  while True:
      os.fork()
  ```

* filesystem access:

  ```py
  open("/etc/passwd").read()
  ```

  If container is read-only and has minimal files, should be limited. Still, do not mount sensitive host dirs.

* large output:

  ```py
  for i in range(10**7):
      print("x"*1000)
  ```

  Expect: output truncated by MAX_STDOUT_BYTES and gracefully handled.

---

# 14) Scaling recommendations

* Run multiple judge workers (scale horizontally) each connecting to RabbitMQ.
* Use a small pool of language-specific Docker images pre-pulled on hosts to reduce cold-start latency.
* For very high scale: consider Firecracker microVMs or gVisor for stronger isolation; or use a managed execution cluster.

---

# 15) Next steps I can provide right away (pick one)

* Provide a full, runnable repository (zipped) with the files above ready for local `docker-compose`.
* Add support for compiled languages (C/C++): show compile step, binary sandboxing.
* Add advanced seccomp profile + example Kubernetes Job manifests for safe execution.

Which of those would you like me to produce now?
