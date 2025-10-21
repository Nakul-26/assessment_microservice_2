import amqplib from "amqplib";
import mongoose from 'mongoose';
import { createClient } from 'redis';
import { RABBITMQ } from "./config.js";
import { runSubmission } from "./executor.js";
import pythonLang from "./languages/python.js";
import jsLang from "./languages/javascript.js";

// Assuming models are still in judge-service/models for now
import Problem from '../models/Problem.js';
import Submission from '../models/Submission.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/assessment_db';
const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';

const redisClient = createClient({ url: REDIS_URI });
redisClient.on('error', (err) => console.log('❌ Redis Client Error', err));

const LANGS = {
  python: pythonLang,
  javascript: jsLang
};

async function start() {
  // Connect to MongoDB
  try {
    await mongoose.connect(MONGO_URI, { dbName: 'assessment_db' });
    console.log('✅ Judge service connected to MongoDB');
  } catch (err) {
    console.error('❌ Judge service MongoDB connection error:', err);
    process.exit(1);
  }

  // Connect to Redis
  try {
    await redisClient.connect();
    console.log('✅ Redis client connected');
  } catch (err) {
    console.error('❌ Redis client connection error:', err);
    process.exit(1);
  }

  const conn = await amqplib.connect(RABBITMQ.URL);
  const ch = await conn.createChannel();
  await ch.assertQueue(RABBITMQ.SUBMISSION_QUEUE, { durable: true });
  await ch.assertQueue(RABBITMQ.RESULT_QUEUE, { durable: true });

  console.log("Judge worker ready, waiting for messages...");

  ch.consume(RABBITMQ.SUBMISSION_QUEUE, async (msg) => {
    if (!msg) return;
    let submissionId;
    try {
      const body = JSON.parse(msg.content.toString());
      // expected body: { submissionId, problemId, language, code, tests }
      console.log("Received submission message:", body);
      submissionId = body.submissionId;
      const { problemId, language: langId, code, tests } = body;

      console.log(`Processing submission: ${submissionId}`);
      const submission = await Submission.findById(submissionId).populate('problem');
      if (!submission) {
          console.error(`❌ Submission with ID ${submissionId} not found.`);
          ch.ack(msg);
          return;
      }

      const problem = submission.problem;
      if (!problem) {
          console.error(`❌ Problem with ID ${submission.problem} not found.`);
          submission.status = 'Fail';
          submission.output = 'Internal error: Problem not found.';
          await submission.save();
          ch.ack(msg);
          return;
      }

      console.log(`Found problem: ${problem.title}`);
      submission.status = 'Running';
      await submission.save();

      const lang = LANGS[langId];
      if (!lang) throw new Error(`Unsupported language: ${langId}`);

      // run
      const out = await runSubmission({ language: lang, userCode: code, tests: problem.testCases, timeoutMs: undefined });

      // assemble result
      const resultMsg = {
        submissionId,
        language: langId,
        result: out,
        timestamp: Date.now()
      };

      // Update submission status based on execution result
      if (out.status === "ok" && out.result && out.result.status === "finished") {
        const passed = out.result.passed;
        const total = out.result.total;
        submission.status = (passed === total) ? 'Success' : 'Fail';
        submission.output = JSON.stringify(out.result.details);
      } else if (out.status === "timeout") {
        submission.status = 'Timeout';
        submission.output = out.message;
      } else {
        submission.status = 'Error';
        submission.output = `Error: ${out.message || JSON.stringify(out)}. Raw Output: ${out.rawOutput}`;
      }
      await submission.save();
      await redisClient.set(`submission:${submissionId}`, JSON.stringify(submission), { EX: 3600 });

      // publish to results queue
      ch.sendToQueue(RABBITMQ.RESULT_QUEUE, Buffer.from(JSON.stringify(resultMsg)), { persistent: true });

      // ack the original message
      ch.ack(msg);
    } catch (err) {
      console.error("Error processing submission:", err);
      // If submissionId was extracted, try to update its status to Error
      if (submissionId) {
        try {
          const submission = await Submission.findById(submissionId);
          if (submission) {
            submission.status = 'Error';
            submission.output = `Internal Judge Error: ${err.message || err}`;
            await submission.save();
            await redisClient.set(`submission:${submissionId}`, JSON.stringify(submission), { EX: 3600 });
          }
        } catch (updateErr) {
          console.error(`❌ Error updating submission ${submissionId} status after judge error:`, updateErr);
        }
      }
      // normally you'd nack or move to dead-letter queue
      try { ch.nack(msg, false, false); } catch (e) {}
    }
  }, { noAck: false });
}

start().catch(e => {
  console.error(e);
  process.exit(1);
});
