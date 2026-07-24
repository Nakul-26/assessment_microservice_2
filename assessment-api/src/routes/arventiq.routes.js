import express from "express";
import { verifyArventiq } from "../middleware/arventiq.mjs";
import {
  syncProblem,
  submitSolution,
  getSubmissionResult
} from "../controllers/arventiq.controller.js";

const router = express.Router();

// Shared-secret only — no per-candidate JWT, see docs/arventiq-integration/PLAN.md §6.
router.use(verifyArventiq);

router.post("/problems", syncProblem);
router.post("/submissions", submitSolution);
router.get("/submissions/:_id", getSubmissionResult);

export default router;
