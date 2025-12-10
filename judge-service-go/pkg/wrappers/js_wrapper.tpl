const path = require('path');

// This will be replaced in Go with the raw JSON for the test array.
// Example after replacement:
// const tests = [{"input":[[1,2,3], 4], "expectedOutput": [0,3], "isHidden": false}, ...];
const tests = {{TESTS_JSON}};

async function runTests(userFunction) {
  const results = [];

  for (let i = 0; i < tests.length; ++i) {
    const t = tests[i];

    try {
      // Ensure input is always an array of arguments
      const input = Array.isArray(t.input) ? t.input : [t.input];

      // Call the user's function (can be sync or async)
      const out = await userFunction(...input);

      const ok = JSON.stringify(out) === JSON.stringify(t.expectedOutput);

      results.push({
        test: i + 1,    // 1-based index (matches your earlier wrappers)
        ok,
        output: out
      });
    } catch (err) {
      results.push({
        test: i + 1,
        ok: false,
        error: String(err),
        stack: err && err.stack ? err.stack : undefined
      });
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

// USER_CODE_MARKER (not used for JS, but harmless here)

(async () => {
  const submissionPath = path.join(__dirname, 'submission.js');

  // This will be string-replaced in Go:
  // "{{FUNCTION_NAME}}" → "twoSum", "sumOfEvenNumbers", etc.
  const { {{FUNCTION_NAME}} } = require(submissionPath);

  if (typeof {{FUNCTION_NAME}} !== "function") {
    console.log(JSON.stringify({
      status: "error",
      message: "No {{FUNCTION_NAME}} function exported"
    }));
    process.exit(1);
  }

  const testedFunction = {{FUNCTION_NAME}}; // avoid weird name shadowing
  await runTests(testedFunction);
})();