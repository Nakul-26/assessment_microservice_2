
import amqp from 'amqplib';
import mongoose from 'mongoose';
import Submission from './assessment-api/models/Submission.mjs';
import Problem from './assessment-api/models/Problem.mjs';

const MONGO_URI = 'mongodb://localhost:27017/assessment_db';
const RABBITMQ_URI = 'amqp://user:password@localhost:5672';
const QUEUE_NAME = 'submission_queue';

async function testSubmission() {
    try {
        await mongoose.connect(MONGO_URI, { dbName: 'assessment_db' });
        console.log('✅ Test script connected to MongoDB');

        const problem = await Problem.findOne({ title: 'Two Sum' });
        if (!problem) {
            console.error('❌ Problem not found');
            return;
        }

        const submissionData = {
            problem: problem._id,
            language: 'python',
            code: `def two_sum(nums, target):
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                return [i, j]`
        };

        const submission = await Submission.create(submissionData);
        console.log(`✅ Submission created with ID: ${submission._id}`);

        const connection = await amqp.connect(RABBITMQ_URI);
        const channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });

        channel.sendToQueue(QUEUE_NAME, Buffer.from(submission._id.toString()), { persistent: true });
        console.log(`📥 Submission ID sent to queue: ${submission._id}`);

        await channel.close();
        await connection.close();

        // Wait for a few seconds to allow the judge to process the submission
        await new Promise(resolve => setTimeout(resolve, 5000));

        const result = await Submission.findById(submission._id);
        console.log('✅ Submission result:', result);

    } catch (err) {
        console.error('❌ Test script error:', err);
    } finally {
        await mongoose.connection.close();
        console.log('✅ Test script MongoDB connection closed');
    }
}

testSubmission();
