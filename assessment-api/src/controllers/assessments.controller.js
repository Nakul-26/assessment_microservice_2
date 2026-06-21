import * as assessmentsService from "../services/assessments.service.js";

function getAuditInfo(req) {
  return {
    ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  };
}

export async function listAssessments(req, res, next) {
  try {
    const assessments = await assessmentsService.listAssessments(req.query, req.user);
    res.json(assessments);
  } catch (err) {
    next(err);
  }
}

export async function getAssessmentById(req, res, next) {
  try {
    const assessment = await assessmentsService.getAssessmentById(req.params._id, req.user);
    if (!assessment) return res.status(404).json({ msg: "Assessment not found" });
    res.json(assessment);
  } catch (err) {
    next(err);
  }
}

export async function getMyAssessmentAttempt(req, res, next) {
  try {
    const attempt = await assessmentsService.getMyAssessmentAttempt(req.params._id, req.user._id);
    res.json(attempt || null);
  } catch (err) {
    next(err);
  }
}

export async function createAssessment(req, res, next) {
  try {
    const assessment = await assessmentsService.createAssessment(req.body, req.user._id);
    res.status(201).json(assessment);
  } catch (err) {
    next(err);
  }
}

export async function updateAssessment(req, res, next) {
  try {
    const assessment = await assessmentsService.updateAssessment(req.params._id, req.body);
    if (!assessment) return res.status(404).json({ msg: "Assessment not found" });
    res.json(assessment);
  } catch (err) {
    next(err);
  }
}

export async function deleteAssessment(req, res, next) {
  try {
    await assessmentsService.deleteAssessment(req.params._id);
    res.json({ msg: "Assessment deleted" });
  } catch (err) {
    next(err);
  }
}

export async function startAssessment(req, res, next) {
  try {
    const attempt = await assessmentsService.startAssessment(req.params._id, req.user._id, getAuditInfo(req));
    res.json(attempt);
  } catch (err) {
    next(err);
  }
}

export async function submitAssessment(req, res, next) {
  try {
    const attempt = await assessmentsService.submitAssessment(req.params.attemptId, req.user, getAuditInfo(req));
    res.json(attempt);
  } catch (err) {
    next(err);
  }
}

export async function logAntiCheatingEvent(req, res, next) {
  try {
    const { eventType } = req.body;
    const attempt = await assessmentsService.logAntiCheatingEvent(req.params.attemptId, eventType, req.user);
    res.json(attempt);
  } catch (err) {
    next(err);
  }
}

export async function getAssessmentAttemptById(req, res, next) {
  try {
    const attempt = await assessmentsService.getAssessmentAttemptById(req.params.attemptId, req.user);
    if (!attempt) return res.status(404).json({ msg: "Attempt not found" });
    res.json(attempt);
  } catch (err) {
    next(err);
  }
}

export async function listAssessmentAttempts(req, res, next) {
  try {
    const attempts = await assessmentsService.listAssessmentAttempts(req.params._id, req.user, req.query);
    res.json(attempts);
  } catch (err) {
    next(err);
  }
}

export async function getAssessmentAttendance(req, res, next) {
  try {
    const attendance = await assessmentsService.getAssessmentAttendance(req.params._id, req.user);
    res.json(attendance);
  } catch (err) {
    next(err);
  }
}

export async function getAttemptSubmissions(req, res, next) {
  try {
    const submissions = await assessmentsService.getAttemptSubmissions(req.params.attemptId, req.user, req.query);
    res.json(submissions);
  } catch (err) {
    next(err);
  }
}

export async function getAnnouncements(req, res, next) {
  try {
    const announcements = await assessmentsService.getAnnouncements(req.params._id);
    res.json(announcements);
  } catch (err) {
    next(err);
  }
}

export async function createAnnouncement(req, res, next) {
  try {
    const announcement = await assessmentsService.createAnnouncement(req.params._id, req.body.message);
    res.status(201).json(announcement);
  } catch (err) {
    next(err);
  }
}
