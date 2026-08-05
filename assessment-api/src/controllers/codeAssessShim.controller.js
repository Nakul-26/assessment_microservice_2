import { runRawCodeAssess } from "../services/codeAssessShim.service.js";

function b64decode(s) {
  if (!s) return "";
  return Buffer.from(s, "base64").toString("utf8");
}

function b64encode(s) {
  return Buffer.from(s == null ? "" : String(s), "utf8").toString("base64");
}

// POST /codeAssess/submissions?base64_encoded=true&wait=true
// Judge0 CE wire-format-compatible synchronous execution endpoint (same request/response
// shape as the real Judge0 CE API — see codeAssessShim.service.js). Exists purely so
// exam-platform's judge.js (which only knows how to speak to a Judge0-shaped instance,
// see runOnJudge()) can point JUDGE_URL at this service without any code changes
// on that side. Always responds synchronously — there is no queue behind this route,
// it calls straight into judge-service-go's internal /raw-run.
export async function submitRawExecution(req, res) {
  const body = req.body || {};
  const base64 = req.query.base64_encoded !== "false"; // judge.js always sends true

  const sourceCode = base64 ? b64decode(body.source_code) : (body.source_code || "");
  const stdin = base64 ? b64decode(body.stdin) : (body.stdin || "");

  if (body.language_id == null || !sourceCode) {
    return res.status(400).json({ error: "language_id and source_code are required" });
  }

  const result = await runRawCodeAssess({
    languageId: Number(body.language_id),
    sourceCode,
    stdin,
    cpuTimeLimitSec: Number(body.cpu_time_limit) || undefined,
    wallTimeLimitSec: Number(body.wall_time_limit) || Number(body.cpu_time_limit) || undefined,
    memoryLimitKb: Number(body.memory_limit) || undefined,
  });

  return res.status(200).json({
    token: `sync-${Date.now()}`,
    stdout: b64encode(result.stdout),
    stderr: b64encode(result.stderr),
    compile_output: b64encode(result.compile_output),
    status: result.status,
    time: result.time,
    memory: result.memory,
    exit_code: result.exit_code,
    exit_signal: result.exit_signal,
  });
}

// GET /codeAssess/submissions/:token
// Not needed in practice: /submissions above always resolves synchronously
// (wait=true), so judge.js's defensive poll loop never has anything to poll for.
// Implemented only so a stray poll doesn't 404 into confusing error handling.
export async function getRawExecution(req, res) {
  return res.status(404).json({ error: "Synchronous-only judge: nothing to poll for token " + req.params.token });
}
