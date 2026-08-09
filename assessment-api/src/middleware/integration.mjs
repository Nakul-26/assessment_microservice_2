import { env } from "../config/env.js";
import { verifyToken } from "./auth.mjs";
import { safeCompare } from "../utils/safeCompare.js";

export const verifyService = (req, res, next) => {
  const serviceKey = req.headers["x-service-key"];

  if (!safeCompare(serviceKey, env.TESTING_PLATFORM_KEY)) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized service"
    });
  }

  // Set a mock user for service-to-service calls if not already set by verifyIntegrationStudent
  if (!req.user) {
    req.user = {
      role: "admin", // Services are treated as admin for backend-to-backend calls
      isService: true
    };
  }

  // Audit logging for integration requests
  console.log(`[INTEGRATION][REQ:${req.id}] Request from Testing Platform: ${req.method} ${req.originalUrl} | User: ${req.user?.id || req.user?._id || 'service-only'} | Time: ${new Date().toISOString()}`);

  next();
};

export const verifyIntegrationStudent = (req, res, next) => {
  // We reuse the standard verifyToken logic to validate the student JWT
  // but we could add additional checks here if needed (e.g., 'aud' claim)
  return verifyToken(req, res, next);
};
