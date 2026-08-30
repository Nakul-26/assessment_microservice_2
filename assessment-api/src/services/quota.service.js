import { getRedis } from "../config/redis.js";
import { env } from "../config/env.js";

// Shared fixed-window counter, parameterized by key prefix/scope/limit/window so the
// per-college and per-student checks below (identical shape, different scope) don't
// duplicate the incr/expire/fail-open logic.
async function checkFixedWindowQuota(keyPrefix, scopeId, limit, windowSeconds) {
  const redis = getRedis();
  // Fail open: a Redis outage should not block submissions, only this fairness check.
  if (!redis || !scopeId) {
    return { allowed: true };
  }

  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `${keyPrefix}:${scopeId}:${windowStart}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    return { allowed: count <= limit, limit, count, windowSeconds };
  } catch (err) {
    console.error("Quota check error, failing open:", err);
    return { allowed: true };
  }
}

// H5: the judge's container pool is one shared, CPU-bound resource per language with a
// small measured throughput ceiling (see capacity notes) — literal per-college pools
// would fragment already-scarce capacity rather than fix isolation. This is the fair-
// scheduling stand-in instead: a fixed-window counter per collegeId, checked before a
// submission is queued, so one noisy tenant can't starve acquisition for everyone else.
export async function checkCollegeSubmissionQuota(collegeId) {
  return checkFixedWindowQuota(
    "submission_quota",
    collegeId,
    env.COLLEGE_SUBMISSION_QUOTA,
    env.COLLEGE_SUBMISSION_QUOTA_WINDOW_SECONDS
  );
}

// Companion to the college-wide quota above. A single college's pool now has to be
// generous enough for hundreds of students submitting concurrently during an exam,
// which also means one runaway auto-submit loop or one impatient student could eat
// most of that shared budget before anyone else gets a turn. This scopes the same
// fixed-window mechanism to userId instead of collegeId so that can't happen, without
// making the college-wide number itself stingy again.
export async function checkStudentSubmissionQuota(userId) {
  return checkFixedWindowQuota(
    "student_submission_quota",
    userId,
    env.STUDENT_SUBMISSION_QUOTA,
    env.STUDENT_SUBMISSION_QUOTA_WINDOW_SECONDS
  );
}
