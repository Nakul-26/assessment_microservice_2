import express from 'express';
import amqp from 'amqplib';
import { createClient } from 'redis';

import Problem from '../models/Problem.js';
import Submission from '../models/Submission.js';

const router = express.Router();

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://localhost';
const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';
const QUEUE_NAME = 'submission_queue';

// Redis client
const redisClient = createClient({ url: REDIS_URI });
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect().then(() => {
    console.log('Connected to Redis');
}).catch(err => {
    console.error('Redis connection error:', err);
});

// @route   GET /api/problems
// @desc    Get all problems
router.get('/problems', async (req, res) => {
    try {
        const problems = await Problem.find().select('-testCases');
        res.json(problems);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/problems/:id
// @desc    Get a problem by ID
router.get('/problems/:id', async (req, res) => {
    try {
        const problem = await Problem.findById(req.params.id).select('-testCases');
        if (!problem) {
            return res.status(404).json({ msg: 'Problem not found' });
        }
        res.json(problem);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/submit
// @desc    Submit code for a problem asynchronously
router.post('/submit', async (req, res) => {
    const { problemId, code, language } = req.body;

    try {
        // 1. Create submission with "Pending" status
        const submission = new Submission({ 
            problem: problemId, 
            code, 
            language, 
            status: 'Pending' 
        });
        await submission.save();

        // 2. Publish submission ID to RabbitMQ
        const connection = await amqp.connect(RABBITMQ_URI);
        const channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        channel.sendToQueue(QUEUE_NAME, Buffer.from(submission._id.toString()), { persistent: true });
        
        console.log(`Sent submission ID ${submission._id} to queue.`);
        await channel.close();
        await connection.close();

        // 3. Respond to user immediately
        res.status(202).json(submission);

    } catch (err) {
        console.error('Submit Error:', err);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/submissions/:id
// @desc    Get submission status and result
router.get('/submissions/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Check Redis cache first
        const cachedResult = await redisClient.get(`submission:${id}`);
        if (cachedResult) {
            console.log(`Cache hit for submission: ${id}`);
            return res.json(JSON.parse(cachedResult));
        }

        // 2. If not in cache, get from MongoDB
        console.log(`Cache miss for submission: ${id}. Checking DB.`);
        const submission = await Submission.findById(id);
        if (!submission) {
            return res.status(404).json({ msg: 'Submission not found' });
        }

        // Optional: Cache the result if it's final (Success/Fail)
        if (submission.status === 'Success' || submission.status === 'Fail') {
            await redisClient.set(`submission:${id}`, JSON.stringify(submission), { EX: 3600 }); // Cache for 1 hour
        }

        res.json(submission);

    } catch (err) {
        console.error('Get Submission Error:', err);
        res.status(500).send('Server Error');
    }
});

export default router;