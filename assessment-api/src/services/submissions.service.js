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
      if (!("input" in t) || !("expectedOutput" in t)) return false;
    }
  }
  return true;
}

export async function submitSolution({ problemId, code, language }) {
  const submission = await submissionsRepo.create({
    problemId,
    code,
    language,
    status: "Pending"
  });

  const problem = await problemsRepo.findById(problemId);
  if (!problem) {
    return { notFound: true, submission };
  }

  const tests = problem.testCases.map((tc) => ({
    input: tc.input,
    expectedOutput: tc.expectedOutput,
    isHidden: tc.isHidden
  }));

  const functionName = problem.functionDefinitions.get(language)?.name || "solution";

  const messageBody = {
    schemaVersion: "v2",
    submissionId: submission._id.toString(),
    problemId: problem._id.toString(),
    language,
    code,
    tests: tests,
    functionName: functionName
  };

  if (!validateSubmissionMessage(messageBody)) {
    throw new HttpError(500, "Invalid submission message", { msg: "Internal server error: invalid submission message" });
  }

  await publishSubmissionMessage(messageBody);

  return { submission };
}

export async function getSubmissionById(id) {
  const cacheKey = `submission:${id}`;
  const cached = await getCacheJSON(cacheKey);
  if (cached) {
    return { cached: true, submission: cached };
  }

  const submission = await submissionsRepo.findById(id);
  if (!submission) {
    return { notFound: true };
  }

  if (submission.status === "Success" || submission.status === "Fail") {
    await setCacheJSON(cacheKey, submission, 3600);
  }

  return { submission };
}
