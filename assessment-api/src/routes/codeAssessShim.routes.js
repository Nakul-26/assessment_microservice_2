import express from "express";
import { env } from "../config/env.js";
import { safeCompare } from "../utils/safeCompare.js";
import { submitRawExecution, getRawExecution } from "../controllers/codeAssessShim.controller.js";

const router = express.Router();

// exam-platform's judge.js sends the shared secret as `x-rapidapi-key` (it's built to
// talk to a Judge0/RapidAPI-shaped instance, not branded to this service) — deliberately
// not the `x-service-key` used by the /integration/* routes, so this key can be rotated
// independently. The header name itself lives in exam-platform's judge.js, not here —
// renaming it requires a coordinated change on that side too.
function verifyCodeAssessKey(req, res, next) {
  const key = req.headers["x-rapidapi-key"];
  if (!safeCompare(key, env.CODEASSESS_SHIM_KEY)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.use(verifyCodeAssessKey);

router.post("/submissions", submitRawExecution);
router.get("/submissions/:token", getRawExecution);

export default router;
