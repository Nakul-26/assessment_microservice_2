import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import User from '../models/User.mjs';
import Problem from '../models/Problem.mjs';
import Assessment from '../models/Assessment.mjs';
import AssessmentAttempt from '../models/AssessmentAttempt.mjs';
import Submission from '../models/Submission.mjs';

async function generateDemoData() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { dbName: 'assessment_db' });
    console.log("✅ Connected to MongoDB");

    // 1. Fetch some existing problems to use in the assessment
    const problems = await Problem.find().limit(3);
    if (problems.length === 0) {
      console.log("❌ No problems found in the database. Please seed problems first.");
      process.exit(1);
    }
    console.log(`Found ${problems.length} problems to include in the assessment.`);

    // 2. Create Demo Faculty/Admin
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    let admin = await User.findOne({ email: 'prof@demo.com' });
    if (!admin) {
      admin = await User.create({
        name: 'Professor Smith',
        email: 'prof@demo.com',
        password: hashedPassword,
        role: 'faculty'
      });
      console.log("Created Faculty User: prof@demo.com / password123");
    }

    // 3. Create Demo Students
    const studentData = [
      { name: 'Alice (Honest & Strong)', email: 'alice@demo.com', type: 'good' },
      { name: 'Bob (Struggling)', email: 'bob@demo.com', type: 'weak' },
      { name: 'Charlie (High Risk Cheater)', email: 'charlie@demo.com', type: 'cheater' }
    ];

    const students = [];
    for (const data of studentData) {
      let student = await User.findOne({ email: data.email });
      if (!student) {
        student = await User.create({
          name: data.name,
          email: data.email,
          password: hashedPassword,
          role: 'student'
        });
      }
      student.demoType = data.type; // Attach temporary type for logic below
      students.push(student);
      console.log(`Ensured Student User: ${data.email} / password123`);
    }

    // 4. Create an Assessment
    const assessment = await Assessment.create({
      title: `Final Exam - Data Structures (${new Date().toLocaleTimeString()})`,
      description: 'Comprehensive exam covering basic data structures and algorithms.',
      startTime: new Date(Date.now() - 3600000), // Started 1 hour ago
      endTime: new Date(Date.now() + 3600000),   // Ends in 1 hour
      durationMinutes: 120,
      createdBy: admin._id,
      status: 'Published',
      problems: problems.map(p => ({
        problemId: p._id,
        order: 1,
        maxScore: 100
      }))
    });
    console.log(`Created Assessment: ${assessment.title}`);

    // 5. Create Attempts and Submissions for each student
    for (const student of students) {
      let score = 0;
      let tabSwitchCount = 0;
      let copyCount = 0;
      let pasteCount = 0;
      let fullscreenExitCount = 0;

      // Define cheating metrics based on student persona
      if (student.demoType === 'good') {
        tabSwitchCount = 1; // Accidental switch
        pasteCount = 0;
      } else if (student.demoType === 'weak') {
        tabSwitchCount = 4; // Looking up syntax occasionally
        pasteCount = 2;
      } else if (student.demoType === 'cheater') {
        tabSwitchCount = 22; // Constantly Googling
        copyCount = 12;      // Copying question text
        pasteCount = 18;     // Pasting answers from ChatGPT
        fullscreenExitCount = 3; // Minimizing the window
      }

      // Create the attempt record
      const attempt = await AssessmentAttempt.create({
        assessmentId: assessment._id,
        studentId: student._id,
        status: 'Active',
        startedAt: new Date(Date.now() - 3000000), // 50 mins ago
        tabSwitchCount,
        copyCount,
        pasteCount,
        fullscreenExitCount
      });

      // Generate Submissions for each problem
      for (const [index, prob] of problems.entries()) {
        let subStatus = 'Fail';
        let subScore = 0;
        
        if (student.demoType === 'good') {
          subStatus = 'Success';
          subScore = 100;
        } else if (student.demoType === 'weak') {
          // Solves 1 out of 3
          if (index === 0) {
            subStatus = 'Success';
            subScore = 100;
          } else {
            subScore = 20; // Partial points or failed
          }
        } else if (student.demoType === 'cheater') {
          // Cheats and gets perfect score
          subStatus = 'Success';
          subScore = 100;
        }

        score += subScore;

        await Submission.create({
          problemId: prob._id,
          userId: student._id,
          assessmentId: assessment._id,
          attemptId: attempt._id,
          language: 'python',
          code: `# Demo solution for ${student.name}`,
          status: subStatus,
          score: subScore
        });
      }

      // Finalize attempt
      attempt.status = 'Submitted';
      attempt.submittedAt = new Date(Date.now() - 600000); // 10 mins ago
      attempt.score = score;
      await attempt.save();

      console.log(`Generated data for ${student.name}: Score ${score}, Risk Metrics: [Tabs: ${tabSwitchCount}, Pastes: ${pasteCount}]`);
    }

    console.log("\n🎉 Demo data generation complete!");
    console.log("-----------------------------------------");
    console.log("Log in as Faculty to see the Anti-Cheating Dashboard:");
    console.log("Email: prof@demo.com / Password: password123");
    console.log("-----------------------------------------");
    console.log("Log in as Students to see Student Analytics:");
    console.log("Email: alice@demo.com / Password: password123 (Strong student)");
    console.log("Email: bob@demo.com / Password: password123 (Weak student)");
    console.log("Email: charlie@demo.com / Password: password123 (High-risk student)");
    
    process.exit(0);
  } catch (err) {
    console.error("Error generating data:", err);
    process.exit(1);
  }
}

generateDemoData();