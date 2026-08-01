import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// Cookie first (browser sessions, H8), then Authorization header fallback (external
// server-to-server callers - /api/integration/*, /api/judge0/* - never send cookies and
// must keep working unchanged).
function extractToken(req) {
  if (req.cookies?.token) return req.cookies.token;
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
}

export function verifyToken(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;
    if (req.user.id && !req.user._id) {
      req.user._id = req.user.id;
    }
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function optionalVerifyToken(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;
    if (req.user.id && !req.user._id) {
      req.user._id = req.user.id;
    }
  } catch (err) {
    // Ignore invalid optional token and proceed as anonymous.
  }

  next();
}

export function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}
