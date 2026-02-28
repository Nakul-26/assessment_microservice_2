import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../../models/User.mjs";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

function toPublicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    collegeId: user.collegeId || null
  };
}

export async function register({ name, email, password, role, collegeId }) {
  const normalizedCollegeId = typeof collegeId === "string" ? collegeId.trim() : collegeId;
  if (normalizedCollegeId && !mongoose.isValidObjectId(normalizedCollegeId)) {
    throw new HttpError(400, "Invalid collegeId", {
      message: "collegeId must be a valid Mongo ObjectId"
    });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new HttpError(409, "Email already registered", { message: "Email already registered" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password: hashed,
    role,
    collegeId: normalizedCollegeId || undefined
  });

  const token = jwt.sign(
    { id: user._id.toString(), role: user.role, email: user.email, name: user.name },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  return { token, user: toPublicUser(user) };
}

export async function login({ email, password }) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new HttpError(401, "Invalid credentials", { message: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    throw new HttpError(401, "Invalid credentials", { message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user._id.toString(), role: user.role, email: user.email, name: user.name },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  return { token, user: toPublicUser(user) };
}
