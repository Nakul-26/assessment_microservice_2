import express from "express";
import { verifyToken, optionalVerifyToken, authorizeRoles } from "../middleware/auth.mjs";
import {
  listAssessments,
  getAssessmentById,
  getMyAssessmentAttempt,
  createAssessment,
  updateAssessment,
  deleteAssessment,
  startAssessment,
  submitAssessment,
  getAssessmentAttemptById,
  listAssessmentAttempts,
  getAttemptSubmissions,
  getAssessmentAttendance,
  logAntiCheatingEvent,
  getAnnouncements,
  createAnnouncement
} from "../controllers/assessments.controller.js";

const router = express.Router();

/**
 * @openapi
 * /assessments:
 *   get:
 *     tags:
 *       - Assessments
 *     summary: List assessments
 *     responses:
 *       200:
 *         description: List of assessments
 */
router.get("/", optionalVerifyToken, listAssessments);

/**
 * @openapi
 * /assessments:
 *   post:
 *     tags:
 *       - Assessments
 *     summary: Create a new assessment
 *     responses:
 *       201:
 *         description: Assessment created
 */
router.post("/", verifyToken, authorizeRoles("admin", "faculty", "superadmin"), createAssessment);

/**
 * @openapi
 * /assessments/{_id}:
 *   get:
 *     tags:
 *       - Assessments
 *     summary: Get assessment details
 *     parameters:
 *       - in: path
 *         name: _id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assessment details
 */
router.get("/:_id", verifyToken, getAssessmentById);

/**
 * @openapi
 * /assessments/{_id}:
 *   put:
 *     tags:
 *       - Assessments
 *     summary: Update an assessment
 *     parameters:
 *       - in: path
 *         name: _id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assessment updated
 */
router.put("/:_id", verifyToken, authorizeRoles("admin", "faculty", "superadmin"), updateAssessment);

/**
 * @openapi
 * /assessments/{_id}:
 *   delete:
 *     tags:
 *       - Assessments
 *     summary: Delete an assessment
 *     parameters:
 *       - in: path
 *         name: _id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assessment deleted
 */
router.delete("/:_id", verifyToken, authorizeRoles("admin", "superadmin"), deleteAssessment);

/**
 * @openapi
 * /assessments/{_id}/start:
 *   post:
 *     tags:
 *       - Assessments
 *     summary: Start an assessment attempt
 *     parameters:
 *       - in: path
 *         name: _id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Attempt started
 */
router.post("/:_id/start", verifyToken, authorizeRoles("student"), startAssessment);
router.post("/attempts/:attemptId/submit", verifyToken, authorizeRoles("student", "admin", "faculty", "superadmin"), submitAssessment);
router.post("/attempts/:attemptId/log-event", verifyToken, authorizeRoles("student"), logAntiCheatingEvent);
router.get("/:_id/attempts", verifyToken, authorizeRoles("admin", "faculty", "superadmin"), listAssessmentAttempts);
router.get("/:_id/attendance", verifyToken, authorizeRoles("admin", "faculty", "superadmin"), getAssessmentAttendance);
router.get("/attempts/:attemptId", verifyToken, getAssessmentAttemptById);
router.get("/attempts/:attemptId/submissions", verifyToken, getAttemptSubmissions);
router.get("/:_id/announcements", verifyToken, getAnnouncements);
router.post("/:_id/announcements", verifyToken, authorizeRoles("admin", "faculty", "superadmin"), createAnnouncement);

export default router;
