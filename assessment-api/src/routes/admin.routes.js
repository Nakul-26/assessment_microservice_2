import express from "express";
import mongoose from "mongoose";
import Problem from "../../models/Problem.mjs";
import Submission from "../../models/Submission.mjs";
import Assessment from "../../models/Assessment.mjs";
import User from "../../models/User.mjs";
import { getChannel } from "../config/rabbit.js";
import { getRedis } from "../config/redis.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.mjs";
import * as authService from "../services/auth.service.js";
import * as auditService from "../services/audit.service.js";
import * as systemService from "../services/system.service.js";
import { safeErrorMessage } from "../utils/safeErrorMessage.js";

const router = express.Router();

router.get("/audit-logs", verifyToken, authorizeRoles("admin", "superadmin", "faculty"), async (req, res) => {
  try {
    const logs = await auditService.listLogs(req.query);
    res.json(logs);
  } catch (error) {
    console.error("Audit logs error:", error);
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

router.get("/users", verifyToken, authorizeRoles("admin", "superadmin", "faculty"), async (req, res) => {
  try {
    const results = await authService.listUsers(req.query);
    res.json(results);
  } catch (error) {
    console.error("List users error:", error);
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

router.post("/users/:userId/reset-password", verifyToken, authorizeRoles("admin", "superadmin", "faculty"), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: "New password is required" });

    const auditInfo = {
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    };

    const result = await authService.resetUserPassword(req.params.userId, newPassword, req.user, auditInfo);
    res.json(result);
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

router.post("/bulk-import-students", verifyToken, authorizeRoles("admin", "superadmin", "faculty"), async (req, res) => {
  try {
    const { users, defaultPassword } = req.body;
    
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: "Invalid or empty users list" });
    }

    if (!defaultPassword) {
      return res.status(400).json({ error: "Default password is required" });
    }

    // Faculty can only import into their own college context if we had one
    // For now, let's just pass the collegeId if provided in body or from user
    const collegeId = req.body.collegeId || req.user.collegeId;

    const results = await authService.bulkRegister(users, defaultPassword, collegeId);
    
    res.json(results);
  } catch (error) {
    console.error("Bulk import error:", error);
    if (error.status && error.body) {
      return res.status(error.status).json(error.body);
    }
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

router.get("/system-stats", verifyToken, authorizeRoles("admin", "superadmin"), async (req, res) => {
  try {
    // 1. Metrics
    const [totalProblems, totalSubmissions, totalAssessments, totalUsers] = await Promise.all([
      Problem.countDocuments(),
      Submission.countDocuments(),
      Assessment.countDocuments(),
      User.countDocuments()
    ]);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const submissionsToday = await Submission.countDocuments({
      createdAt: { $gte: startOfDay }
    });
    const acceptedToday = await Submission.countDocuments({
      status: "Success",
      createdAt: { $gte: startOfDay }
    });

    // 2. Queue Monitoring
    let queueLength = 0;
    let dlqLength = 0;
    const channel = getChannel();
    if (channel) {
      try {
        const queueInfo = await channel.checkQueue(process.env.SUBMISSION_QUEUE || "submission_queue");
        queueLength = queueInfo.messageCount;
        
        // Check DLQ as well
        const dlqInfo = await channel.checkQueue("submission_dead_letters");
        dlqLength = dlqInfo.messageCount;
      } catch (err) {
        console.error("Failed to check queues:", err.message);
      }
    }

    // 3. Judge Stats
    let judgeStats = null;
    let judgeHealth = "offline";
    try {
      // Use internal service name
      const response = await fetch("http://judge-service-go:8081/stats");
      if (response.ok) {
        judgeStats = await response.json();
        judgeHealth = "healthy";
      }
    } catch (err) {
      console.log("Judge stats not available:", err.message);
    }

    // 4. System Health
    const health = {
      api: "healthy",
      mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      redis: "disconnected",
      rabbitmq: (channel && channel.connection) ? "connected" : "disconnected",
      judge: judgeHealth
    };

    const redis = getRedis();
    if (redis && redis.isOpen) {
      try {
        await redis.ping();
        health.redis = "connected";
      } catch {
        health.redis = "error";
      }
    }

    // 5. Recent Submissions Feed
    const recentSubmissions = await Submission.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("problemId", "title")
      .populate("userId", "name email");

    res.json({
      metrics: {
        totalProblems,
        totalSubmissions,
        totalAssessments,
        totalUsers,
        submissionsToday,
        acceptedToday
      },
      queueLength,
      dlqLength,
      judgeStats,
      health,
      recentSubmissions
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

import * as submissionsService from "../services/submissions.service.js";

router.post("/rejudge/submission/:submissionId", verifyToken, authorizeRoles("admin", "superadmin", "faculty"), async (req, res) => {
  try {
    const result = await submissionsService.rejudgeSubmission(req.params.submissionId);
    
    const auditInfo = {
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    await auditService.logEvent({
      event: "REJUDGE_SUBMISSION",
      userId: req.user._id,
      details: { submissionId: req.params.submissionId, problemId: result.problemId },
      ...auditInfo
    });

    res.json({ msg: "Rejudge scheduled successfully", submission: result });
  } catch (error) {
    console.error("Rejudge submission error:", error);
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

router.post("/rejudge/problem/:problemId", verifyToken, authorizeRoles("admin", "superadmin", "faculty"), async (req, res) => {
  try {
    const assessmentId = req.query.assessmentId || null;
    const result = await submissionsService.rejudgeProblemSubmissions(req.params.problemId, assessmentId);
    
    const auditInfo = {
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    await auditService.logEvent({
      event: "REJUDGE_PROBLEM",
      userId: req.user._id,
      details: { problemId: req.params.problemId, assessmentId },
      ...auditInfo
    });

    res.json({ msg: `Rejudge scheduled successfully for ${result.count} submissions`, count: result.count });
  } catch (error) {
    console.error("Rejudge problem error:", error);
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

router.post("/rejudge/assessment/:assessmentId", verifyToken, authorizeRoles("admin", "superadmin", "faculty"), async (req, res) => {
  try {
    const result = await submissionsService.rejudgeAssessmentSubmissions(req.params.assessmentId);
    
    const auditInfo = {
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    await auditService.logEvent({
      event: "REJUDGE_ASSESSMENT",
      userId: req.user._id,
      details: { assessmentId: req.params.assessmentId },
      ...auditInfo
    });

    res.json({ msg: `Rejudge scheduled successfully for ${result.count} submissions`, count: result.count });
  } catch (error) {
    console.error("Rejudge assessment error:", error);
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

router.post("/banner", verifyToken, authorizeRoles("admin", "superadmin", "faculty"), async (req, res) => {
  try {
    const { active, message, type } = req.body;
    const banner = await systemService.updateIncidentBanner({ active, message, type });
    
    // Log the event
    await auditService.logEvent({
      event: "UPDATE_INCIDENT_BANNER",
      userId: req.user._id,
      details: { active, message, type },
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    });

    res.json({ msg: "Incident banner updated successfully", banner });
  } catch (error) {
    console.error("Banner update error:", error);
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

// superadmin-only: this dumps/overwrites every college's data in one shot (no tenant
// scoping, no field exclusion — it's a full-fidelity disaster-recovery tool, not a
// per-college feature). A per-college "admin" role must never reach this.
router.get("/backup", verifyToken, authorizeRoles("superadmin"), async (req, res) => {
  try {
    const data = await systemService.exportDatabase();
    
    // Log the event
    await auditService.logEvent({
      event: "DATABASE_BACKUP",
      userId: req.user._id,
      details: {},
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    });

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=leetcode_clone_backup_${Date.now()}.json`);
    res.json(data);
  } catch (error) {
    console.error("Database backup error:", error);
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

// superadmin-only — see the /backup comment above; restore is the destructive twin.
router.post("/restore", verifyToken, authorizeRoles("superadmin"), async (req, res) => {
  try {
    const results = await systemService.importDatabase(req.body);
    
    // Log the event
    await auditService.logEvent({
      event: "DATABASE_RESTORE",
      userId: req.user._id,
      details: { restoredCollections: results },
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    });

    res.json({ msg: "Database restored successfully", results });
  } catch (error) {
    console.error("Database restore error:", error);
    res.status(error.status || 500).json({ error: safeErrorMessage(error) });
  }
});

export default router;
