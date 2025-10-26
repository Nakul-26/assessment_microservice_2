const amqp = require('amqplib');
const mongoose = require('mongoose');

const TARGET = process.env.TARGET_ID || '68fe0d0ec737bc85fddc58cd';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/assessment_db';
const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://user:password@rabbitmq:5672';
const QUEUE = process.env.QUEUE_NAME || 'submission_queue';

(async () => {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const oid = require('mongodb').ObjectId(TARGET);
  const s = await db.collection('submissions').findOne({_id: oid});
  if (!s) {
    console.error('Submission not found:', TARGET);
    process.exit(1);
  }
  const p = await db.collection('problems').findOne({_id: s.problem});
  const conn = await amqp.connect(RABBITMQ_URI);
  const ch = await conn.createChannel();
  await ch.assertQueue(QUEUE, { durable: true });
  const msg = {
    submissionId: s._id.toString(),
    problemId: s.problem.toString(),
    language: s.language,
    code: s.code,
    tests: p.testCases
  };
  ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(msg)), { persistent: true });
  console.log('Requeued', s._id.toString());
  await ch.close();
  await conn.close();
  process.exit(0);
})();
