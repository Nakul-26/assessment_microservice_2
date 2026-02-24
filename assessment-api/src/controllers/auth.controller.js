import * as authService from "../services/auth.service.js";

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
  try {
    const result = await authService.login({ email, password });
    return res.json(result);
  } catch (err) {
    if (err.status && err.body) {
      return res.status(err.status).json(err.body);
    }
    next(err);
  }
}
