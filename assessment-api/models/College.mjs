import mongoose from "mongoose";
const { Schema } = mongoose;

const CollegeSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    // Phase 2 billing fields — see assessment-api/src/config/plans.js for what each planId grants.
    planId: { type: String, default: "free" },
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },
    subscriptionStatus: {
      type: String,
      enum: ["none", "trialing", "active", "past_due", "canceled"],
      default: "none"
    },
    currentPeriodEnd: { type: Date }
  },
  { timestamps: true }
);

export default mongoose.model("College", CollegeSchema);
