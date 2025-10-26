import mongoose from 'mongoose';
import amqp from 'amqplib';
import fs from 'fs';
import path from 'path';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/assessment_db';
const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://user:password@rabbitmq:5672';
const QUEUE_NAME = process.env.QUEUE_NAME || 'submission_queue';

async function main() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = mongoose.connection;
  const submissions = db.collection('submissions');
  const problems = db.collection('problems');

  const pending = await submissions.find({ status: 'Pending' }).toArray();
  console.log('Found pending submissions:', pending.length);
  const conn = await amqp.connect(RABBITMQ_URI);
  const ch = await conn.createChannel();
  await ch.assertQueue(QUEUE_NAME, { durable: true });

  for (const s of pending) {
    const problem = await problems.findOne({ _id: s.problem });
    const messageBody = {
      submissionId: s._id.toString(),
      problemId: s.problem.toString(),
      language: s.language,
      code: s.code,
      tests: problem.testCases
    };
    ch.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(messageBody)), { persistent: true });
    console.log('Requeued', s._id.toString());
  }

  await ch.close();
  await conn.close();
  mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
