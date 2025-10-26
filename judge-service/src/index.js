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
      // expected body: { submissionId, problemId, language, code, tests }
      console.log("Received submission message:", body);
      submissionId = body.submissionId;
      const { problemId, language: langId, code, tests } = body;

      console.log(`Processing submission: ${submissionId}`);
      const submission = await Submission.findById(submissionId).populate('problem');
      console.log('Fetched submission from DB:', submission);
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
      console.log(`Using language: ${langId}`);
      if (!lang) throw new Error(`Unsupported language: ${langId}`);

      // run
      console.log(`Running submission ${submissionId}`);
      console.log(`Test cases: ${JSON.stringify(problem.testCases)}`);
      console.log(`User code: ${code}`);
      console.log(`Language config: ${JSON.stringify(lang)}`);
      console.log(`Timeout: ${undefined}`);
      // Prefer functionName from message (API sends this); fall back to problem.functionName or functionSignatures
      function extractNameFromSignature(sig) {
        if (!sig || typeof sig !== 'string') return null;
        // JS: function name (...) {  OR function name(...) {
        let m = sig.match(/function\s+([A-Za-z0-9_]+)/);
        if (m && m[1]) return m[1];
        // Python: def name(
        m = sig.match(/def\s+([A-Za-z0-9_]+)/);
        if (m && m[1]) return m[1];
        // Java: public .* name( ... )
        m = sig.match(/\b([A-Za-z0-9_]+)\s*\(/);
        if (m && m[1]) return m[1];
        return null;
      }

      let funcName = body.functionName || null;
      if (!funcName && problem.functionName) {
        funcName = problem.functionName.get(langId) || null;
      }
      if (!funcName && problem.functionSignatures) {
        const sig = problem.functionSignatures.get(langId) || problem.functionSignatures[langId];
        funcName = extractNameFromSignature(sig) || null;
      }

      if (!funcName) {
        console.warn(`⚠️ No functionName found for language ${langId}. Falling back to 'solution' which may fail if student's code uses a different name.`);
        funcName = 'solution';
      }

      const out = await runSubmission({
        language: lang,
        userCode: code,
        tests: problem.testCases,
        timeoutMs: undefined,
        funcName
      });


      console.log(`Execution result for submission ${submissionId}:`, out);

      // assemble result
      const resultMsg = {
        submissionId,
        language: langId,
        result: out,
        timestamp: Date.now()
      };

      // Update submission status based on execution result
      if (out.status === "ok" && out.result && out.result.status === "finished") {
        console.log('All tests executed. Processing results...');
        console.log('Judge output:', out);
        console.log('Judge result:', out.rawOutput);
        console.log('parsed raw output:', JSON.stringify(out.rawOutput));
        console.log('Judge raw output passed:', out.rawOutput.passed);
        console.log('Judge raw output total:', out.rawOutput.total);
        const passed = out.result.passed;
        const total = out.result.total;
        submission.status = (passed === total) ? 'Success' : 'Fail';
        submission.testResult = out.result; // Store the full structured result
        submission.output = out.rawOutput; // Store the raw output
        console.log(`Tests passed: ${passed}/${total}`);
        console.log('Submission output:', submission.output);
        console.log('Submission testResult:', submission.testResult);
        console.log(`Updated submission ${submissionId} status to ${submission.status}`);
        console.log('Result message to be sent:', resultMsg);
        console.log('Raw output from judge:', out.rawOutput);
        console.log('Structured result from judge:', out.result);
        console.log('123 - submissions:', submission);
      } else if (out.status === "timeout") {
        submission.status = 'Timeout';
        submission.output = out.message;
        submission.testResult = null; // Clear testResult for timeouts
      } else {
        submission.status = 'Error';
        console.log('Judge error output:', out);
        submission.output = `Error: ${out.message || JSON.stringify(out)}. Raw Output: ${out.rawOutput}`;
        submission.testResult = null; // Clear testResult for errors
      }
      await submission.save();
      console.log("write to redis");
      console.log('Updated submission in DB:', submission);
      console.log('Storing updated submission in Redis cache');
      console.log(`parsed submission:${submissionId}:`, JSON.stringify(submission));
      console.log('submission output:', submission.output);
      console.log('submission status:', submission.status);
      console.log('parsed submission outpur:', JSON.stringify(submission.output));
      console.log(`Updated submission ${submissionId} status to ${submission.status}`);
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
