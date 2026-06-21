import * as assessmentsRepo from "../repositories/assessments.repo.js";
import * as attemptsRepo from "../repositories/assessmentAttempts.repo.js";
import Submission from "../../models/Submission.mjs";
import User from "../../models/User.mjs";
import { HttpError } from "../utils/httpError.js";
import * as auditService from "./audit.service.js";

export async function listAssessments(query = {}, user) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));
  const filter = {};
  
  // If guest or student, only show Published or Completed assessments
  if (!user || user.role === 'student') {
    filter.status = { $in: ['Published', 'Completed'] };
  }

  const options = {
    sort: { startTime: -1 },
    skip: (page - 1) * limit,
    limit: limit
  };

  return assessmentsRepo.findAll(filter, options);
}

export async function getAssessmentById(id, user) {
  const assessment = await assessmentsRepo.findById(id);
  if (!assessment) return null;

  // Student can only see if it's not Draft
  if (user.role === 'student' && assessment.status === 'Draft') {
    return null;
  }

  return assessment;
}

export async function getMyAssessmentAttempt(assessmentId, userId) {
  return attemptsRepo.findOne({ assessmentId, studentId: userId });
}

export async function createAssessment(payload, userId) {
  validateAssessmentPayload(payload);
  const data = {
    ...payload,
    createdBy: userId
  };
  return assessmentsRepo.create(data);
}

export async function updateAssessment(id, payload) {
  validateAssessmentPayload(payload);
  return assessmentsRepo.updateById(id, payload);
}

export async function deleteAssessment(id) {
  return assessmentsRepo.deleteById(id);
}

export async function startAssessment(assessmentId, userId, auditInfo = {}) {
  const assessment = await assessmentsRepo.findById(assessmentId);
  if (!assessment) throw new HttpError(404, "Assessment not found");
  if (assessment.status !== 'Published') throw new HttpError(400, "Assessment is not active");

  const now = new Date();
  if (now < assessment.startTime) throw new HttpError(400, "Assessment has not started yet");
  if (now > assessment.endTime) throw new HttpError(400, "Assessment has already ended");

  // Check if already started
  let attempt = await attemptsRepo.findOne({ assessmentId, studentId: userId });
  if (attempt) return attempt;

  // Shuffle problem order for anti-cheating
  const problemIds = assessment.problems.map(p => p.problemId._id || p.problemId);
  const shuffledOrder = [...problemIds].sort(() => Math.random() - 0.5);

  try {
    attempt = await attemptsRepo.create({
      assessmentId,
      studentId: userId,
      startedAt: now,
      status: 'Active',
      problemOrder: shuffledOrder,
      timeline: [{ event: 'START', timestamp: now }]
    });
  } catch (error) {
    // The unique attempt index makes concurrent start requests idempotent.
    if (error?.code === 11000) {
      return attemptsRepo.findOne({ assessmentId, studentId: userId });
    }
    throw error;
  }

  await auditService.logEvent({
    event: "ASSESSMENT_STARTED",
    userId,
    details: { assessmentId, attemptId: attempt._id },
    ...auditInfo
  });

  return attempt;
}

export async function logAntiCheatingEvent(attemptId, eventType, user) {
  const attempt = await attemptsRepo.findById(attemptId);
  if (!attempt) throw new HttpError(404, "Attempt not found");

  const studentId = attempt.studentId._id || attempt.studentId;
  if (String(studentId) !== String(user._id)) {
    throw new HttpError(403, "Forbidden");
  }

  if (attempt.status !== 'Active') return attempt;

  const update = {
    $push: {
      timeline: {
        event: eventType,
        timestamp: new Date()
      }
    }
  };
  switch (eventType) {
    case 'TAB_SWITCH':
      update.$inc = { tabSwitchCount: 1 };
      break;
    case 'COPY':
      update.$inc = { copyCount: 1 };
      break;
    case 'PASTE':
      update.$inc = { pasteCount: 1 };
      break;
    case 'FULLSCREEN_EXIT':
      update.$inc = { fullscreenExitCount: 1 };
      break;
    case 'RETURN':
      // Just logged in the timeline, no counters incremented
      break;
    default:
      throw new HttpError(400, "Invalid event type");
  }

  return attemptsRepo.updateById(attemptId, update);
}

