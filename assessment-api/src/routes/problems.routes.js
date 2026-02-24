import express from "express";
import { validate } from "../../middleware/validator.mjs";
import { verifyToken, authorizeRoles } from "../middleware/auth.mjs";
import {
  listProblems,
  getProblemById,
  createProblem,
  deleteProblem,
  updateProblem
} from "../controllers/problems.controller.js";

const router = express.Router();

router.get("/", listProblems);
router.get("/:_id", getProblemById);
router.post("/", verifyToken, authorizeRoles("admin", "faculty"), validate("problem"), createProblem);
router.delete("/:_id", deleteProblem);
router.put("/:_id", validate("problem"), updateProblem);

export default router;
