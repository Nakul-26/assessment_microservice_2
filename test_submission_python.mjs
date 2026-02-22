import amqp from 'amqplib';
import mongoose from 'mongoose';
import Submission from './assessment-api/models/Submission.mjs';
import Problem from './assessment-api/models/Problem.mjs';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/assessment_db';
const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://user:password@localhost:5672';
const QUEUE_NAME = process.env.SUBMISSION_QUEUE || 'submission_queue';

const WAIT_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1000;

const PROBLEMS = [
  {
    title: 'Python Easy: Add Two Numbers',
    description: 'Return the sum of two integers.',
    difficulty: 'Easy',
    functionName: 'add_numbers',
    template: 'def add_numbers(a, b):\n    pass',
    expectedIoType: {
      functionName: 'add_numbers',
      inputParameters: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' }
      ],
      returnType: 'number'
    },
    testCases: [
      { input: [1, 2], expectedOutput: 3, isHidden: false },
      { input: [-5, 12], expectedOutput: 7, isHidden: false },
      { input: [0, 0], expectedOutput: 0, isHidden: false }
    ],
    solution: `def add_numbers(a, b):\n    return a + b\n`
  },
  {
    title: 'Python Medium: Kth Largest',
    description: 'Return the kth largest element in the array (k is 1-based).',
    difficulty: 'Medium',
    functionName: 'kth_largest',
    template: 'def kth_largest(nums, k):\n    pass',
    expectedIoType: {
      functionName: 'kth_largest',
      inputParameters: [
        { name: 'nums', type: 'number[]' },
        { name: 'k', type: 'number' }
      ],
      returnType: 'number'
    },
    testCases: [
      { input: [[3, 2, 1, 5, 6, 4], 2], expectedOutput: 5, isHidden: false },
      { input: [[3, 2, 3, 1, 2, 4, 5, 5, 6], 4], expectedOutput: 4, isHidden: false },
      { input: [[1], 1], expectedOutput: 1, isHidden: false }
    ],
    solution: `def kth_largest(nums, k):\n    nums_sorted = sorted(nums, reverse=True)\n    return nums_sorted[k - 1]\n`
  },
  {
    title: 'Python Hard: Longest Common Prefix',
    description: 'Return the longest common prefix among the input strings.',
    difficulty: 'Hard',
    functionName: 'longest_common_prefix',
    template: 'def longest_common_prefix(strs):\n    pass',
    expectedIoType: {
      functionName: 'longest_common_prefix',
      inputParameters: [
        { name: 'strs', type: 'string[]' }
      ],
      returnType: 'string'
    },
    testCases: [
      { input: [['flower', 'flow', 'flight']], expectedOutput: 'fl', isHidden: false },
      { input: [['dog', 'racecar', 'car']], expectedOutput: '', isHidden: false },
      { input: [['interview', 'internet', 'internal']], expectedOutput: 'inter', isHidden: false },
      { input: [['a']], expectedOutput: 'a', isHidden: false }
    ],
    solution: `def longest_common_prefix(strs):\n    if not strs:\n        return ''\n    shortest = min(strs, key=len)\n    for i, ch in enumerate(shortest):\n        for s in strs:\n            if s[i] != ch:\n                return shortest[:i]\n    return shortest\n`
  }
];

async function upsertProblem(problem) {
  const doc = {
    title: problem.title,
    description: problem.description,
    difficulty: problem.difficulty,
    testCases: problem.testCases,
    functionDefinitions: {
      python: {
        name: problem.functionName,
        template: problem.template
      }
    },
    expectedIoType: problem.expectedIoType,
    tags: ['python-test'],
    isPremium: false
  };

  const existing = await Problem.findOne({ title: problem.title });
  if (existing) {
    await Problem.updateOne({ _id: existing._id }, { $set: doc });
    return Problem.findById(existing._id);
  }
  return Problem.create(doc);
}

function resolveFunctionName(problemDoc) {
  const defs = problemDoc.functionDefinitions;
  if (!defs) return 'solution';
  if (typeof defs.get === 'function') {
    return defs.get('python')?.name || 'solution';
  }
  return defs.python?.name || 'solution';
}

async function waitForResult(submissionId) {
  const start = Date.now();
  while (Date.now() - start < WAIT_TIMEOUT_MS) {
    const result = await Submission.findById(submissionId);
    if (!result) return { status: 'Error', message: 'submission not found' };
    if (result.status && result.status !== 'Pending' && result.status !== 'Running') {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return { status: 'Error', message: `timeout after ${WAIT_TIMEOUT_MS}ms` };
}

async function submitAndVerify(problem, problemDoc, channel) {
  const submission = await Submission.create({
    problemId: problemDoc._id,
    language: 'python',
    code: problem.solution,
    status: 'Pending'
  });

  const messageBody = {
    schemaVersion: 'v2',
    submissionId: submission._id.toString(),
    problemId: problemDoc._id.toString(),
    language: 'python',
    code: problem.solution,
    tests: problemDoc.testCases,
    functionName: resolveFunctionName(problemDoc)
  };

  channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(messageBody)), { persistent: true });
  console.log(`📥 ${problem.difficulty} submission queued: ${submission._id}`);

  const result = await waitForResult(submission._id);
  const passed = result?.status === 'Success';
  const summary = {
    title: problem.title,
    difficulty: problem.difficulty,
    status: result?.status || 'Unknown',
    passedTests: result?.testResult?.passed,
    totalTests: result?.testResult?.total
  };

  return { passed, summary, result };
}

async function testPythonSubmissions() {
  let connection;
  let channel;
  try {
    await mongoose.connect(MONGO_URI, { dbName: 'assessment_db' });
    console.log('✅ Connected to MongoDB');

    connection = await amqp.connect(RABBITMQ_URI);
    channel = await connection.createChannel();
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    console.log('✅ Connected to RabbitMQ');

    const results = [];

    for (const problem of PROBLEMS) {
      const problemDoc = await upsertProblem(problem);
      console.log(`✅ ${problem.difficulty} problem ready: ${problemDoc.title}`);
      const run = await submitAndVerify(problem, problemDoc, channel);
      results.push(run);
      console.log(`✅ ${problem.difficulty} result:`, run.summary);
    }

    const failed = results.filter(r => !r.passed);
    if (failed.length > 0) {
      console.error('❌ Some Python submissions failed:');
      for (const f of failed) {
        console.error(f.summary);
        if (f.result?.testResult?.details) {
          console.error(JSON.stringify(f.result.testResult.details, null, 2));
        }
      }
      process.exitCode = 1;
    } else {
      console.log('✅ All Python submissions passed');
    }
  } catch (err) {
    console.error('❌ Test script error:', err);
    process.exitCode = 1;
  } finally {
    if (channel) await channel.close();
    if (connection) await connection.close();
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  }
}

testPythonSubmissions();
