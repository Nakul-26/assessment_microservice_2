import * as submissionsRepo from "../repositories/submissions.repo.js";
import * as problemsRepo from "../repositories/problems.repo.js";
import { publishSubmissionMessage } from "./evaluation.service.js";
import { getCacheJSON, setCacheJSON } from "./cache.service.js";
import { HttpError } from "../utils/httpError.js";

function validateSubmissionMessage(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (!msg.submissionId || !msg.problemId || !msg.language || !msg.code || !msg.functionName) return false;
  if (msg.tests && !Array.isArray(msg.tests)) return false;
  if (Array.isArray(msg.tests)) {
    for (const t of msg.tests) {
      if (typeof t !== "object") return false;
      if (!("inputs" in t) || !("expected" in t)) return false;
    }
  }
  return true;
}

function canAccessSubmission(submission, { userId, role }) {
  if (!submission || !userId) return false;
  if (role === "admin" || role === "faculty" || role === "superadmin") return true;
  return String(submission.userId) === String(userId);
}

function isPrivilegedRole(role) {
  return role === "admin" || role === "faculty" || role === "superadmin";
}

function isSampleTestCase(tc = {}) {
  if (typeof tc.isSample === "boolean") return tc.isSample;
  if (typeof tc.isHidden === "boolean") return !tc.isHidden;
  return true;
}

function parseOutputJSON(output) {
  if (!output || typeof output !== "string") return null;
  try {
    return JSON.parse(output);
  } catch (err) {
    return null;
  }
}

function sanitizeResultDetails(details = [], testCases = []) {
  return details.map((detail, idx) => {
    const testIndexFromPayload = Number.isInteger(detail.test) ? detail.test - 1 : idx;
    const tc = testCases[testIndexFromPayload];
    const hidden = tc ? !isSampleTestCase(tc) : false;

    if (!hidden) {
      return detail;
    }

    return {
      test: detail.test,
      ok: detail.ok
    };
  });
}

function sanitizeSubmissionForStudent(submission, problem) {
  if (!submission || !problem || !Array.isArray(problem.testCases)) {
    return submission;
  }

  const normalized = typeof submission.toObject === "function" ? submission.toObject() : { ...submission };
  const parsedOutput = parseOutputJSON(normalized.output);

  if (parsedOutput && Array.isArray(parsedOutput.details)) {
    parsedOutput.details = sanitizeResultDetails(parsedOutput.details, problem.testCases);
    normalized.output = JSON.stringify(parsedOutput);
  }

  if (normalized.testResult && Array.isArray(normalized.testResult.details)) {
    normalized.testResult = {
      ...normalized.testResult,
      details: sanitizeResultDetails(normalized.testResult.details, problem.testCases)
    };
  }

  return normalized;
}

export async function submitSolution({ problemId, code, language, userId }) {
  const submission = await submissionsRepo.create({
    problemId,
    code,
    language,
    userId,
    status: "Pending"
  });

  const problem = await problemsRepo.findById(problemId);
  if (!problem) {
    return { notFound: true, submission };
  }

  const tests = problem.testCases.map((tc) => ({
    inputs: tc.inputs,
    expected: tc.expected,
    isHidden: !isSampleTestCase(tc),
    isSample: isSampleTestCase(tc)
  }));

  const functionName = problem.functionName || "solution";

  const messageBody = {
    schemaVersion: "v2",
    submissionId: submission._id.toString(),
    problemId: problem._id.toString(),
    language,
    code,
    tests: tests,
    functionName: functionName,
    compareMode: problem.compareConfig?.mode || "EXACT"
  };

  if (!validateSubmissionMessage(messageBody)) {
    throw new HttpError(500, "Invalid submission message", { msg: "Internal server error: invalid submission message" });
  }

  await publishSubmissionMessage(messageBody);

  return { submission };
}

export async function getSubmissionById(id, auth = {}) {
  const cacheKey = `submission:${id}`;
  const cached = await getCacheJSON(cacheKey);
  if (cached) {
    if (!canAccessSubmission(cached, auth)) {
      return { forbidden: true };
    }
    if (!isPrivilegedRole(auth.role)) {
      const problem = await problemsRepo.findById(cached.problemId);
      return { cached: true, submission: sanitizeSubmissionForStudent(cached, problem) };
    }
    return { cached: true, submission: cached };
  }

  const submission = await submissionsRepo.findById(id);
  if (!submission) {
    return { notFound: true };
  }

  if (!canAccessSubmission(submission, auth)) {
    return { forbidden: true };
  }

  if (submission.status === "Success" || submission.status === "Fail") {
    await setCacheJSON(cacheKey, submission, 3600);
  }

  if (!isPrivilegedRole(auth.role)) {
    const problem = await problemsRepo.findById(submission.problemId);
    return { submission: sanitizeSubmissionForStudent(submission, problem) };
  }

  return { submission };
}

export async function getMySubmissions(userId) {
  const submissions = await submissionsRepo.findByUserId(userId);
  return { submissions };
}