export async function getAssessmentAttemptById(attemptId, user) {
  const attempt = await attemptsRepo.findById(attemptId);
  if (!attempt) return null;

  const assessment = await assessmentsRepo.findById(attempt.assessmentId);
  if (!assessment) return null;

  // Auto-timeout check
  if (attempt.status === 'Active' && isAttemptExpired(attempt, assessment)) {
    await attemptsRepo.updateById(attemptId, { status: 'TimedOut', submittedAt: getExpirationTime(attempt, assessment) });
    attempt.status = 'TimedOut';
    attempt.submittedAt = getExpirationTime(attempt, assessment);
  }

  await recalculateAttemptScore(attemptId);
  
  // Re-fetch after score update and status change
  const finalAttempt = await attemptsRepo.findById(attemptId);

  // Check permission
  const studentId = finalAttempt.studentId._id || finalAttempt.studentId;
  if (user.role === 'student' && String(studentId) !== String(user._id)) {
    throw new HttpError(403, "Forbidden");
  }

  // Reorder assessment problems based on attempt's problemOrder
  if (finalAttempt.problemOrder && finalAttempt.problemOrder.length > 0) {
    const orderMap = new Map();
    finalAttempt.problemOrder.forEach((id, index) => orderMap.set(String(id), index));
    
    // Create a lean copy of assessment and sort problems
    const assessmentObj = assessment.toObject ? assessment.toObject() : assessment;
    assessmentObj.problems.sort((a, b) => {
      const idxA = orderMap.get(String(a.problemId._id || a.problemId)) ?? 999;
      const idxB = orderMap.get(String(b.problemId._id || b.problemId)) ?? 999;
      return idxA - idxB;
    });
    finalAttempt.assessmentId = assessmentObj;
  }

  return finalAttempt;
}

export async function recalculateAttemptScore(attemptId) {
  const attempt = await attemptsRepo.findById(attemptId);
  if (!attempt) return;

  const assessment = await assessmentsRepo.findById(attempt.assessmentId);
  if (!assessment) return;

  // Find all successful submissions for this attempt
  const submissions = await Submission.find({
    attemptId: attempt._id,
    status: 'Success'
  });

  // Calculate score: for each problem in assessment, if there is a successful submission, add maxScore
  let totalScore = 0;
  const solvedProblemIds = new Set(submissions.map(s => String(s.problemId)));

  for (const p of assessment.problems) {
    const pId = p.problemId._id || p.problemId;
    if (solvedProblemIds.has(String(pId))) {
      totalScore += p.maxScore;
    }
  }

  if (attempt.score !== totalScore) {
    await attemptsRepo.updateById(attemptId, { score: totalScore });
  }
}

export async function listAssessmentAttempts(assessmentId, user, query = {}) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));
  // Only faculty/admin can list all attempts for an assessment
  if (user.role === 'student') {
    throw new HttpError(403, "Forbidden");
  }

  const options = {
    sort: { startedAt: -1 },
    skip: (page - 1) * limit,
    limit: limit
  };

  return attemptsRepo.findAll({ assessmentId }, options);
}

export async function getAssessmentAttendance(assessmentId, user) {
  // Only faculty/admin can see attendance
  if (user.role === 'student') {
    throw new HttpError(403, "Forbidden");
  }

  const assessment = await assessmentsRepo.findById(assessmentId);
  if (!assessment) throw new HttpError(404, "Assessment not found");

  // Get all students
  // For now, let's get all users with role 'student'
  // In a real multi-college setup, we'd filter by collegeId
  const students = await User.find({ role: 'student' }).select('name email');

  // Get all attempts for this assessment
  const attempts = await attemptsRepo.findAll({ assessmentId });

  // Map students to status
  const attendance = students.map(student => {
    const attempt = attempts.find(a => String(a.studentId._id || a.studentId) === String(student._id));
    return {
      studentId: student._id,
      name: student.name,
      email: student.email,
      status: attempt ? attempt.status : 'Not Started',
      attemptId: attempt ? attempt._id : null,
      score: attempt ? attempt.score : 0,
      startedAt: attempt ? attempt.startedAt : null,
      submittedAt: attempt ? attempt.submittedAt : null,
      tabSwitchCount: attempt ? (attempt.tabSwitchCount || 0) : 0,
      copyCount: attempt ? (attempt.copyCount || 0) : 0,
      pasteCount: attempt ? (attempt.pasteCount || 0) : 0,
      fullscreenExitCount: attempt ? (attempt.fullscreenExitCount || 0) : 0
    };
  });

  return attendance;
}

