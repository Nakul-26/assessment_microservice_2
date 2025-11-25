
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

        const problem = await Problem.findOne({ title: 'Add Two Numbers' });
        if (!problem) {
            console.error('❌ Problem not found');
            return;
        }

        const submissionData = {
            problemId: problem._id,
            language: 'javascript',
            code: `function addTwoNumbers(num1, num2) {\n  return num1 + num2;\n}`
        };

        const submission = await Submission.create(submissionData);
        console.log(`✅ Submission created with ID: ${submission._id}`);

        const connection = await amqp.connect(RABBITMQ_URI);
        const channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });

        const tests = problem.testCases.map(tc => ({
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            isHidden: tc.isHidden
        }));

        const functionName = problem.functionDefinitions.get(submission.language)?.name || 'solution';

        const messageBody = {
            schemaVersion: 'v2', // New version
            submissionId: submission._id.toString(),
            problemId: problem._id.toString(),
            language: submission.language,
            code: submission.code,
            tests: tests,
            functionName: functionName
        };

        channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(messageBody)), { persistent: true });
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
