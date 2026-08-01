import { describe, it, expect, vi } from 'vitest';
import College from '../../models/College.mjs';
import UsageEvent from '../../models/UsageEvent.mjs';

// Deterministic, small limits so tests don't depend on (or need to insert hundreds of
// docs to exercise) the real placeholder numbers in config/plans.js.
vi.mock('../config/plans.js', () => {
  const plans = {
    free: { label: 'Free', stripePriceId: null, seatLimit: 2, submissionQuotaPerMonth: 3, allowsPremiumProblems: false },
    pro: { label: 'Pro', stripePriceId: 'price_test_pro', seatLimit: Infinity, submissionQuotaPerMonth: Infinity, allowsPremiumProblems: true }
  };
  return { getPlan: (planId) => plans[planId] || plans.free, PLANS: plans };
});

const {
  getBillingStatus,
  checkPlanUsageLimit,
  collegeAllowsPremium,
  handleStripeEvent,
  listCollegesForBilling,
  setCollegePlan
} = await import('./billing.service.js');

async function makeCollege(overrides = {}) {
  return College.create({
    name: 'Test College',
    slug: `test-college-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...overrides
  });
}

describe('billing.service', () => {
  describe('getBillingStatus', () => {
    it('returns free-plan defaults when there is no collegeId', async () => {
      const status = await getBillingStatus(null);
      expect(status.planId).toBe('free');
      expect(status.seatsUsed).toBe(0);
      expect(status.submissionsThisMonth).toBe(0);
      expect(status.allowsPremiumProblems).toBe(false);
    });

    it('reflects a real college and plan', async () => {
      const college = await makeCollege({ planId: 'pro', subscriptionStatus: 'active' });
      const status = await getBillingStatus(college._id.toString());
      expect(status.planId).toBe('pro');
      expect(status.subscriptionStatus).toBe('active');
      expect(status.allowsPremiumProblems).toBe(true);
    });
  });

  describe('checkPlanUsageLimit', () => {
    it('allows when collegeId is missing (fails open)', async () => {
      const result = await checkPlanUsageLimit(null);
      expect(result.allowed).toBe(true);
    });

    it('allows under the plan limit', async () => {
      const college = await makeCollege({ planId: 'free' });
      await UsageEvent.create({ collegeId: college._id, createdAt: new Date() });
      const result = await checkPlanUsageLimit(college._id.toString());
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(3);
    });

    it('blocks once the plan limit is reached', async () => {
      const college = await makeCollege({ planId: 'free' });
      await UsageEvent.create([
        { collegeId: college._id, createdAt: new Date() },
        { collegeId: college._id, createdAt: new Date() },
        { collegeId: college._id, createdAt: new Date() }
      ]);
      const result = await checkPlanUsageLimit(college._id.toString());
      expect(result.allowed).toBe(false);
    });

    it('never blocks on an unbounded (Infinity) plan', async () => {
      const college = await makeCollege({ planId: 'pro' });
      const result = await checkPlanUsageLimit(college._id.toString());
      expect(result.allowed).toBe(true);
    });
  });

  describe('collegeAllowsPremium', () => {
    it('is false for a free-plan college', async () => {
      const college = await makeCollege({ planId: 'free' });
      expect(await collegeAllowsPremium(college._id.toString())).toBe(false);
    });

    it('is true for a pro-plan college', async () => {
      const college = await makeCollege({ planId: 'pro' });
      expect(await collegeAllowsPremium(college._id.toString())).toBe(true);
    });

    it('is false when collegeId is missing', async () => {
      expect(await collegeAllowsPremium(null)).toBe(false);
    });
  });

  describe('handleStripeEvent', () => {
    it('activates a plan on checkout.session.completed', async () => {
      const college = await makeCollege({ planId: 'free', subscriptionStatus: 'none' });
      await handleStripeEvent({
        type: 'checkout.session.completed',
        data: { object: { subscription: 'sub_123', metadata: { collegeId: college._id.toString(), planId: 'pro' } } }
      });
      const updated = await College.findById(college._id);
      expect(updated.planId).toBe('pro');
      expect(updated.subscriptionStatus).toBe('active');
      expect(updated.stripeSubscriptionId).toBe('sub_123');
    });

    it('syncs status and period end on customer.subscription.updated', async () => {
      const college = await makeCollege({ stripeCustomerId: 'cus_123', subscriptionStatus: 'active' });
      const periodEnd = Math.floor(Date.now() / 1000) + 86400;
      await handleStripeEvent({
        type: 'customer.subscription.updated',
        data: { object: { customer: 'cus_123', status: 'past_due', current_period_end: periodEnd } }
      });
      const updated = await College.findById(college._id);
      expect(updated.subscriptionStatus).toBe('past_due');
      expect(updated.currentPeriodEnd.getTime()).toBe(periodEnd * 1000);
    });

    it('resets to free on customer.subscription.deleted', async () => {
      const college = await makeCollege({ stripeCustomerId: 'cus_456', planId: 'pro', subscriptionStatus: 'active', stripeSubscriptionId: 'sub_456' });
      await handleStripeEvent({
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_456' } }
      });
      const updated = await College.findById(college._id);
      expect(updated.planId).toBe('free');
      expect(updated.subscriptionStatus).toBe('canceled');
      expect(updated.stripeSubscriptionId).toBeUndefined();
    });

    it('is a no-op for unrecognized event types', async () => {
      await expect(handleStripeEvent({ type: 'invoice.paid', data: { object: {} } })).resolves.toBeUndefined();
    });
  });

  describe('manual plan assignment (cash/UPI payments)', () => {
    it('lists colleges with their plan and seat count', async () => {
      const college = await makeCollege({ planId: 'free' });
      const User = (await import('../../models/User.mjs')).default;
      await User.create({ name: 'Seat', email: `seat-${Date.now()}@example.com`, password: 'hashedpw', role: 'student', collegeId: college._id });

      const colleges = await listCollegesForBilling();
      const row = colleges.find((c) => String(c._id) === String(college._id));
      expect(row).toBeDefined();
      expect(row.planId).toBe('free');
      expect(row.seatsUsed).toBe(1);
    });

    it('sets a college onto a paid plan and defaults subscriptionStatus to active', async () => {
      const college = await makeCollege({ planId: 'free', subscriptionStatus: 'none' });
      const result = await setCollegePlan(college._id.toString(), { planId: 'pro' });
      expect(result.planId).toBe('pro');

      const updated = await College.findById(college._id);
      expect(updated.planId).toBe('pro');
      expect(updated.subscriptionStatus).toBe('active');
    });

    it('resets subscriptionStatus to none when moved back to free', async () => {
      const college = await makeCollege({ planId: 'pro', subscriptionStatus: 'active' });
      await setCollegePlan(college._id.toString(), { planId: 'free' });
      const updated = await College.findById(college._id);
      expect(updated.subscriptionStatus).toBe('none');
    });

    it('rejects an unknown planId', async () => {
      const college = await makeCollege();
      await expect(
        setCollegePlan(college._id.toString(), { planId: 'enterprise' })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('404s for a nonexistent college', async () => {
      await expect(
        setCollegePlan('64b000000000000000000000', { planId: 'pro' })
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
