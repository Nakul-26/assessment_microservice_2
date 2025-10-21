Excellent — focusing on the **judge service** first is absolutely the right move.
It’s the **core engine** of your platform, and it’s where both **security** and **performance** really matter.

Let’s go step-by-step through how to **upgrade your current judge service** into a secure, modular, language-agnostic, and sandboxed system — the heart of your LeetCode clone.

---

## 🧠 1. What the Judge Service Does

The **Judge Service** receives a job like this:

```json
{
  "submissionId": "abc123",
  "problemId": "two-sum",
  "language": "python",
  "code": "def twoSum(nums, target): ...",
  "testCases": [
    { "input": "[2,7,11,15],9", "expectedOutput": "[0,1]" }
  ]
}
```

Its responsibilities are:

1. Prepare the **sandbox environment** (isolated runtime).
2. Merge the user’s code with a **boilerplate or wrapper** that runs tests.
3. Execute inside Docker with **resource limits**.
4. Capture stdout/stderr, check correctness.
5. Return a structured result (Accepted / Wrong Answer / Runtime Error, etc).

---

## 🧩 2. Boilerplates, Function Signatures, and Wrappers

Let’s clarify the roles:

### 🧱 Boilerplate

* Predefined **code templates** given to the user.
* Contains the function signature the user must implement.
* Example (Python “Two Sum”):

  ```python
  def twoSum(nums, target):
      # Write your code here
      pass
  ```

### ✍️ Function Signature

* Defines *exactly what* the user implements — e.g., function name and parameters.
* Stored per problem (in DB or problem file), so your judge knows **how to call** the user’s solution.

### 🧩 Function Wrapper

* This is **extra code injected by the judge** when running the submission.
* It:

  1. Imports the user’s function.
  2. Calls it with each test case.
  3. Compares results to expected output.
  4. Prints results in JSON or some known format.

Example Python wrapper:

```python
import json
from user_code import twoSum

def run_tests():
    tests = [
        {"input": ([2,7,11,15], 9), "expected": [0,1]},
        {"input": ([3,2,4], 6), "expected": [1,2]}
    ]
    results = []
    for t in tests:
        try:
            output = twoSum(*t["input"])
            results.append({"ok": output == t["expected"], "output": output})
        except Exception as e:
            results.append({"ok": False, "error": str(e)})
    print(json.dumps(results))

if __name__ == "__main__":
    run_tests()
```

At runtime, you **merge** the user’s code + wrapper into a single script inside the container and run it.
This way, users **can’t access the test cases** directly — they only see the boilerplate.

---

## 🧱 3. Secure Sandboxing (the real challenge)

You **must isolate user code** so it can’t harm the host or access sensitive data.

### ✅ Use Docker Containers for Execution

Each submission runs in a short-lived Docker container:

* Base image: e.g., `python:3.11-alpine`, `node:20-alpine`, etc.
* Mount a temp directory for `/app`.
* Copy merged code into container.
* Run command like:

  ```bash
  docker run --rm --network none --memory="256m" --cpus="0.5" \
    -v /tmp/submission123:/app python:3.11-alpine \
    python /app/run.py
  ```

**Important Docker Flags for Security:**

| Flag                                     | Purpose                                  |
| ---------------------------------------- | ---------------------------------------- |
| `--rm`                                   | Automatically remove container after run |
| `--network none`                         | Prevents internet access                 |
| `--memory`, `--cpus`                     | Limits resources                         |
| `--pids-limit 100`                       | Prevents fork bombs                      |
| `--read-only`                            | Prevents filesystem writes               |
| `--security-opt no-new-privileges`       | Disallows privilege escalation           |
| `--cap-drop=ALL`                         | Drops all Linux capabilities             |
| `--tmpfs /tmp:rw,noexec,nosuid,size=64M` | Creates a limited temp filesystem        |

Optionally:
Run containers under a **non-root user** inside the image.

---

## 🧰 4. Internal File Execution Flow

