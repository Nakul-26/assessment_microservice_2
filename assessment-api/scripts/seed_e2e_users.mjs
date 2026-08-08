import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.mjs";
import Problem from "../models/Problem.mjs";
import Assessment from "../models/Assessment.mjs";

const MONGO_URI = process.env.MONGO_URI || "mongodb://mongo:27017/assessment_db";

const STUDENT_EMAIL = "student@test.com";
const FACULTY_EMAIL = "faculty@test.com";
const PASSWORD = "password123";
const ASSESSMENT_TITLE = "E2E Smoke Assessment";

async function upsertUser({ email, name, role }) {
  const hashed = await bcrypt.hash(PASSWORD, 10);
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { name, email, password: hashed, role } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`User ready: ${email} (${role})`);
  return user;
}

async function main() {
  await mongoose.connect(MONGO_URI, { dbName: process.env.MONGO_DB_NAME || "assessment_db" });
  console.log("Connected to MongoDB");

  const faculty = await upsertUser({ email: FACULTY_EMAIL, name: "Test Faculty", role: "faculty" });
  await upsertUser({ email: STUDENT_EMAIL, name: "Test Student", role: "student" });

  const problems = await Problem.find().limit(2);
  if (problems.length < 2) {
    console.error("Not enough problems in DB — run `npm run seed:problems` first.");
    process.exit(1);
  }

  await Assessment.findOneAndUpdate(
    { title: ASSESSMENT_TITLE },
    {
      $set: {
        title: ASSESSMENT_TITLE,
        description: "Seeded assessment for E2E tests",
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(Date.now() + 3600000 * 24 * 30),
        durationMinutes: 60,
        allowedLanguages: ["python", "javascript", "java", "cpp"],
        problems: problems.map((p) => ({ problemId: p._id, maxScore: 50 })),
        createdBy: faculty._id,
        status: "Published"
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`Assessment ready: ${ASSESSMENT_TITLE}`);

  console.log("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to seed E2E data:", err);
  process.exit(1);
});
