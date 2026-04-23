const crypto = require("crypto");

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:3000/api";
const HARNESS_EMAIL = process.env.HARNESS_EMAIL || "judge-harness@example.com";
const HARNESS_PASSWORD = process.env.HARNESS_PASSWORD || "HarnessPass123!";
const HARNESS_NAME = process.env.HARNESS_NAME || "Judge Harness";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 30000);
const READY_MAX_RETRIES = Number(process.env.HARNESS_READY_RETRIES || 20);
const READY_RETRY_DELAY_MS = Number(process.env.HARNESS_READY_DELAY_MS || 1000);
const JUDGE_READY_ATTEMPTS = Number(process.env.HARNESS_JUDGE_READY_ATTEMPTS || 10);
const JUDGE_READY_TIMEOUT_MS = Number(process.env.HARNESS_JUDGE_READY_TIMEOUT_MS || 10000);
const JUDGE_READY_LANGUAGE = process.env.HARNESS_JUDGE_READY_LANGUAGE || "python";
const STRICT_MODE = process.env.HARNESS_STRICT !== "false";
const LANGUAGES = (process.env.HARNESS_LANGUAGES || "python,javascript,java")
  .split(",")
  .map((language) => language.trim().toLowerCase())
  .filter(Boolean);

const TEST_PROBLEM_TITLE = "Harness: Two Sum";

const TEST_PROBLEM = {
  title: TEST_PROBLEM_TITLE,
  description: "E2E harness problem for validating judge verdicts.",
  difficulty: "Easy",
  functionName: "twoSum",
  parameters: [
    { name: "nums", type: "array<number>" },
    { name: "target", type: "number" }
  ],
  returnType: "array<number>",
  compareConfig: {
    mode: "EXACT",
    floatTolerance: 0,
    orderInsensitive: false
  },
  testCases: [
    {
      inputs: [[2, 7, 11, 15], 9],
      expected: [0, 1],
      isSample: true
    },
    {
      inputs: [[3, 2, 4], 6],
      expected: [1, 2],
      isSample: false
    }
  ]
};

const CASES = [
  {
    name: "Correct",
    expectedVerdict: "Accepted",
    getCode: getCorrectCode
  },
  {
    name: "Wrong Answer",
    expectedVerdict: "Wrong Answer",
    getCode: getWrongCode
  },
  {
    name: "Runtime Error",
    expectedVerdict: "Runtime Error",
    getCode: getRuntimeCode
  },
  {
    name: "Time Limit Exceeded",
    expectedVerdict: "Time Limit Exceeded",
    getCode: getTimeoutCode
  }
];

function getCorrectCode(language) {
  switch (language) {
    case "python":
      return [
        "def twoSum(nums, target):",
        "    for i in range(len(nums)):",
        "        for j in range(i + 1, len(nums)):",
        "            if nums[i] + nums[j] == target:",
        "                return [i, j]"
      ].join("\n");
    case "javascript":
      return [
        "function twoSum(nums, target) {",
        "  for (let i = 0; i < nums.length; i++) {",
        "    for (let j = i + 1; j < nums.length; j++) {",
        "      if (nums[i] + nums[j] === target) {",
        "        return [i, j];",
        "      }",
        "    }",
        "  }",
        "}"
      ].join("\n");
    case "java":
      return [
        "class Solution {",
        "  public int[] twoSum(int[] nums, int target) {",
        "    for (int i = 0; i < nums.length; i++) {",
        "      for (int j = i + 1; j < nums.length; j++) {",
        "        if (nums[i] + nums[j] == target) {",
        "          return new int[] { i, j };",
        "        }",
        "      }",
        "    }",
        "    return new int[] {};",
        "  }",
        "}"
      ].join("\n");
    default:
      throw new Error(`Unsupported language for harness case generation: ${language}`);
  }
}

function getWrongCode(language) {
  switch (language) {
    case "python":
      return [
        "def twoSum(nums, target):",
        "    return [0, 0]"
      ].join("\n");
    case "javascript":
      return [
        "function twoSum(nums, target) {",
        "  return [0, 0];",
        "}"
      ].join("\n");
    case "java":
      return [
        "class Solution {",
        "  public int[] twoSum(int[] nums, int target) {",
        "    return new int[] { 0, 0 };",
        "  }",
        "}"
      ].join("\n");
    default:
      throw new Error(`Unsupported language for harness case generation: ${language}`);
  }
}

function getRuntimeCode(language) {
  switch (language) {
    case "python":
      return [
        "def twoSum(nums, target):",
        "    return 1 / 0"
      ].join("\n");
    case "javascript":
      return [
        "function twoSum(nums, target) {",
        "  throw new Error(\"boom\");",
        "}"
      ].join("\n");
    case "java":
      return [
        "class Solution {",
        "  public int[] twoSum(int[] nums, int target) {",
        "    throw new RuntimeException(\"boom\");",
        "  }",
        "}"
      ].join("\n");
    default:
      throw new Error(`Unsupported language for harness case generation: ${language}`);
  }
}

