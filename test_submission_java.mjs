
import amqp from 'amqplib';
import mongoose from 'mongoose';
import Submission from './models/Submission.mjs';
import Problem from './models/Problem.mjs';

const MONGO_URI = 'mongodb://mongo:27017/assessment_db';
const RABBITMQ_URI = 'amqp://user:password@rabbitmq:5672';
const QUEUE_NAME = 'submission_queue';

async function testSubmission() {
    try {
        await mongoose.connect(MONGO_URI, { dbName: 'assessment_db' });
        console.log('✅ Test script connected to MongoDB');

        const problem = await Problem.findOne({ title: 'Sum of Even Numbers' });
        if (!problem) {
            console.error('❌ Problem not found');
            return;
        }
        console.log('Debug: problem object =', problem);
        console.log('Debug: problem.functionName.java =', problem.functionName.java);

        const submissionData = {
            problemId: problem._id,
            language: 'java',
            code: `public class Solution {
    public static int sumOfEvenNumbers(int[] nums) {
        int sum = 0;
        for (int x : nums) {
            if (x % 2 == 0) sum += x;
        }
        return sum;
    }
}`
        };

        const submission = await Submission.create(submissionData);
        console.log(`✅ Submission created with ID: ${submission._id}`);

        const connection = await amqp.connect(RABBITMQ_URI);
        const channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });

        console.log('Debug: problem.functionName.java =', problem.functionName.java);
        const msg = {
            submissionId: submission._id.toString(),
            problemId: problem._id.toString(),
            language: submission.language,
            code: submission.code,
            tests: problem.testCases,
            functionName: problem.functionName.java,
            schemaVersion: 'v2'
        };

        channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(msg)), { persistent: true });
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
