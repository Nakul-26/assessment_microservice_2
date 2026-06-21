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

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/assessment_db';

const FIRST_NAMES = [
  'Liam', 'Olivia', 'Noah', 'Emma', 'Oliver', 'Ava', 'Elijah', 'Charlotte', 'William', 'Sophia',
  'James', 'Amelia', 'Benjamin', 'Isabella', 'Lucas', 'Mia', 'Henry', 'Evelyn', 'Alexander', 'Harper',
  'Mason', 'Camila', 'Michael', 'Gianna', 'Ethan', 'Abigail', 'Daniel', 'Luna', 'Jacob', 'Ella',
  'Logan', 'Elizabeth', 'Jackson', 'Sofia', 'Levi', 'Avery', 'Sebastian', 'Scarlett', 'Mateo', 'Emily',
  'Jack', 'Aria', 'Owen', 'Penelope', 'Theodore', 'Chloe', 'Aiden', 'Layla', 'Samuel', 'Mila'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'
];

const LANGUAGES = ['python', 'javascript', 'cpp', 'java', 'go'];
const SECTIONS = ['Section A', 'Section B', 'Section C', 'Section D'];

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI, { dbName: 'assessment_db', serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB.');

  // Find or insert faculty user for assessment creator
  let facultyUser = await User.findOne({ role: { $in: ['faculty', 'admin', 'superadmin'] } });
  if (!facultyUser) {
    const hashed = await bcrypt.hash('faculty123', 10);
    facultyUser = await User.create({
      name: 'Faculty Coordinator',
      email: 'coordinator@pilot-sim.edu',
      password: hashed,
      role: 'faculty',
    });
    console.log('Created Faculty User: coordinator@pilot-sim.edu');
  }

  // 1. Create/Ensure 20 problems exist
  console.log('Ensuring 20 pilot problems exist in the database...');
  const pilotProblems = [];
  for (let i = 1; i <= 20; i++) {
    const title = `Pilot Challenge ${i}: ${['Reverse', 'Search', 'Sort', 'Check', 'Solve', 'Find', 'Merge'][i % 7]} ${['Array', 'List', 'String', 'BST', 'Graph', 'Matrix'][i % 6]}`;
    let existing = await Problem.findOne({ title });
    if (!existing) {
      const difficulty = i <= 6 ? 'Easy' : i <= 15 ? 'Medium' : 'Hard';
      existing = await Problem.create({
        title,
        description: `This is pilot simulation problem ${i}. Write a function to solve this task.`,
        difficulty,
        functionName: `pilotSolve${i}`,
        parameters: [{ name: 'inputData', type: 'array<number>' }],
        returnType: 'number',
        timeLimitMs: 2000,
        memoryLimitMb: 256,
        compareConfig: { mode: 'EXACT', floatTolerance: 0, orderInsensitive: false },
        testCases: [
          { inputs: [[1, 2, 3]], expected: i, isSample: true, isHidden: false },
          { inputs: [[4, 5, 6]], expected: i * 2, isSample: false, isHidden: true }
        ],
        tags: ['simulation', difficulty.toLowerCase()]
      });
    }
    pilotProblems.push(existing);
  }
  console.log('20 Pilot problems are ready.');

  // 2. Create the Pilot Assessment
  console.log('Setting up pilot assessment...');
  const assessmentTitle = 'CSE-301: Semester Pilot Assessment';
  await Assessment.deleteOne({ title: assessmentTitle }); // Clear old
  
  // Pick 3 problems from our list: 1 Easy, 1 Medium, 1 Hard
  const selectedProblems = [
    { problemId: pilotProblems[0]._id, maxScore: 100 }, // Easy
    { problemId: pilotProblems[6]._id, maxScore: 100 }, // Medium
    { problemId: pilotProblems[16]._id, maxScore: 100 } // Hard
  ];

  const now = new Date();
  const startTime = new Date(now.getTime() - 20 * 60 * 1000); // started 20 mins ago
  const endTime = new Date(now.getTime() + 10 * 60 * 1000);  // ends in 10 mins

  const assessment = await Assessment.create({
    title: assessmentTitle,
    description: 'This is a pilot simulation assessment with 100 students to load-test the coding platform and analytics dashboard.',
    startTime,
    endTime,
    durationMinutes: 30,
    allowedLanguages: ['python', 'javascript', 'cpp', 'java', 'go'],
    problems: selectedProblems,
    createdBy: facultyUser._id,
    status: 'Published',
    announcements: [
      { message: 'System Pilot started successfully.', sentAt: new Date(now.getTime() - 19 * 60 * 1000) },
      { message: '10 minutes remaining. Ensure your code passes hidden test cases!', sentAt: new Date() }
    ]
  });
  console.log(`Assessment "${assessment.title}" created (ID: ${assessment._id})`);

  // 3. Clear existing simulation student attempts and users
  console.log('Clearing old simulation records...');
  const oldSimStudents = await User.find({ email: /@pilot-sim\.edu$/ });
  const oldStudentIds = oldSimStudents.map(s => s._id);
  
  if (oldStudentIds.length > 0) {
    await AssessmentAttempt.deleteMany({ studentId: { $in: oldStudentIds } });
    await Submission.deleteMany({ userId: { $in: oldStudentIds } });
    await User.deleteMany({ _id: { $in: oldStudentIds } });
  }

  // 4. Create 100 mock students
  console.log('Generating 100 student users...');
  const mockStudents = [];
  const passwordHash = await bcrypt.hash('student123', 10);
  
  for (let i = 1; i <= 100; i++) {
    const usn = `1MS21CS${String(i).padStart(3, '0')}`;
    const name = `${getRandomItem(FIRST_NAMES)} ${getRandomItem(LAST_NAMES)}`;
    const email = `${usn.toLowerCase()}@pilot-sim.edu`;
    const section = SECTIONS[(i - 1) % SECTIONS.length];

    mockStudents.push({
      name,
      email,
      password: passwordHash,
      role: 'student',
      usn,
      section
    });
  }
  const createdStudents = await User.insertMany(mockStudents);
  console.log(`Inserted 100 student users successfully.`);

  // 5. Generate realistic attempts and submissions
  console.log('Simulating candidate exam attempts & submissions...');
  
  // Status breakdown:
  // - 15 Not Started
  // - 20 Active
  // - 65 Submitted/Completed
  const attemptDocs = [];
  const submissionDocs = [];

  for (let i = 0; i < 100; i++) {
    const student = createdStudents[i];
    
    let status = 'Not Started';
    if (i >= 15 && i < 35) {
      status = 'Active';
    } else if (i >= 35) {
      status = 'Submitted';
    }

    if (status === 'Not Started') {
      continue;
    }

    // Set timestamps
    const startedAt = new Date(startTime.getTime() + getRandomInt(30000, 180000)); // started 1-3 mins after start time
    const submittedAt = status === 'Submitted' 
      ? new Date(startedAt.getTime() + getRandomInt(10 * 60000, 25 * 60000)) // finished in 10-25 mins
      : null;

    // Integrity metrics
    const hasCheated = Math.random() < 0.15; // 15% chance of some risk activity
    const tabSwitchCount = hasCheated ? getRandomInt(6, 25) : getRandomInt(0, 3);
    const copyCount = hasCheated ? getRandomInt(8, 20) : getRandomInt(0, 2);
    const pasteCount = hasCheated ? getRandomInt(5, 12) : getRandomInt(0, 1);
    const fullscreenExitCount = hasCheated ? getRandomInt(1, 4) : 0;

    // Timeline creation
    const timeline = [
      { event: 'START_ASSESSMENT', timestamp: startedAt, details: { ip: `192.168.1.${100 + i}`, userAgent: 'Mozilla/5.0 Chrome/120' } }
    ];

    if (tabSwitchCount > 0) {
      for (let t = 0; t < Math.min(tabSwitchCount, 4); t++) {
        timeline.push({
          event: 'TAB_SWITCH',
          timestamp: new Date(startedAt.getTime() + (t + 1) * 3 * 60000),
          details: { tabSwitchCount: t + 1 }
        });
      }
    }

    if (fullscreenExitCount > 0) {
      timeline.push({
        event: 'FULLSCREEN_EXIT',
        timestamp: new Date(startedAt.getTime() + 10 * 60000),
        details: { count: 1 }
      });
    }

    // Solve problems score distribution:
    // - 25% solve 3 problems (Score: 300)
    // - 40% solve 2 problems (Score: 200)
    // - 25% solve 1 problem  (Score: 100)
    // - 10% solve 0 problems (Score: 0)
    const randScoreCategory = Math.random();
    let solvedCount = 0;
    if (randScoreCategory < 0.25) solvedCount = 3;
    else if (randScoreCategory < 0.65) solvedCount = 2;
    else if (randScoreCategory < 0.90) solvedCount = 1;
    else solvedCount = 0;

    const finalScore = solvedCount * 100;

    // Simulate submissions
    selectedProblems.forEach((p, idx) => {
      const isSolved = idx < solvedCount;
      const subLanguage = getRandomItem(LANGUAGES);
      const subTime = new Date(startedAt.getTime() + (idx + 1) * 6 * 60000);

      // Create a couple of failed submissions before success to simulate coding progress
      const attemptsCount = isSolved ? getRandomInt(1, 3) : getRandomInt(0, 2);
      
      for (let s = 1; s <= attemptsCount; s++) {
        const isLast = s === attemptsCount && isSolved;
        const subStatus = isLast ? 'Success' : 'Fail';
        const subScore = isLast ? 100 : getRandomInt(10, 80);

        submissionDocs.push({
          problemId: p.problemId,
          userId: student._id,
          assessmentId: assessment._id,
          code: `// Simulation submission ${s}\nfunction pilotSolve() {\n  return ${isLast ? 'correct' : 'incorrect'};\n}`,
          language: subLanguage,
          score: subScore,
          status: subStatus,
          output: isLast ? 'All tests passed.' : 'Assertion failed: expected A, got B',
          createdAt: new Date(subTime.getTime() - (attemptsCount - s) * 2 * 60000),
          updatedAt: new Date(subTime.getTime() - (attemptsCount - s) * 2 * 60000)
        });
      }

      if (attemptsCount > 0) {
        timeline.push({
          event: 'CODE_SUBMIT',
          timestamp: subTime,
          details: { problemId: p.problemId, language: subLanguage, status: isSolved ? 'Success' : 'Fail' }
        });
      }
    });

    if (status === 'Submitted') {
      timeline.push({ event: 'SUBMIT_ASSESSMENT', timestamp: submittedAt, details: { method: 'MANUAL' } });
    }

    attemptDocs.push({
      assessmentId: assessment._id,
      studentId: student._id,
      startedAt,
      submittedAt,
      score: finalScore,
      status,
      tabSwitchCount,
      copyCount,
      pasteCount,
      fullscreenExitCount,
      problemOrder: selectedProblems.map(p => p.problemId),
      timeline,
      createdAt: startedAt,
      updatedAt: submittedAt || startedAt
    });
  }

  if (attemptDocs.length > 0) {
    await AssessmentAttempt.insertMany(attemptDocs);
  }
  if (submissionDocs.length > 0) {
    await Submission.insertMany(submissionDocs);
  }

  console.log(`Successfully generated:`);
  console.log(`- 100 students`);
  console.log(`- ${attemptDocs.length} exam attempts (15 Not Started, 20 Active, 65 Submitted)`);
  console.log(`- ${submissionDocs.length} mock code submissions`);
  console.log(`\n🎉 Pilot simulation data seeding completed successfully!`);
  console.log(`Log in as faculty to monitor results.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Pilot simulation seeding failed:', err);
  process.exit(1);
});
