import amqp from 'amqplib';
import mongoose from 'mongoose';
import Submission from './models/Submission.mjs';
import Problem from './models/Problem.mjs';

const MONGO_URI = 'mongodb://localhost:27017/assessment_db';
const RABBITMQ_URI = 'amqp://user:password@localhost:5672';
const QUEUE_NAME = 'submission_queue';

async function testSubmission() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Test script connected to MongoDB');

        const problem = await Problem.findOne({ title: 'Add Two Numbers' });
        if (!problem) {
            console.error('❌ Problem not found');
            return;
        }

        const submissionData = {
            problemId: problem._id.toString(),
            language: 'javascript',
            code: `function addTwoNumbers(num1, num2) {\n  return num1 + num2;\n}`,
            functionName: 'addTwoNumbers',
            tests: problem.tests
        };

        const submission = await Submission.create({
            problemId: problem._id,
            language: submissionData.language,
            code: submissionData.code,
            status: 'Pending'
        });
        console.log(`✅ Submission created with ID: ${submission._id}`);

        const submissionMessage = {
            schemaVersion: 'v2',
            submissionId: submission._id.toString(),
            problemId: problem._id.toString(),
            language: submissionData.language,
            code: submissionData.code,
            functionName: 'addTwoNumbers',
            tests: problem.tests
        };

        const connection = await amqp.connect(RABBITMQ_URI);
        const channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });

        channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(submissionMessage)), { persistent: true });
        console.log(`📥 Submission message sent to queue: ${JSON.stringify(submissionMessage)}`);

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
