const tests = [{"input":{"num1":1,"num2":2},"expectedOutput":3,"_id":"68f74194296c7419de697d87"},{"input":{"num1":10,"num2":20},"expectedOutput":30,"_id":"68f74194296c7419de697d88"}];

async function runTests(solution) {
  const results = [];
  for (let i = 0; i < tests.length; ++i) {
    const t = tests[i];
    try {
      const input = Array.isArray(t.input) ? t.input : [t.input];
      const out = await solution(...input);
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

  process.stdout.write(""); // flush
}

// Inject user code here
# USER_CODE_MARKER

(async () => {
  if (typeof solution !== "function") {
    console.log(JSON.stringify({ status: "error", message: "No solution function exported" }));
    process.exit(1);
  }
  await runTests(solution);
})();
