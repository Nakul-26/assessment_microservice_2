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
    csharp: "csharp_wrapper.tpl"
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
    input: tc.input,
    expectedOutput: tc.expectedOutput,
    isHidden: !!tc.isHidden
  }));

  const testsJSON = JSON.stringify(tests);
  const functionName =
    (problem.functionDefinitions &&
      problem.functionDefinitions[language] &&
      problem.functionDefinitions[language].name) ||
    "solution";
  tpl = tpl.replace(/{{TESTS_JSON}}/g, testsJSON);
  tpl = tpl.replace(/{{FUNCTION_NAME}}/g, functionName);
  tpl = tpl.replace(/{{CLASS_NAME}}/g, functionName);

  return { wrapper: tpl, tests: tests };
}
