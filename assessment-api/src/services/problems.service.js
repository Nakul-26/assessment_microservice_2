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
  const normalized = { ...payload };
  if (!Array.isArray(normalized.parameters)) {
    normalized.parameters = [];
  } else {
    normalized.parameters = normalized.parameters
      .map((p = {}) => ({ name: String(p.name || "").trim(), type: String(p.type || "").trim() }))
      .filter((p) => p.name && p.type);
  }

  normalized.compareConfig = {
    mode: normalized.compareConfig?.mode || "EXACT",
    floatTolerance: Number.isFinite(Number(normalized.compareConfig?.floatTolerance))
      ? Number(normalized.compareConfig.floatTolerance)
      : 0,
    orderInsensitive: Boolean(normalized.compareConfig?.orderInsensitive)
  };

  if (!Array.isArray(normalized.testCases)) return normalized;
  return {
    ...normalized,
    testCases: normalized.testCases.map((tc = {}) => {
      const sample = isSampleTestCase(tc);
      return {
        inputs: Array.isArray(tc.inputs) ? tc.inputs : [],
        expected: tc.expected,
        isSample: sample,
        isHidden: !sample
      };
    })
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
      if (!Array.isArray(tc.inputs)) {
        validationErrors.push(`testCases[${i}].inputs must be an array`);
      }
      if (tc.expected === undefined || tc.expected === null) {
        validationErrors.push(`testCases[${i}].expected is required`);
      }
    });
  } else {
    validationErrors.push("testCases must be an array");
  }

  if (!payload.functionName || typeof payload.functionName !== "string") {
    validationErrors.push("functionName is required");
  }
  if (!payload.returnType || typeof payload.returnType !== "string") {
    validationErrors.push("returnType is required");
  }
  if (!Array.isArray(payload.parameters)) {
    validationErrors.push("parameters must be an array");
  } else {
    payload.parameters.forEach((p, i) => {
      if (!p || typeof p.name !== "string" || !p.name.trim()) {
        validationErrors.push(`parameters[${i}].name is required`);
      }
      if (!p || typeof p.type !== "string" || !p.type.trim()) {
        validationErrors.push(`parameters[${i}].type is required`);
      }
    });
  }

  if (payload.compareConfig) {
    const { mode, floatTolerance } = payload.compareConfig;
    if (mode && mode !== "EXACT" && mode !== "STRUCTURAL") {
      validationErrors.push("compareConfig.mode must be EXACT or STRUCTURAL");
    }
    if (floatTolerance !== undefined && (!Number.isFinite(floatTolerance) || floatTolerance < 0)) {
      validationErrors.push("compareConfig.floatTolerance must be a non-negative number");
    }
  }

  if (Array.isArray(payload.parameters) && Array.isArray(payload.testCases)) {
    const expectedArity = payload.parameters.length;
    payload.testCases.forEach((tc, i) => {
      if (Array.isArray(tc.inputs) && tc.inputs.length !== expectedArity) {
        validationErrors.push(
          `testCases[${i}].inputs length ${tc.inputs.length} does not match parameters length ${expectedArity}`
        );
      }
    });
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
