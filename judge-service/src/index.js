import amqplib from "amqplib";
import mongoose from 'mongoose';
import { createClient } from 'redis';
import { RABBITMQ } from "./config.js";
import { runSubmission } from "./executor.js";
import pythonLang from "./languages/python.js";
import jsLang from "./languages/javascript.js";
import javaLang from "./languages/java.js";

// Assuming models are still in judge-service/models for now
import Problem from '../models/Problem.js';
import Submission from '../models/Submission.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/assessment_db';
const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';

const redisClient = createClient({ url: REDIS_URI });
redisClient.on('error', (err) => console.log('❌ Redis Client Error', err));

const LANGS = {
  python: pythonLang,
  javascript: jsLang,
  java: javaLang
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
      console.log("Received submission message:", body);
      submissionId = body.submissionId;
      const { problemId, language: langId, code, tests, functionName } = body;

      if (!submissionId || !problemId || !langId || !code || !tests || !functionName) {
        throw new Error("Invalid submission message body");
      }

      console.log(`Processing submission: ${submissionId}`);
      await Submission.findByIdAndUpdate(submissionId, { status: 'Running' });

      const lang = LANGS[langId];
      if (!lang) throw new Error(`Unsupported language: ${langId}`);

      console.log(`Running submission ${submissionId}`);
      const out = await runSubmission({
        language: lang,
        userCode: code,
        tests: tests,
        timeoutMs: undefined,
        funcName: functionName
      });

      console.log(`Execution result for submission ${submissionId}:`, out);

      const resultMsg = {
        submissionId,
        language: langId,
        result: out,
        timestamp: Date.now()
      };

      const submission = await Submission.findById(submissionId);
      if (out.status === "ok" && out.result && out.result.status === "finished") {
        const passed = out.result.passed;
        const total = out.result.total;
        submission.status = (passed === total) ? 'Success' : 'Fail';
        submission.testResult = out.result;
        submission.output = out.rawOutput;
      } else if (out.status === "timeout") {
        submission.status = 'Timeout';
        submission.output = out.message;
      } else {
        submission.status = 'Error';
        submission.output = `Error: ${out.message || JSON.stringify(out)}. Raw Output: ${out.rawOutput}`;
      }
      await submission.save();
      await redisClient.set(`submission:${submissionId}`, JSON.stringify(submission), { EX: 3600 });

      ch.sendToQueue(RABBITMQ.RESULT_QUEUE, Buffer.from(JSON.stringify(resultMsg)), { persistent: true });

      ch.ack(msg);
    } catch (err) {
      console.error("Error processing submission:", err);
      if (submissionId) {
        try {
          await Submission.findByIdAndUpdate(submissionId, { status: 'Error', output: `Internal Judge Error: ${err.message || err}` });
        } catch (updateErr) {
          console.error(`❌ Error updating submission ${submissionId} status after judge error:`, updateErr);
        }
      }
      try { ch.nack(msg, false, false); } catch (e) {}
    }
  }, { noAck: false });
}

start().catch(e => {
  console.error(e);
  process.exit(1);
});
