import express from "express";
import { verifyArventiq } from "../middleware/arventiq.mjs";
import {
  syncProblem,
  submitSolution,
  runCode,
  getSubmissionResult
} from "../controllers/arventiq.controller.js";

const router = express.Router();

// Shared-secret only — no per-candidate JWT, see docs/arventiq-integration/PLAN.md §6.
router.use(verifyArventiq);

router.post("/problems", syncProblem);
// Run: ephemeral, no Submission doc, no queue — separate from Submit, which judges
// against the synced official test cases and produces a scored verdict.
router.post("/run", runCode);
router.post("/submissions", submitSolution);
router.get("/submissions/:_id", getSubmissionResult);

export default router;
