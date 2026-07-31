import mongoose from "mongoose";
const { Schema } = mongoose;

const AssessmentAttemptSchema = new Schema(
  {
    assessmentId: { type: Schema.Types.ObjectId, ref: "Assessment", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    collegeId: { type: Schema.Types.ObjectId, ref: "College" },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
    score: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Active", "Submitted", "TimedOut"],
      default: "Active"
    },
    graceMinutes: { type: Number, default: 0 },
    codeDrafts: { type: Schema.Types.Mixed, default: {} },
    challenge: {
      status: { type: String, enum: ["None", "Raised", "Accepted", "Rejected"], default: "None" },
      reason: { type: String },
      facultyComment: { type: String },
      raisedAt: { type: Date },
      resolvedAt: { type: Date }
    },
    // Anti-cheating tracking
    tabSwitchCount: { type: Number, default: 0 },
    copyCount: { type: Number, default: 0 },
    pasteCount: { type: Number, default: 0 },
    fullscreenExitCount: { type: Number, default: 0 },
    problemOrder: [{ type: Schema.Types.ObjectId, ref: "Problem" }],
    timeline: [
      {
        event: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        details: { type: Schema.Types.Mixed }
      }
    ]
  },
  { timestamps: true }
);

// Add indexes for scalability
AssessmentAttemptSchema.index({ assessmentId: 1 });
AssessmentAttemptSchema.index({ studentId: 1 });
AssessmentAttemptSchema.index({ collegeId: 1 });
// Compound index for unique attempts and faster lookups
AssessmentAttemptSchema.index({ assessmentId: 1, studentId: 1 }, { unique: true });

export default mongoose.model("AssessmentAttempt", AssessmentAttemptSchema);
