import express from "express";
import { verifyToken, authorizeRoles } from "../middleware/auth.mjs";
import { env } from "../config/env.js";
import { getStripeClient } from "../config/stripe.js";
import * as billingService from "../services/billing.service.js";

const router = express.Router();

router.get("/status", verifyToken, async (req, res, next) => {
  try {
    const status = await billingService.getBillingStatus(req.user.collegeId);
    res.json(status);
  } catch (err) {
    if (err.status && err.body) return res.status(err.status).json(err.body);
    next(err);
  }
});

router.post("/checkout", verifyToken, authorizeRoles("admin", "superadmin"), async (req, res, next) => {
  try {
    const { planId } = req.body || {};
    if (!req.user.collegeId) {
      return res.status(400).json({ message: "Your account has no college to bill" });
    }
    const result = await billingService.createCheckoutSession(req.user.collegeId, planId);
    res.json(result);
  } catch (err) {
    if (err.status && err.body) return res.status(err.status).json(err.body);
    next(err);
  }
});

router.post("/portal", verifyToken, authorizeRoles("admin", "superadmin"), async (req, res, next) => {
  try {
    if (!req.user.collegeId) {
      return res.status(400).json({ message: "Your account has no college to bill" });
    }
    const result = await billingService.createPortalSession(req.user.collegeId);
    res.json(result);
  } catch (err) {
    if (err.status && err.body) return res.status(err.status).json(err.body);
    next(err);
  }
});

// Stripe calls this directly — no verifyToken. Authenticity comes from the signature
// check below, not a JWT. Requires the raw body, wired in app.js before the global
// express.json() parser consumes it.
router.post("/webhook", async (req, res) => {
  const signature = req.headers["stripe-signature"];

  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ message: "Billing is not configured" });
  }

  let event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ message: `Webhook signature verification failed: ${err.message}` });
  }

  try {
    await billingService.handleStripeEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error("Error handling Stripe webhook event", event.type, err);
    res.status(500).json({ message: "Failed to process webhook event" });
  }
});

export default router;
