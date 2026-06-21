import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["superadmin", "admin", "faculty", "student"],
      default: "student"
    },
    usn: {
      type: String,
      unique: true,
      sparse: true
    },
    section: {
      type: String
    },
    collegeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "College"
    }
  },
  { timestamps: true }
);

userSchema.index({ role: 1 });
userSchema.index({ collegeId: 1 });

export default mongoose.model("User", userSchema);
