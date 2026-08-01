import { describe, it, expect, vi } from 'vitest';
import College from '../../models/College.mjs';

// Small deterministic seat limit so the test doesn't depend on (or need to create 15+
// users to exercise) the real placeholder number in config/plans.js.
vi.mock('../config/plans.js', () => ({
  getPlan: (planId) => ({
    free: { seatLimit: 1, submissionQuotaPerMonth: 3, allowsPremiumProblems: false },
    pro: { seatLimit: Infinity, submissionQuotaPerMonth: Infinity, allowsPremiumProblems: true }
  }[planId] || { seatLimit: 1, submissionQuotaPerMonth: 3, allowsPremiumProblems: false })
}));

const { register, bulkRegister } = await import('./auth.service.js');

describe('auth.service seat limit (Phase 2 billing)', () => {
  it('blocks register() once the plan seat limit is reached', async () => {
    const college = await College.create({ name: 'Seat Test College', slug: `seat-test-${Date.now()}`, planId: 'free' });

    await register({ name: 'User One', email: `u1-${Date.now()}@example.com`, password: 'password123', role: 'student', collegeId: college._id.toString() });

    await expect(
      register({ name: 'User Two', email: `u2-${Date.now()}@example.com`, password: 'password123', role: 'student', collegeId: college._id.toString() })
    ).rejects.toMatchObject({ status: 402 });
  });

  it('does not block registration for an unbounded (pro) plan', async () => {
    const college = await College.create({ name: 'Pro Seat College', slug: `pro-seat-${Date.now()}`, planId: 'pro' });

    await register({ name: 'User One', email: `p1-${Date.now()}@example.com`, password: 'password123', role: 'student', collegeId: college._id.toString() });
    await expect(
      register({ name: 'User Two', email: `p2-${Date.now()}@example.com`, password: 'password123', role: 'student', collegeId: college._id.toString() })
    ).resolves.toBeDefined();
  });

  it('blocks bulkRegister() when the batch would exceed the seat limit', async () => {
    const college = await College.create({ name: 'Bulk Seat College', slug: `bulk-seat-${Date.now()}`, planId: 'free' });

    await expect(
      bulkRegister(
        [
          { name: 'Bulk One', email: `b1-${Date.now()}@example.com` },
          { name: 'Bulk Two', email: `b2-${Date.now()}@example.com` }
        ],
        'defaultPass123',
        college._id.toString()
      )
    ).rejects.toMatchObject({ status: 402 });
  });
});