Inside the judge service (Node.js for example):

```
/judge-service
├── /languages
│   ├── python.js
│   ├── javascript.js
│   ├── cpp.js
├── /wrappers
│   ├── python_wrapper.py
│   ├── js_wrapper.js
│   ├── cpp_wrapper.cpp
├── executor.js
└── index.js
```

Each language module defines:

* **Docker image**
* **Compile command (if needed)**
* **Run command**

Example: `languages/python.js`

```js
export default {
  image: "python:3.11-alpine",
  fileExtension: ".py",
  runCmd: (fileName) => ["python", fileName]
}
```

`executor.js` orchestrates the flow:

```js
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import docker from "dockerode";
import pythonLang from "./languages/python.js";

async function runInDocker({ code, testWrapper, langConfig }) {
  const tmpDir = fs.mkdtempSync("/tmp/submission-");
  const fileName = "run" + langConfig.fileExtension;
  fs.writeFileSync(path.join(tmpDir, fileName), code + "\n" + testWrapper);

  const dockerClient = new docker();
  const container = await dockerClient.createContainer({
    Image: langConfig.image,
    Cmd: langConfig.runCmd(`/app/${fileName}`),
    HostConfig: {
      AutoRemove: true,
      NetworkMode: "none",
      Memory: 256 * 1024 * 1024,
      CpuQuota: 50000,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      PidsLimit: 100,
      Binds: [`${tmpDir}:/app:ro`],
    },
  });

  await container.start();
  const stream = await container.attach({ stream: true, stdout: true, stderr: true });
  
  let output = "";
  stream.on("data", (data) => (output += data.toString()));

  await container.wait();
  return output;
}
```

---

## 🧨 5. Additional Security Enhancements

1. **Timeout Enforcement**

   * Kill container if it runs longer than, say, 3 seconds.
   * Use Docker API or external timeout logic.

2. **No stdout flooding**

   * Capture logs with limits (e.g., max 4KB output).

3. **Language Restriction**

   * Disable dangerous functions if possible (e.g., Python’s `os`, `subprocess`).

4. **AppArmor / seccomp profiles**

   * Add Linux-level restrictions via `--security-opt`.
   * Example: `--security-opt seccomp=unconfined` (or custom profile).

5. **Temp Volume Isolation**

   * Never reuse temp directories between runs.

6. **Result Validation**

   * Only parse clean JSON results from wrapper (ignore stray prints).

---

## 🔧 6. Sandbox Alternatives (Beyond Docker)

If you later need **massive concurrency**:

* Use **Firecracker** microVMs (AWS Lambda tech).
* Use **gVisor** or **Kata Containers** for lightweight isolation.
* Or use **Judge0’s architecture** as a reference (open-source).

But Docker is **perfectly fine** for MVP → mid-scale.

---

## 📊 7. Returning Results

Have a standard structure for all responses:

```json
{
  "status": "Accepted",
  "passed": 10,
  "total": 10,
  "runtime": 0.56,
  "memory": 128,
  "details": [
    {"test": 1, "ok": true},
    {"test": 2, "ok": false, "error": "IndexError"}
  ]
}
```

This makes it easy for your frontend and API to consume results consistently.

---

## 🧩 8. Next Steps to Implement

| Step | Goal                                                          |
| ---- | ------------------------------------------------------------- |
| ✅ 1. | Create `/languages` configs (Python, JS, C++)                 |
| ✅ 2. | Implement wrapper generator per language                      |
| ✅ 3. | Use Dockerode to run code with sandbox limits                 |
| ✅ 4. | Implement timeout + output limit                              |
| ✅ 5. | Test malicious code (infinite loops, filesystem access, etc.) |
| ✅ 6. | Add result formatter + send results via RabbitMQ back to API  |

---

Would you like me to show you a **complete example** of a secure `judge-service` implementation (in Node.js), including:

* dynamic wrapper generation,
* Docker execution, and
* safe result parsing?

That would give you a production-grade starting point.
