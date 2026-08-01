import * as authService from "../services/auth.service.js";
import * as collegeService from "../services/college.service.js";

export async function signup(req, res, next) {
  const { collegeName, name, email, password } = req.body || {};
  try {
    const result = await collegeService.signup({ collegeName, name, email, password });
    return res.status(201).json(result);
  } catch (err) {
    if (err.status && err.body) {
      return res.status(err.status).json(err.body);
    }
    next(err);
  }
}

export async function register(req, res, next) {
  const { name, email, password, role, collegeId } = req.body || {};
  try {
    const result = await authService.register({ name, email, password, role, collegeId });
    return res.status(201).json(result);
  } catch (err) {
    if (err.status && err.body) {
      return res.status(err.status).json(err.body);
    }
    next(err);
  }
}

export async function login(req, res, next) {
  const { email, password } = req.body || {};
  const auditInfo = {
    ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  };

  try {
    const result = await authService.login({ email, password }, auditInfo);
    return res.json(result);
  } catch (err) {
    if (err.status && err.body) {
      return res.status(err.status).json(err.body);
    }
    next(err);
  }
}
