const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function addError(errors, key, message) {
  if (!errors[key]) {
    errors[key] = message;
  }
}

function normalizeParameters(parameters = [], errors) {
  const normalized = parameters.map((parameter = {}) => ({
    name: String(parameter.name || "").trim(),
    type: String(parameter.type || "").trim()
  }));

  const nonEmpty = normalized.filter((parameter) => parameter.name || parameter.type);
  if (nonEmpty.length === 0) {
    addError(errors, "parameters", "At least one parameter is required");
    return [];
  }

  nonEmpty.forEach((parameter, index) => {
    if (!parameter.name) {
      addError(errors, `parameters.${index}.name`, "Parameter name is required");
    } else if (!IDENTIFIER_PATTERN.test(parameter.name)) {
      addError(errors, `parameters.${index}.name`, "Parameter name must be a valid identifier");
    }

    if (!parameter.type) {
      addError(errors, `parameters.${index}.type`, "Parameter type is required");
    }
  });

  return nonEmpty;
}

function normalizeExpectedValue(rawValue) {
  const value = String(rawValue ?? "");
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeTestCases(testCases = [], parameterCount, errors) {
  if (testCases.length === 0) {
    addError(errors, "testCases", "At least one test case is required");
    return [];
  }

  let hasSample = false;
  const parsed = [];

  testCases.forEach((testCase = {}, index) => {
    const inputsKey = `testCases.${index}.inputs`;
    const rowKey = `testCases.${index}`;
    const rawInputs = String(testCase.inputs ?? "").trim();
    let parsedInputs;

    try {
      parsedInputs = JSON.parse(rawInputs);
    } catch {
      addError(errors, inputsKey, "Inputs must be a valid JSON array");
      return;
    }

    if (!Array.isArray(parsedInputs)) {
      addError(errors, inputsKey, "Inputs must be a JSON array");
      return;
    }

    if (parsedInputs.length !== parameterCount) {
      addError(errors, rowKey, `Expected ${parameterCount} input(s) but got ${parsedInputs.length}`);
    }

    if (testCase.isSample) {
      hasSample = true;
    }

    parsed.push({
      inputs: parsedInputs,
      expected: normalizeExpectedValue(testCase.expected),
      isSample: !!testCase.isSample
    });
  });

  if (!hasSample) {
    addError(errors, "testCases", "At least one sample test case is required");
  }

  return parsed;
}

export function buildProblemPayload(formData) {
  const errors = {};
  const title = String(formData.title || "").trim();
  const description = String(formData.description || "").trim();
  const functionName = String(formData.functionName || "").trim();
  const returnType = String(formData.returnType || "").trim();

  if (!title) addError(errors, "title", "Title is required");
  if (!description) addError(errors, "description", "Description is required");
  if (!functionName) {
    addError(errors, "functionName", "Function name is required");
  } else if (!IDENTIFIER_PATTERN.test(functionName)) {
    addError(errors, "functionName", "Function name must be a valid identifier");
  }
  if (!returnType) addError(errors, "returnType", "Return type is required");

  const parameters = normalizeParameters(formData.parameters || [], errors);
  const testCases = normalizeTestCases(formData.testCases || [], parameters.length, errors);

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors: {},
    payload: {
      title,
      description,
      difficulty: formData.difficulty,
      functionName,
      parameters,
      returnType,
      compareConfig: {
        mode: formData.compareConfig?.mode || "EXACT",
        floatTolerance: Number(formData.compareConfig?.floatTolerance) || 0,
        orderInsensitive: !!formData.compareConfig?.orderInsensitive
      },
      testCases,
      tags: String(formData.tags || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      isPremium: !!formData.isPremium
    }
  };
}

export function collectErrorMessages(errors = {}) {
  return Object.values(errors);
}
