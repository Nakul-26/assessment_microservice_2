import College from "../../models/College.mjs";
import { HttpError } from "../utils/httpError.js";
import * as authService from "./auth.service.js";

function slugify(name) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "college";
}

async function uniqueSlug(base) {
  let slug = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await College.findOne({ slug })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
}

// Self-serve signup: creates a brand-new College tenant plus its first user, who is
// always the college's admin — role and collegeId are never client-supplied (that was
// the privilege-escalation shape the old, deleted RegisterPage.jsx had). Reuses
// authService.register rather than duplicating password-hashing/user-creation logic;
// rolls back the College if user creation fails (e.g. duplicate email), mirroring the
// rollback-on-partial-failure idiom already used in authService.bulkRegister.
export async function signup({ collegeName, name, email, password }) {
  if (!collegeName || typeof collegeName !== "string" || !collegeName.trim()) {
    throw new HttpError(400, "College name is required", { message: "College name is required" });
  }
  if (!name || !email || !password) {
    throw new HttpError(400, "Name, email, and password are required", {
      message: "Name, email, and password are required"
    });
  }

  const slug = await uniqueSlug(slugify(collegeName));
  const college = await College.create({ name: collegeName.trim(), slug });

  try {
    return await authService.register({
      name,
      email,
      password,
      role: "admin",
      collegeId: college._id.toString()
    });
  } catch (err) {
    await College.findByIdAndDelete(college._id);
    throw err;
  }
}
