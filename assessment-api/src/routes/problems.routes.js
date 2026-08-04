import express from "express";
import { validate } from "../../middleware/validator.mjs";
import { verifyToken, optionalVerifyToken, authorizeRoles } from "../middleware/auth.mjs";
import {
  listProblems,
  getProblemById,
  getProblemStats,
  runProblem,
  createProblem,
  deleteProblem,
  updateProblem
} from "../controllers/problems.controller.js";

const router = express.Router();

router.get("/", optionalVerifyToken, listProblems);
router.get("/:_id", optionalVerifyToken, getProblemById);
router.get("/:_id/stats", optionalVerifyToken, getProblemStats);
router.post("/:_id/run", verifyToken, runProblem);
router.post("/", verifyToken, authorizeRoles("admin", "faculty", "superadmin"), validate("problem"), createProblem);
router.put("/:_id", verifyToken, authorizeRoles("admin", "faculty", "superadmin"), validate("problem"), updateProblem);
router.delete("/:_id", verifyToken, authorizeRoles("admin", "superadmin"), deleteProblem);

export default router;
