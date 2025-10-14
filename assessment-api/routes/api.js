import express from 'express';
import Problem from '../models/Problem.js';
import Submission from '../models/Submission.js';
import amqp from 'amqplib';

const router = express.Router();

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://localhost';
const QUEUE_NAME = 'submission_queue';

let amqpChannel = null;

// Initialize AMQP connection lazily
async function initAmqp() {
  if (amqpChannel) return amqpChannel;

  const conn = await amqp.connect(RABBITMQ_URI);
  const channel = await conn.createChannel();
  await channel.assertQueue(QUEUE_NAME, { durable: true });
  amqpChannel = channel;
  return channel;
}

// List problems
router.get('/problems', async (req, res) => {
  const problems = await Problem.find({});
  res.json(problems);
});

// Get a single problem
router.get('/problems/:id', async (req, res) => {
  const problem = await Problem.findById(req.params.id);
  if (!problem) return res.status(404).json({ error: 'Not found' });
  res.json(problem);
});

// Create submission: save to DB, enqueue submission ID for judge-service
router.post('/submit', async (req, res) => {
  try {
    const { problemId, code, language } = req.body;
    if (!problemId || !code || !language) return res.status(400).json({ error: 'Missing fields' });

    const submission = await Submission.create({ problem: problemId, code, language, status: 'Pending' });

    // Ensure AMQP channel is ready and publish submission id
    const channel = await initAmqp();
    channel.sendToQueue(QUEUE_NAME, Buffer.from(submission._id.toString()), { persistent: true });

    res.status(201).json(submission);
  } catch (err) {
    console.error('Error creating submission:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get submission status
router.get('/submissions/:id', async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Not found' });
    res.json(submission);
  } catch (err) {
    console.error('Error fetching submission:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
