import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { store: new Map() };

vi.mock('../config/redis.js', () => ({
  getRedis: () => ({
    incr: vi.fn(async (key) => {
      const next = (state.store.get(key) || 0) + 1;
      state.store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1)
  })
}));

vi.mock('../config/env.js', () => ({
  env: { COLLEGE_SUBMISSION_QUOTA: 2, COLLEGE_SUBMISSION_QUOTA_WINDOW_SECONDS: 60 }
}));

import { checkCollegeSubmissionQuota } from './quota.service.js';

describe('checkCollegeSubmissionQuota', () => {
  beforeEach(() => {
    state.store.clear();
  });

  it('allows submissions under the configured limit', async () => {
    const first = await checkCollegeSubmissionQuota('college-1');
    const second = await checkCollegeSubmissionQuota('college-1');
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it('blocks submissions once the limit is exceeded', async () => {
    await checkCollegeSubmissionQuota('college-1');
    await checkCollegeSubmissionQuota('college-1');
    const third = await checkCollegeSubmissionQuota('college-1');
    expect(third.allowed).toBe(false);
    expect(third.limit).toBe(2);
  });

  it('tracks colleges independently', async () => {
    await checkCollegeSubmissionQuota('college-1');
    await checkCollegeSubmissionQuota('college-1');
    const otherCollege = await checkCollegeSubmissionQuota('college-2');
    expect(otherCollege.allowed).toBe(true);
  });

  it('fails open when collegeId is missing', async () => {
    const result = await checkCollegeSubmissionQuota(null);
    expect(result.allowed).toBe(true);
  });
});
