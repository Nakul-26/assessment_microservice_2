// wrapper injected by judge (batched execution for central comparator mode)

// USER_CODE_MARKER

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function runAll() {
  if (process.argv.length < 3) {
    emit({ fatal: "missing tests payload" });
    return 2;
  }

  const decoded = Buffer.from(process.argv[2], "base64").toString("utf8");
  const tests = JSON.parse(decoded);

  for (let i = 0; i < tests.length; i++) {
    try {
      const testInput = tests[i] && tests[i].inputs;
      let out;
      if (Array.isArray(testInput)) {
        out = await Promise.resolve({{FUNCTION_NAME}}(...testInput));
      } else if (testInput && typeof testInput === "object") {
        out = await Promise.resolve({{FUNCTION_NAME}}(testInput));
      } else {
        out = await Promise.resolve({{FUNCTION_NAME}}(testInput));
      }

      emit({ test: i + 1, output: out });
    } catch (err) {
      emit({
        test: i + 1,
        error: err && err.message ? String(err.message) : String(err),
        traceback: err && err.stack ? String(err.stack) : "",
      });
    }
  }

  return 0;
}

(async () => {
  try {
    process.exit(await runAll());
  } catch (err) {
    emit({
      fatal: err && err.message ? String(err.message) : String(err),
      traceback: err && err.stack ? String(err.stack) : "",
    });
    process.exit(1);
  }
})();