function getTimeoutCode(language) {
  switch (language) {
    case "python":
      return [
        "def twoSum(nums, target):",
        "    while True:",
        "        pass"
      ].join("\n");
    case "javascript":
      return [
        "function twoSum(nums, target) {",
        "  while (true) {}",
        "}"
      ].join("\n");
    case "java":
      return [
        "class Solution {",
        "  public int[] twoSum(int[] nums, int target) {",
        "    while (true) {}",
        "  }",
        "}"
      ].join("\n");
    default:
      throw new Error(`Unsupported language for harness case generation: ${language}`);
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch (err) {
      body = text;
    }
  }

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

function getNetworkErrorCode(err) {
  if (err && err.cause && typeof err.cause === "object" && "code" in err.cause) {
    return err.cause.code;
  }

  return "";
}

function buildAPIReadinessError(lastError) {
  const code = getNetworkErrorCode(lastError);
  const parts = [
    `API not ready after ${READY_MAX_RETRIES} attempts.`,
    `Base URL: ${API_BASE_URL}.`
  ];

  if (code) {
    parts.push(`Last network error: ${code}.`);
  }

  parts.push(
    "If Docker is running outside this workspace, localhost here will not reach it."
  );
  parts.push(
    "Run `npm run test:submission:docker` to execute inside the Docker Compose network, or set API_BASE_URL to a reachable host."
  );
  parts.push("You can also verify connectivity with: curl http://localhost:3000/api/problems");

  return parts.join(" ");
}

async function waitForAPI() {
  let lastError = null;

  for (let attempt = 1; attempt <= READY_MAX_RETRIES; attempt += 1) {
    try {
      await request("/problems");
      console.log("API ready.");
      return;
    } catch (err) {
      lastError = err;
      const finalAttempt = attempt === READY_MAX_RETRIES;
      const status = err.status ? ` status=${err.status}` : "";
      const code = getNetworkErrorCode(err);
      const network = code ? ` code=${code}` : "";
      console.log(
        `Waiting for API (${attempt}/${READY_MAX_RETRIES})...${status}${network}`
      );

      if (finalAttempt) {
        throw new Error(buildAPIReadinessError(lastError));
      }

      await new Promise((resolve) => setTimeout(resolve, READY_RETRY_DELAY_MS));
    }
  }
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function registerOrLogin() {
  const payload = {
    name: HARNESS_NAME,
    email: HARNESS_EMAIL,
    password: HARNESS_PASSWORD,
    role: "faculty"
  };

  try {
    const registered = await request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return registered;
  } catch (err) {
    if (err.status !== 409) {
      throw err;
    }
  }

  return request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: HARNESS_EMAIL,
      password: HARNESS_PASSWORD
    })
  });
}

async function findExistingProblemId() {
  const problems = await request("/problems");
  const match = Array.isArray(problems)
    ? problems.find((problem) => problem.title === TEST_PROBLEM_TITLE)
    : null;
  return match ? match._id : null;
}

