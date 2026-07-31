import mongoose from "mongoose";
const { Schema } = mongoose;

const CollegeSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true }
  },
  { timestamps: true }
);

export default mongoose.model("College", CollegeSchema);