export async function submitAssessment(attemptId, user, auditInfo = {}) {
  const attempt = await attemptsRepo.findById(attemptId);
  if (!attempt) throw new HttpError(404, "Attempt not found");

  const assessment = await assessmentsRepo.findById(attempt.assessmentId);
  if (!assessment) throw new HttpError(404, "Assessment not found");

  // Permission check
  const studentId = attempt.studentId._id || attempt.studentId;
  if (user.role === 'student' && String(studentId) !== String(user._id)) {
    throw new HttpError(403, "Forbidden");
  }

  if (attempt.status !== 'Active') {
    return attempt; // Already submitted or timed out
  }

  // Check for timeout
  if (isAttemptExpired(attempt, assessment)) {
    await recalculateAttemptScore(attemptId);
    const result = await attemptsRepo.updateById(attemptId, {
      status: 'TimedOut',
      submittedAt: getExpirationTime(attempt, assessment),
      $push: {
        timeline: {
          event: 'TIMED_OUT',
          timestamp: getExpirationTime(attempt, assessment)
        }
      }
    });

    await auditService.logEvent({
      event: "ASSESSMENT_TIMEOUT",
      userId: user._id,
      details: { attemptId, assessmentId: attempt.assessmentId },
      ...auditInfo
    });

    return result;
  }

  await recalculateAttemptScore(attemptId);
  
  const result = await attemptsRepo.updateById(attemptId, {
    status: 'Submitted',
    submittedAt: new Date(),
    $push: {
      timeline: {
        event: 'SUBMIT',
        timestamp: new Date()
      }
    }
  });

  await auditService.logEvent({
    event: "ASSESSMENT_SUBMITTED",
    userId: user._id,
    details: { attemptId, assessmentId: attempt.assessmentId, score: result.score },
    ...auditInfo
  });

  return result;
}

function isAttemptExpired(attempt, assessment) {
  const now = new Date();
  const expirationTime = getExpirationTime(attempt, assessment);
  return now > expirationTime;
}

function getExpirationTime(attempt, assessment) {
  const startTime = new Date(attempt.startedAt);
  const durationMs = assessment.durationMinutes * 60000;
  const relativeExpiry = new Date(startTime.getTime() + durationMs);
  const absoluteExpiry = new Date(assessment.endTime);
  
  // Expiry is whichever comes first
  return relativeExpiry < absoluteExpiry ? relativeExpiry : absoluteExpiry;
}

export async function getAttemptSubmissions(attemptId, user, query = {}) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));

  const attempt = await attemptsRepo.findById(attemptId);
  if (!attempt) throw new HttpError(404, "Attempt not found");

  // Permission check: Faculty/Admin or the Student who owns the attempt
  const studentId = attempt.studentId._id || attempt.studentId;
  if (user.role === 'student' && String(studentId) !== String(user._id)) {
    throw new HttpError(403, "Forbidden");
  }

  return Submission.find({ attemptId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('problemId', 'title');
}

function validateAssessmentPayload(payload) {
  const errors = [];
  if (!payload.title) errors.push("Title is required");
  if (!payload.startTime) errors.push("Start time is required");
  if (!payload.endTime) errors.push("End time is required");
  if (!Number.isFinite(Number(payload.durationMinutes)) || Number(payload.durationMinutes) <= 0) {
    errors.push("Duration must be greater than zero");
  }
  if (payload.startTime && payload.endTime && new Date(payload.startTime) >= new Date(payload.endTime)) {
    errors.push("End time must be after start time");
  }
  if (!Array.isArray(payload.problems) || payload.problems.length === 0) {
    errors.push("At least one problem is required");
  } else {
    const problemIds = payload.problems.map((problem) => String(problem.problemId));
    if (new Set(problemIds).size !== problemIds.length) {
      errors.push("An assessment cannot contain duplicate problems");
    }
    if (payload.problems.some((problem) => problem.maxScore !== undefined
      && (!Number.isFinite(Number(problem.maxScore)) || Number(problem.maxScore) <= 0))) {
      errors.push("Every problem max score must be greater than zero");
    }
  }

  if (errors.length > 0) {
    throw new HttpError(400, "Validation failed", { errors });
  }
}

export async function getAnnouncements(assessmentId) {
  const assessment = await assessmentsRepo.findById(assessmentId);
  if (!assessment) throw new HttpError(404, "Assessment not found");
  return assessment.announcements || [];
}

export async function createAnnouncement(assessmentId, message) {
  if (!message || typeof message !== 'string' || message.trim() === '') {
    throw new HttpError(400, "Message must be a non-empty string");
  }
  const assessment = await assessmentsRepo.findById(assessmentId);
  if (!assessment) throw new HttpError(404, "Assessment not found");

  const announcement = {
    message: message.trim(),
    sentAt: new Date()
  };

  await assessmentsRepo.updateById(assessmentId, {
    $push: { announcements: announcement }
  });

  return announcement;
}