async function upsertProblem(token) {
  const problemId = await findExistingProblemId();
  if (problemId) {
    const updated = await request(`/problems/${problemId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(TEST_PROBLEM)
    });
    return updated.problem;
  }

  const created = await request("/problems", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(TEST_PROBLEM)
  });
  return created.problem;
}

async function submitSolution(token, problemId, language, code) {
  return request("/submissions", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      problemId,
      language,
      code
    })
  });
}

function extractVerdict(submission) {
  if (submission && submission.testResult && submission.testResult.status) {
    return submission.testResult.status;
  }

  switch (submission && submission.status) {
    case "Success":
      return "Accepted";
    case "Fail":
      return "Wrong Answer";
    case "Error":
      return "Runtime Error";
    default:
      return submission && submission.status ? submission.status : "Unknown";
  }
}

function isTerminalStatus(status) {
  return status && status !== "Pending" && status !== "Running";
}

async function pollSubmission(token, submissionId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const submission = await request(`/submissions/${submissionId}`, {
      headers: authHeaders(token)
    });

    if (isTerminalStatus(submission.status)) {
      return submission;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Polling timed out after ${POLL_TIMEOUT_MS}ms for submission ${submissionId}`);
}

async function pollSubmissionUntilReady(token, submissionId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const submission = await request(`/submissions/${submissionId}`, {
      headers: authHeaders(token)
    });

    if (isTerminalStatus(submission.status)) {
      return submission;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return null;
}

function summarizeSubmission(submission) {
  const testResult = submission.testResult || {};
  return {
    submissionStatus: submission.status,
    verdict: extractVerdict(submission),
    executionPath: testResult.executionPath || "",
    internalError: testResult.internalError || "",
    passed: testResult.passedCount ?? testResult.passed ?? null,
    total: testResult.totalCount ?? testResult.total ?? null,
    firstFailedTest: testResult.firstFailedTest ?? null
  };
}

function printCaseResult(language, testCase, summary, ok) {
  const icon = ok ? "PASS" : "FAIL";
  const counts =
    summary.passed !== null && summary.total !== null
      ? ` ${summary.passed}/${summary.total}`
      : "";
  const path = summary.executionPath ? ` path=${summary.executionPath}` : "";
  const internal = summary.internalError ? ` internal=${summary.internalError}` : "";
  console.log(
    `[${icon}] ${language} ${testCase.name}: expected=${testCase.expectedVerdict} actual=${summary.verdict}${counts}${path}${internal}`
  );
}

async function runCase(token, problemId, language, testCase) {
  const created = await submitSolution(token, problemId, language, testCase.getCode(language));
  const submissionId = created && created._id;

  if (!submissionId) {
    throw new Error(`Submission response missing _id for case "${language}:${testCase.name}"`);
  }

  const completed = await pollSubmission(token, submissionId);
  const summary = summarizeSubmission(completed);
  const ok = summary.verdict === testCase.expectedVerdict;

  printCaseResult(language, testCase, summary, ok);
  return {
    ok,
    language,
    caseName: testCase.name,
    submissionId,
    summary,
    output: completed.output || "",
    details: completed.testResult && completed.testResult.details ? completed.testResult.details : []
  };
}

async function waitForJudgeReady(token, problemId) {
  console.log(`Waiting for judge readiness via ${JUDGE_READY_LANGUAGE} warm-up submission...`);

  const warmupCode = getCorrectCode(JUDGE_READY_LANGUAGE);

  for (let attempt = 1; attempt <= JUDGE_READY_ATTEMPTS; attempt += 1) {
    const created = await submitSolution(token, problemId, JUDGE_READY_LANGUAGE, warmupCode);
    const submissionId = created && created._id;

    if (!submissionId) {
      throw new Error(`Judge warm-up response missing _id on attempt ${attempt}`);
    }

    const completed = await pollSubmissionUntilReady(token, submissionId, JUDGE_READY_TIMEOUT_MS);
    if (completed) {
      const summary = summarizeSubmission(completed);
      console.log(
        `Judge ready on attempt ${attempt}: verdict=${summary.verdict} status=${summary.submissionStatus}`
      );
      return;
    }

    console.log(`Judge not ready yet (${attempt}/${JUDGE_READY_ATTEMPTS})...`);
  }

  throw new Error(
    `Judge not processing submissions after ${JUDGE_READY_ATTEMPTS} attempts. Check judge logs and RabbitMQ connectivity.`
  );
}

async function main() {
  console.log(`Using API: ${API_BASE_URL}`);
  console.log(`Languages: ${LANGUAGES.join(", ")}`);
  console.log(`Strict mode: ${STRICT_MODE ? "on" : "off"}`);
  console.log(`Readiness wait: ${READY_MAX_RETRIES} retries, ${READY_RETRY_DELAY_MS}ms delay`);
  console.log(
    `Judge readiness: ${JUDGE_READY_ATTEMPTS} attempts, ${JUDGE_READY_TIMEOUT_MS}ms timeout, language=${JUDGE_READY_LANGUAGE}`
  );

  await waitForAPI();

  const auth = await registerOrLogin();
  const token = auth && auth.token;
  if (!token) {
    throw new Error("Authentication response missing token");
  }

  const problem = await upsertProblem(token);
  if (!problem || !problem._id) {
    throw new Error("Problem upsert did not return an _id");
  }

  console.log(`Problem ready: ${problem.title} (${problem._id})`);

  await waitForJudgeReady(token, problem._id);

  const runId = crypto.randomBytes(4).toString("hex");
  console.log(`Harness run: ${runId}`);

  const results = [];
  for (const language of LANGUAGES) {
    console.log("");
    console.log(`=== ${language.toUpperCase()} ===`);
    for (const testCase of CASES) {
      results.push(await runCase(token, problem._id, language, testCase));
    }
  }

  const failures = results.filter((result) => !result.ok);
  const passed = results.length - failures.length;

  console.log("");
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.error("");
    console.error("Failures:");
    for (const failure of failures) {
      console.error(JSON.stringify(failure.summary, null, 2));
      if (failure.output) {
        console.error(failure.output);
      }
      if (failure.details.length > 0) {
        console.error(JSON.stringify(failure.details, null, 2));
      }
    }

    if (STRICT_MODE) {
      console.error("");
      console.error("Harness failed in strict mode.");
      process.exitCode = 1;
    }
    return;
  }

  console.log("");
  console.log(`All ${results.length} submission cases passed.`);
}

main().catch((err) => {
  console.error("Harness error:", err.message);
  if (err.body) {
    console.error(JSON.stringify(err.body, null, 2));
  }
  process.exitCode = 1;
});
