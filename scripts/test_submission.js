const crypto = require("crypto");

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000/api";
const HARNESS_EMAIL = process.env.HARNESS_EMAIL || "judge-harness@example.com";
const HARNESS_PASSWORD = process.env.HARNESS_PASSWORD || "HarnessPass123!";
const HARNESS_NAME = process.env.HARNESS_NAME || "Judge Harness";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 30000);

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
    code: [
      "def twoSum(nums, target):",
      "    for i in range(len(nums)):",
      "        for j in range(i + 1, len(nums)):",
      "            if nums[i] + nums[j] == target:",
      "                return [i, j]"
    ].join("\n")
  },
  {
    name: "Wrong Answer",
    expectedVerdict: "Wrong Answer",
    code: [
      "def twoSum(nums, target):",
      "    return [0, 0]"
    ].join("\n")
  },
  {
    name: "Runtime Error",
    expectedVerdict: "Runtime Error",
    code: [
      "def twoSum(nums, target):",
      "    return 1 / 0"
    ].join("\n")
  },
  {
    name: "Time Limit Exceeded",
    expectedVerdict: "Time Limit Exceeded",
    code: [
      "def twoSum(nums, target):",
      "    while True:",
      "        pass"
    ].join("\n")
  }
];

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

async function submitSolution(token, problemId, code) {
  return request("/submissions", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      problemId,
      language: "python",
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

function printCaseResult(testCase, summary, ok) {
  const icon = ok ? "PASS" : "FAIL";
  const counts =
    summary.passed !== null && summary.total !== null
      ? ` ${summary.passed}/${summary.total}`
      : "";
  const path = summary.executionPath ? ` path=${summary.executionPath}` : "";
  const internal = summary.internalError ? ` internal=${summary.internalError}` : "";
  console.log(
    `[${icon}] ${testCase.name}: expected=${testCase.expectedVerdict} actual=${summary.verdict}${counts}${path}${internal}`
  );
}

async function runCase(token, problemId, testCase) {
  const created = await submitSolution(token, problemId, testCase.code);
  const submissionId = created && created._id;

  if (!submissionId) {
    throw new Error(`Submission response missing _id for case "${testCase.name}"`);
  }

  const completed = await pollSubmission(token, submissionId);
  const summary = summarizeSubmission(completed);
  const ok = summary.verdict === testCase.expectedVerdict;

  printCaseResult(testCase, summary, ok);
  return {
    ok,
    submissionId,
    summary,
    output: completed.output || "",
    details: completed.testResult && completed.testResult.details ? completed.testResult.details : []
  };
}

async function main() {
  console.log(`Using API: ${API_BASE_URL}`);

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

  const runId = crypto.randomBytes(4).toString("hex");
  console.log(`Harness run: ${runId}`);

  const results = [];
  for (const testCase of CASES) {
    results.push(await runCase(token, problem._id, testCase));
  }

  const failures = results.filter((result) => !result.ok);
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
    process.exitCode = 1;
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
