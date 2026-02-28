import * as problemsRepo from "../repositories/problems.repo.js";
import { HttpError } from "../utils/httpError.js";

function isPrivilegedRole(role) {
  return role === "admin" || role === "faculty" || role === "superadmin";
}

function isSampleTestCase(tc = {}) {
  if (typeof tc.isSample === "boolean") return tc.isSample;
  if (typeof tc.isHidden === "boolean") return !tc.isHidden;
  return true;
}

function toStoredTestCase(tc = {}) {
  const sample = isSampleTestCase(tc);
  return {
    ...tc,
    isSample: sample,
    isHidden: !sample
  };
}

function normalizeProblemPayload(payload = {}) {
  if (!Array.isArray(payload.testCases)) return payload;
  return {
    ...payload,
    testCases: payload.testCases.map(toStoredTestCase)
  };
}

function sanitizeProblemForStudent(problemDoc) {
  const problem = typeof problemDoc.toObject === "function" ? problemDoc.toObject() : { ...problemDoc };
  const visibleCases = Array.isArray(problem.testCases)
    ? problem.testCases
        .filter((tc) => isSampleTestCase(tc))
        .map((tc) => ({
          ...tc,
          isSample: true,
          isHidden: false
        }))
    : [];

  return {
    ...problem,
    testCases: visibleCases
  };
}

function validateProblemPayload(payload) {
  const validationErrors = [];
  if (Array.isArray(payload.testCases)) {
    payload.testCases.forEach((tc, i) => {
      if (tc.input === undefined || tc.input === null) {
        validationErrors.push(`testCases[${i}].input is required`);
      }
      if (tc.expectedOutput === undefined || tc.expectedOutput === null) {
        validationErrors.push(`testCases[${i}].expectedOutput is required`);
      }
    });
  }

  const fnDefs = payload.functionDefinitions || {};
  const hasFn = Object.keys(fnDefs).some(
    (k) => fnDefs[k] && fnDefs[k].name && fnDefs[k].template
  );
  if (!hasFn) {
    validationErrors.push(
      "At least one function definition (name and template) must be provided for a language."
    );
  }

  return validationErrors;
}

function parsePagination(query) {
  const page = Number(query.page || 1);
  const limitRaw = Number(query.limit || 0);
  const limit = Number.isFinite(limitRaw) ? Math.max(0, Math.min(100, limitRaw)) : 0;
  const safePage = Number.isFinite(page) ? Math.max(1, page) : 1;
  const options = {};
  if (limit > 0) {
    options.limit = limit;
    options.skip = (safePage - 1) * limit;
  }
  return options;
}

function buildProblemFilter(query) {
  const filter = {};
  if (query.difficulty) filter.difficulty = query.difficulty;
  if (query.tag) filter.tags = query.tag;
  return filter;
}

export async function listProblems(query = {}) {
  const filter = buildProblemFilter(query);
  const options = parsePagination(query);
  return problemsRepo.findAllWithoutTests(filter, options);
}

export async function getProblemById(id, user = null) {
  const problem = await problemsRepo.findById(id);
  if (!problem) return null;

  if (isPrivilegedRole(user && user.role)) {
    return problem;
  }

  return sanitizeProblemForStudent(problem);
}

export async function createProblem(payload) {
  const normalizedPayload = normalizeProblemPayload(payload);
  const validationErrors = validateProblemPayload(normalizedPayload);
  if (validationErrors.length > 0) {
    throw new HttpError(400, "Validation failed", { msg: "Validation failed", errors: validationErrors });
  }
  return problemsRepo.create(normalizedPayload);
}

export async function updateProblem(id, payload) {
  const normalizedPayload = normalizeProblemPayload(payload);
  const validationErrors = validateProblemPayload(normalizedPayload);
  if (validationErrors.length > 0) {
    throw new HttpError(400, "Validation failed", { msg: "Validation failed", errors: validationErrors });
  }
  return problemsRepo.updateById(id, normalizedPayload);
}

export async function deleteProblem(id) {
  return problemsRepo.deleteById(id);
}
