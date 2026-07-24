import crypto from "crypto";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import User from "../../models/User.mjs";

const SERVICE_ACCOUNT_EMAIL = "arventiq-service@system.internal";

// Arventiq submissions have no per-candidate JWT — every request authenticates
// with the shared secret only, and is attributed to one shared service-account
// User (mirrors verifyService's mock user in integration.mjs, but this one is a
// real persisted User since Submission.userId is a required ref). Candidate/exam
// identity travels as opaque externalStudentId/externalAssessmentId metadata
// instead — see docs/arventiq-integration/PLAN.md §6.
let serviceUserIdPromise = null;

async function getOrCreateServiceUserId() {
  if (!serviceUserIdPromise) {
    serviceUserIdPromise = (async () => {
      const existing = await User.findOne({ email: SERVICE_ACCOUNT_EMAIL });
      if (existing) return existing._id;

      const placeholderPassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      const created = await User.create({
        name: "Arventiq Service Account",
        email: SERVICE_ACCOUNT_EMAIL,
        password: placeholderPassword, // unreachable via login: verifyArventiq is shared-secret only, not password auth
        role: "admin"
      });
      return created._id;
    })().catch((err) => {
      // Don't cache a rejected promise — let the next request retry.
      serviceUserIdPromise = null;
      throw err;
    });
  }
  return serviceUserIdPromise;
}

export const verifyArventiq = async (req, res, next) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token || !env.ARVENTIQ_SECRET || token !== env.ARVENTIQ_SECRET) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: invalid Arventiq credentials"
    });
  }

  try {
    const serviceUserId = await getOrCreateServiceUserId();
    req.user = {
      _id: serviceUserId,
      id: serviceUserId.toString(),
      role: "admin",
      isService: true,
      isArventiq: true
    };

    console.log(`[ARVENTIQ][REQ:${req.id}] ${req.method} ${req.originalUrl} | Time: ${new Date().toISOString()}`);
    next();
  } catch (err) {
    next(err);
  }
};
