import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import { validateData, isValidType } from "../utils/typeValidator.mjs";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

function loadSchema(schemaName) {
  const possiblePaths = [
    path.resolve(`./contracts/${schemaName}.schema.json`),
    path.resolve(`../contracts/${schemaName}.schema.json`),
    `/usr/src/contracts/${schemaName}.schema.json`,
    `/usr/src/app/contracts/${schemaName}.schema.json`
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  throw new Error(`Schema ${schemaName} not found in any expected location`);
}

const problemSchema = loadSchema('problem');
const validateSchema = ajv.compile(problemSchema);

export async function validateProblemDefinition(problem) {
  const report = {
    schemaValid: false,
    typeValidation: false,
    wrapperGeneration: false,
    referenceSolutionPassed: false,
    errors: []
  };

  // Stage 1: Schema Validation
  if (!validateSchema(problem)) {
    report.errors = (validateSchema.errors || []).map(err => `${err.instancePath || 'root'}: ${err.message}`);
    return report;
  }
  report.schemaValid = true;

  // Stage 2: Type Conversion Validation
  try {
    for (const param of problem.parameters) {
      if (!isValidType(param.type)) {
        report.errors.push(`Invalid type string for parameter '${param.name}': ${param.type}`);
      }
    }
    if (!isValidType(problem.returnType)) {
      report.errors.push(`Invalid returnType string: ${problem.returnType}`);
    }

    if (report.errors.length === 0) {
      for (let i = 0; i < problem.testCases.length; i++) {
        const tc = problem.testCases[i];
        if (tc.inputs.length !== problem.parameters.length) {
          report.errors.push(`Test case [${i}]: expected ${problem.parameters.length} inputs, got ${tc.inputs.length}`);
          continue;
        }

        for (let j = 0; j < tc.inputs.length; j++) {
          const res = validateData(tc.inputs[j], problem.parameters[j].type);
          if (!res.valid) {
            report.errors.push(`Test case [${i}] parameter '${problem.parameters[j].name}': ${res.error}`);
          }
        }

        const resExpected = validateData(tc.expected, problem.returnType);
        if (!resExpected.valid) {
          report.errors.push(`Test case [${i}] expected output: ${resExpected.error}`);
        }
      }
    }

    if (report.errors.length === 0) {
      report.typeValidation = true;
    }
  } catch (err) {
    report.errors.push(`Type validation crashed: ${err.message}`);
  }

  // Stage 3: Wrapper Generation
  if (report.typeValidation) {
    try {
      const languages = ['javascript', 'python', 'java', 'go'];
      for (const lang of languages) {
        await buildPreview({ problem, language: lang });
      }
      report.wrapperGeneration = true;
    } catch (err) {
      report.errors.push(`Wrapper generation failed: ${err.message}`);
    }
  }

  // Stage 4: Reference Solution Verification
  if (report.wrapperGeneration && problem.referenceSolution && problem.solutionLanguage) {
    console.log(`[Validation] Starting reference solution verification for problem: ${problem.title}`);
    try {
      const judgeMsg = {
        schemaVersion: "1",
        submissionId: "cert-" + Date.now(),
        problemId: problem._id || "temp",
        language: problem.solutionLanguage,
        code: problem.referenceSolution,
        functionName: problem.functionName,
        parameters: problem.parameters,
        returnType: problem.returnType,
        compareMode: problem.compareConfig?.mode || "STRUCTURAL",
        floatTolerance: problem.compareConfig?.floatTolerance || 0,
        orderInsensitive: !!problem.compareConfig?.orderInsensitive,
        tests: problem.testCases.map(tc => ({
          inputs: tc.inputs,
          expected: tc.expected,
          isHidden: !!tc.isHidden
        }))
      };

      console.log(`[Validation] Sending POST to http://judge-service-go:8081/run`);
      const response = await fetch("http://judge-service-go:8081/run", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(judgeMsg)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Validation] Judge service error: ${errorText}`);
        report.errors.push(`Judge service error during certification: ${errorText}`);
      } else {
        const result = await response.json();
        console.log(`[Validation] Judge service result: ${result.status}`);
        if (result.status === "Success" || result.status === "Accepted") {
          report.referenceSolutionPassed = true;
        } else {
          const failMsg = result.message || "Reference solution failed one or more tests";
          console.error(`[Validation] Reference solution failed: ${failMsg}`);
          report.errors.push(`Reference solution failed: ${failMsg}`);
          if (result.testResults) {
            result.testResults.forEach((tr, idx) => {
              if (tr.status !== "Success" && tr.status !== "Accepted") {
                report.errors.push(`Test case ${idx + 1} (${tr.isHidden ? 'Hidden' : 'Sample'}): ${tr.message || tr.status}`);
              }
            });
          }
        }
      }
    } catch (err) {
      console.error(`[Validation] Reference solution verification crashed: ${err.message}`);
      report.errors.push(`Reference solution verification crashed: ${err.message}`);
    }
  } else if (report.wrapperGeneration) {
    report.errors.push("referenceSolution and solutionLanguage are required to pass deep validation.");
  }

  return report;
}

export async function buildPreview({ problem, language }) {
  if (!problem || !language) {
    const err = new Error("Missing problem or language in request");
    err.status = 400;
    err.body = { msg: "Missing problem or language in request" };
    throw err;
  }

  const langTplFile = {
    javascript: "js_wrapper.tpl",
    python: "python_wrapper.tpl",
    java: "java_wrapper.tpl",
    c: "c_wrapper.tpl",
    csharp: "csharp_wrapper.tpl",
    go: "go_wrapper.tpl"
  }[language] || "js_wrapper.tpl";

  const fs = await import("fs");
  const path = await import("path");
  const filePath = path.default.join(process.cwd(), "judge-service-go", "pkg", "wrappers", langTplFile);
  let tpl = "";
  try {
    tpl = fs.default.readFileSync(filePath, "utf8");
  } catch (err) {
    console.warn("Failed to read template for preview, using fallback template:", err.message);
    if (language === "python") {
      tpl = "# wrapper preview for python\n# TESTS: {{TESTS_JSON}}\n# FUNCTION: {{FUNCTION_NAME}}\n# USER_CODE_MARKER";
    } else if (language === "java") {
      tpl = "// wrapper preview for java\n// TESTS: {{TESTS_JSON}}\n// FUNCTION: {{FUNCTION_NAME}}\n// CLASS: {{CLASS_NAME}}\n// USER_CODE_MARKER";
    } else {
      tpl = "// wrapper preview for js\n// TESTS: {{TESTS_JSON}}\n// FUNCTION: {{FUNCTION_NAME}}\n// USER_CODE_MARKER";
    }
  }

  const tests = (problem.testCases || []).map((tc) => ({
    inputs: tc.inputs,
    expected: tc.expected,
    isHidden: !!tc.isHidden
  }));

  const testsJSON = JSON.stringify(tests);
  const functionName = problem.functionName || "solution";
  tpl = tpl.replace(/{{TESTS_JSON}}/g, testsJSON);
  tpl = tpl.replace(/{{FUNCTION_NAME}}/g, functionName);
  tpl = tpl.replace(/{{CLASS_NAME}}/g, functionName);

  return { wrapper: tpl, tests: tests };
}
