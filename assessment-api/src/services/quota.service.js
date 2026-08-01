import { getRedis } from "../config/redis.js";
import { env } from "../config/env.js";

// H5: the judge's container pool is one shared, CPU-bound resource per language with a
// small measured throughput ceiling (see capacity notes) — literal per-college pools
// would fragment already-scarce capacity rather than fix isolation. This is the fair-
// scheduling stand-in instead: a fixed-window counter per collegeId, checked before a
// submission is queued, so one noisy tenant can't starve acquisition for everyone else.
export async function checkCollegeSubmissionQuota(collegeId) {
  const redis = getRedis();
  // Fail open: a Redis outage should not block submissions, only this fairness check.
  if (!redis || !collegeId) {
    return { allowed: true };
  }

  const windowSeconds = env.COLLEGE_SUBMISSION_QUOTA_WINDOW_SECONDS;
  const limit = env.COLLEGE_SUBMISSION_QUOTA;
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `submission_quota:${collegeId}:${windowStart}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    return { allowed: count <= limit, limit, count, windowSeconds };
  } catch (err) {
    return { allowed: true };
  }
}
