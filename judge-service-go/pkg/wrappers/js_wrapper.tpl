const path = require('path');
const tests = {{TESTS_JSON .TestCases}};

async function runTests(userFunction) {
  const results = [];
  for (let i = 0; i < tests.length; ++i) {
    const t = tests[i];
    try {
      const input = Array.isArray(t.input) ? t.input : [t.input];
      const out = await userFunction(...input);
      const ok = JSON.stringify(out) === JSON.stringify(t.expectedOutput);
      results.push({ test: i + 1, ok, output: out });
    } catch (err) {
      results.push({ test: i + 1, ok: false, error: String(err), stack: err.stack });
    }
  }

  const summary = {
    status: "finished",
    passed: results.filter(r => r.ok).length,
    total: results.length,
    details: results
  };

  console.log(JSON.stringify(summary));
  process.stdout.write("");
}

// USER_CODE_MARKER

(async () => {
  const submissionPath = path.join(__dirname, 'submission.js');
  const { {{.FUNCTION_NAME}} } = require(submissionPath);

  if (typeof {{.FUNCTION_NAME}} !== "function") {
    console.log(JSON.stringify({ status: "error", message: "No {{.FUNCTION_NAME}} function exported" }));
    process.exit(1);
  }

  const testedFunction = {{.FUNCTION_NAME}}; // ✅ avoid name clash
  await runTests(testedFunction);
})();
