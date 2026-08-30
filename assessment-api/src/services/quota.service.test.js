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
  env: {
    COLLEGE_SUBMISSION_QUOTA: 2,
    COLLEGE_SUBMISSION_QUOTA_WINDOW_SECONDS: 60,
    STUDENT_SUBMISSION_QUOTA: 2,
    STUDENT_SUBMISSION_QUOTA_WINDOW_SECONDS: 60
  }
}));

import { checkCollegeSubmissionQuota, checkStudentSubmissionQuota } from './quota.service.js';

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

describe('checkStudentSubmissionQuota', () => {
  beforeEach(() => {
    state.store.clear();
  });

  it('allows submissions under the configured limit', async () => {
    const first = await checkStudentSubmissionQuota('student-1');
    const second = await checkStudentSubmissionQuota('student-1');
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it('blocks submissions once the limit is exceeded', async () => {
    await checkStudentSubmissionQuota('student-1');
    await checkStudentSubmissionQuota('student-1');
    const third = await checkStudentSubmissionQuota('student-1');
    expect(third.allowed).toBe(false);
    expect(third.limit).toBe(2);
  });

  it('tracks students independently', async () => {
    await checkStudentSubmissionQuota('student-1');
    await checkStudentSubmissionQuota('student-1');
    const otherStudent = await checkStudentSubmissionQuota('student-2');
    expect(otherStudent.allowed).toBe(true);
  });

  it('is independent of the college-wide quota (different key prefix)', async () => {
    // Exhaust student-1's own limit...
    await checkStudentSubmissionQuota('student-1');
    await checkStudentSubmissionQuota('student-1');
    // ...but the college-wide counter (shared key prefix "submission_quota") is untouched.
    const college = await checkCollegeSubmissionQuota('college-1');
    expect(college.allowed).toBe(true);
  });

  it('fails open when userId is missing', async () => {
    const result = await checkStudentSubmissionQuota(null);
    expect(result.allowed).toBe(true);
  });
});
