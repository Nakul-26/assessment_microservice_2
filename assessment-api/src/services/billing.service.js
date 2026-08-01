import College from "../../models/College.mjs";
import User from "../../models/User.mjs";
import UsageEvent from "../../models/UsageEvent.mjs";
import { env } from "../config/env.js";
import { getPlan } from "../config/plans.js";
import { getStripeClient } from "../config/stripe.js";
import { HttpError } from "../utils/httpError.js";

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getBillingStatus(collegeId) {
  if (!collegeId) {
    const plan = getPlan("free");
    return {
      planId: "free",
      label: plan.label,
      subscriptionStatus: "none",
      currentPeriodEnd: null,
      seatsUsed: 0,
      seatLimit: plan.seatLimit,
      submissionsThisMonth: 0,
      submissionQuotaPerMonth: plan.submissionQuotaPerMonth,
      allowsPremiumProblems: plan.allowsPremiumProblems
    };
  }

  const college = await College.findById(collegeId);
  if (!college) throw new HttpError(404, "College not found", { message: "College not found" });

  const plan = getPlan(college.planId);
  const [seatsUsed, submissionsThisMonth] = await Promise.all([
    User.countDocuments({ collegeId }),
    UsageEvent.countDocuments({ collegeId, createdAt: { $gte: startOfMonth() } })
  ]);

  return {
    planId: college.planId,
    label: plan.label,
    subscriptionStatus: college.subscriptionStatus,
    currentPeriodEnd: college.currentPeriodEnd || null,
    seatsUsed,
    seatLimit: plan.seatLimit,
    submissionsThisMonth,
    submissionQuotaPerMonth: plan.submissionQuotaPerMonth,
    allowsPremiumProblems: plan.allowsPremiumProblems
  };
}

export async function createCheckoutSession(collegeId, planId) {
  const plan = getPlan(planId);
  if (!plan.stripePriceId) {
    throw new HttpError(400, "This plan is not purchasable yet", { message: "This plan is not purchasable yet" });
  }

  const college = await College.findById(collegeId);
  if (!college) throw new HttpError(404, "College not found", { message: "College not found" });

  const stripe = getStripeClient();

  if (!college.stripeCustomerId) {
    const customer = await stripe.customers.create({
      name: college.name,
      metadata: { collegeId: String(college._id) }
    });
    college.stripeCustomerId = customer.id;
    await college.save();
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: college.stripeCustomerId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: env.BILLING_SUCCESS_URL || "http://localhost:5173/admin/billing?billing=success",
    cancel_url: env.BILLING_CANCEL_URL || "http://localhost:5173/admin/billing?billing=cancel",
    metadata: { collegeId: String(college._id), planId }
  });

  return { url: session.url };
}

export async function createPortalSession(collegeId) {
  const college = await College.findById(collegeId);
  if (!college) throw new HttpError(404, "College not found", { message: "College not found" });
  if (!college.stripeCustomerId) {
    throw new HttpError(400, "No billing account yet", { message: "Subscribe to a plan before managing billing" });
  }

  const stripe = getStripeClient();
  const portal = await stripe.billingPortal.sessions.create({
    customer: college.stripeCustomerId,
    return_url: env.BILLING_SUCCESS_URL || "http://localhost:5173/admin/billing"
  });

  return { url: portal.url };
}

// Pure by design: takes an already-verified Stripe event object so the state-transition
// logic is unit-testable without a real Stripe account. Signature verification against
// the raw request body happens in billing.routes.js, not here.
export async function handleStripeEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const collegeId = session.metadata?.collegeId;
      if (!collegeId) return;
      await College.findByIdAndUpdate(collegeId, {
        stripeSubscriptionId: session.subscription || undefined,
        planId: session.metadata?.planId || undefined,
        subscriptionStatus: "active"
      });
      return;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object;
      const college = await College.findOne({ stripeCustomerId: subscription.customer });
      if (!college) return;
      college.subscriptionStatus = subscription.status;
      if (subscription.current_period_end) {
        college.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      }
      await college.save();
      return;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const college = await College.findOne({ stripeCustomerId: subscription.customer });
      if (!college) return;
      college.planId = "free";
      college.subscriptionStatus = "canceled";
      college.stripeSubscriptionId = undefined;
      await college.save();
      return;
    }
    default:
      return;
  }
}

// Mirrors quota.service.js's checkCollegeSubmissionQuota: fails open on a missing
// collegeId or a DB error, since this is a billing cap, not a security boundary.
export async function checkPlanUsageLimit(collegeId) {
  if (!collegeId) return { allowed: true };
  try {
    const college = await College.findById(collegeId);
    if (!college) return { allowed: true };
    const plan = getPlan(college.planId);
    if (!Number.isFinite(plan.submissionQuotaPerMonth)) {
      return { allowed: true, limit: plan.submissionQuotaPerMonth };
    }
    const count = await UsageEvent.countDocuments({ collegeId, createdAt: { $gte: startOfMonth() } });
    return { allowed: count < plan.submissionQuotaPerMonth, limit: plan.submissionQuotaPerMonth, count };
  } catch (err) {
    return { allowed: true };
  }
}

export async function collegeAllowsPremium(collegeId) {
  if (!collegeId) return false;
  const college = await College.findById(collegeId);
  if (!college) return false;
  return getPlan(college.planId).allowsPremiumProblems;
}
