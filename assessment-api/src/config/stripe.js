import Stripe from "stripe";
import { env } from "./env.js";
import { HttpError } from "../utils/httpError.js";

let stripeSingleton = null;

// Lazy on purpose: billing has no live Stripe keys yet, so this must not throw at
// module-load/boot time (that would crash the whole API). It throws only when a
// billing route is actually hit, as a 503 the caller can handle.
export function getStripeClient() {
  if (!env.STRIPE_SECRET_KEY) {
    throw new HttpError(503, "Billing is not configured", { message: "Billing is not configured" });
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return stripeSingleton;
}
