import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI || "mongodb://mongo:27017",
  MONGO_DB_NAME: process.env.MONGO_DB_NAME || "assessment_db",
  REDIS_URI: process.env.REDIS_URI || "redis://localhost:6379",
  RABBITMQ_URI: process.env.RABBITMQ_URI || "amqp://localhost",
  JWT_SECRET: process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? null : "dev_secret_change_me"),
  TESTING_PLATFORM_KEY: process.env.TESTING_PLATFORM_KEY || (process.env.NODE_ENV === "production" ? null : "testing_platform_secret"),
  ARVENTIQ_SECRET: process.env.ARVENTIQ_SECRET || (process.env.NODE_ENV === "production" ? null : "arventiq_dev_secret"),
  // Shared secret for the Judge0-compatible /judge0/submissions shim. Kept separate
  // from TESTING_PLATFORM_KEY so it can be rotated independently of the main
  // integration key, and because the caller sends it as `x-rapidapi-key` (it's
  // impersonating a Judge0 instance), not `x-service-key`.
  JUDGE0_SHIM_KEY: process.env.JUDGE0_SHIM_KEY || (process.env.NODE_ENV === "production" ? null : "judge0_shim_secret"),
  JUDGE_SERVICE_URL: process.env.JUDGE_SERVICE_URL || "http://judge-service-go:8081",
  // H5 fair-scheduling quota: submissions per college allowed within the rolling
  // window below, enforced in quota.service.js before a submission is queued.
  COLLEGE_SUBMISSION_QUOTA: Number(process.env.COLLEGE_SUBMISSION_QUOTA) || 30,
  COLLEGE_SUBMISSION_QUOTA_WINDOW_SECONDS: Number(process.env.COLLEGE_SUBMISSION_QUOTA_WINDOW_SECONDS) || 60,
  // Phase 2 billing (Stripe). Unlike the secrets above, these have no production
  // fail-fast guard on purpose: billing isn't live yet, so a missing key must not crash
  // the whole API. billing.service.js/stripe.js soft-fail (503) at call time instead.
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || null,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || null,
  STRIPE_PRICE_ID_PRO: process.env.STRIPE_PRICE_ID_PRO || null,
  BILLING_SUCCESS_URL: process.env.BILLING_SUCCESS_URL || null,
  BILLING_CANCEL_URL: process.env.BILLING_CANCEL_URL || null,
  // H8: browser-facing CORS allowlist for cookie-based auth (comma-separated origins).
  // No production default on purpose - there is no deployed frontend yet, so this stays
  // unset until one exists; set it then, no code change needed at that point.
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || ""
};

if (process.env.NODE_ENV === "production" && !env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET is required in production environment");
}

if (process.env.NODE_ENV === "production" && !env.TESTING_PLATFORM_KEY) {
  throw new Error("FATAL: TESTING_PLATFORM_KEY is required in production environment");
}

if (process.env.NODE_ENV === "production" && !env.ARVENTIQ_SECRET) {
  throw new Error("FATAL: ARVENTIQ_SECRET is required in production environment");
}

if (process.env.NODE_ENV === "production" && !env.JUDGE0_SHIM_KEY) {
  throw new Error("FATAL: JUDGE0_SHIM_KEY is required in production environment");
}
