const path = require('path');
const tests = {{TESTS_JSON}};

async function runTests(userFunction) {
  const results = [];
  for (let i = 0; i < tests.length; ++i) {
    const t = tests[i];
    try {
      const input = Array.isArray(t.input) ? t.input : [t.input];
      const out = await userFunction(...input);
      const ok = deepEqual(out, t.expectedOutput);
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

  function isPrimitive(x) {
    return x === null || (typeof x !== 'object' && typeof x !== 'function');
  }

  function deepEqual(a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      return Math.abs(a - b) < 1e-9;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      // If elements are primitive try unordered compare
      if (a.every(isPrimitive) && b.every(isPrimitive)) {
        const sa = a.map(x => (typeof x === 'number' ? x : JSON.stringify(x))).sort();
        const sb = b.map(x => (typeof x === 'number' ? x : JSON.stringify(x))).sort();
        return JSON.stringify(sa) === JSON.stringify(sb);
      }
      // Ordered deep compare
      for (let i = 0; i < a.length; ++i) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const ka = Object.keys(a).sort();
      const kb = Object.keys(b).sort();
      if (ka.length !== kb.length) return false;
      for (let i = 0; i < ka.length; ++i) {
        if (ka[i] !== kb[i]) return false;
        if (!deepEqual(a[ka[i]], b[kb[i]])) return false;
      }
      return true;
    }
    return JSON.stringify(a) === JSON.stringify(b);
  }

// USER_CODE_MARKER

(async () => {
  const submissionPath = path.join(__dirname, 'submission.js');
  const { {{FUNCTION_NAME}} } = require(submissionPath);

  if (typeof {{FUNCTION_NAME}} !== "function") {
    console.log(JSON.stringify({ status: "error", message: "No {{FUNCTION_NAME}} function exported" }));
    process.exit(1);
  }

  const testedFunction = {{FUNCTION_NAME}}; // ✅ avoid name clash
  await runTests(testedFunction);
})();
