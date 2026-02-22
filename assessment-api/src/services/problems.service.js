import * as problemsRepo from "../repositories/problems.repo.js";
import { HttpError } from "../utils/httpError.js";

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

export async function getProblemById(id) {
  return problemsRepo.findById(id);
}

export async function createProblem(payload) {
  const validationErrors = validateProblemPayload(payload);
  if (validationErrors.length > 0) {
    throw new HttpError(400, "Validation failed", { msg: "Validation failed", errors: validationErrors });
  }
  return problemsRepo.create(payload);
}

export async function updateProblem(id, payload) {
  const validationErrors = validateProblemPayload(payload);
  if (validationErrors.length > 0) {
    throw new HttpError(400, "Validation failed", { msg: "Validation failed", errors: validationErrors });
  }
  return problemsRepo.updateById(id, payload);
}

export async function deleteProblem(id) {
  return problemsRepo.deleteById(id);
}
