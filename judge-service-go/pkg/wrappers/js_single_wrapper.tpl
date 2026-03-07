// wrapper injected by judge (single test execution for central comparator mode)
const fs = require("fs");

// USER_CODE_MARKER

function runOne() {
  try {
    let payload;
    if (process.argv.length >= 3) {
      const decoded = Buffer.from(process.argv[2], "base64").toString("utf8");
      payload = JSON.parse(decoded);
    } else {
      payload = JSON.parse(fs.readFileSync(0, "utf8"));
    }

    const testInput = payload.inputs;
    let out;
    if (Array.isArray(testInput)) {
      out = {{FUNCTION_NAME}}(...testInput);
    } else if (testInput && typeof testInput === "object") {
      out = {{FUNCTION_NAME}}(testInput);
    } else {
      out = {{FUNCTION_NAME}}(testInput);
    }

    process.stdout.write(JSON.stringify({ output: out }));
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        error: err && err.message ? String(err.message) : String(err),
        traceback: err && err.stack ? String(err.stack) : "",
      }),
    );
  }
}

runOne();
