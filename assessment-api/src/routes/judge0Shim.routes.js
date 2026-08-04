import express from "express";
import { env } from "../config/env.js";
import { submitRawExecution, getRawExecution } from "../controllers/judge0Shim.controller.js";

const router = express.Router();

// exam-platform's judge.js sends the shared secret as `x-rapidapi-key` (it's built to
// talk to Judge0/RapidAPI, not to this service) — deliberately not the `x-service-key`
// used by the /integration/* routes, so this key can be rotated independently.
function verifyJudge0Key(req, res, next) {
  const key = req.headers["x-rapidapi-key"];
  if (!key || key !== env.JUDGE0_SHIM_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.use(verifyJudge0Key);

router.post("/submissions", submitRawExecution);
router.get("/submissions/:token", getRawExecution);

export default router;
