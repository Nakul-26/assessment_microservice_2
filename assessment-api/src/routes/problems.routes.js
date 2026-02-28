import express from "express";
import { validate } from "../../middleware/validator.mjs";
import { verifyToken, optionalVerifyToken, authorizeRoles } from "../middleware/auth.mjs";
import {
  listProblems,
  getProblemById,
  createProblem,
  deleteProblem,
  updateProblem
} from "../controllers/problems.controller.js";

const router = express.Router();

router.get("/", listProblems);
router.get("/:_id", optionalVerifyToken, getProblemById);
router.post("/", verifyToken, authorizeRoles("admin", "faculty"), validate("problem"), createProblem);
router.put("/:_id", verifyToken, authorizeRoles("admin", "faculty"), validate("problem"), updateProblem);
router.delete("/:_id", verifyToken, authorizeRoles("admin"), deleteProblem);

export default router;
