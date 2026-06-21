import mongoose from "mongoose";
const { Schema } = mongoose;

const AssessmentSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    durationMinutes: { type: Number, required: true },
    allowedLanguages: [{ type: String }],
    problems: [
      {
        problemId: { type: Schema.Types.ObjectId, ref: "Problem", required: true },
        maxScore: { type: Number, default: 100 }
      }
    ],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["Draft", "Published", "Completed"],
      default: "Draft"
    },
    announcements: [
      {
        message: { type: String, required: true },
        sentAt: { type: Date, default: Date.now }
      }
    ]
  },
  { timestamps: true }
);

AssessmentSchema.index({ createdBy: 1 });
AssessmentSchema.index({ status: 1 });

export default mongoose.model("Assessment", AssessmentSchema);
