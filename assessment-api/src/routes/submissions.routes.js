import express from "express";
import { validate } from "../../middleware/validator.mjs";
import {
  submitSolution,
  getSubmissionById
} from "../controllers/submissions.controller.js";

const router = express.Router();

router.post("/", validate("submission"), submitSolution);
router.get("/:_id", getSubmissionById);

export default router;
