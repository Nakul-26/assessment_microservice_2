
import mongoose from 'mongoose';
import Problem from './assessment-api/models/Problem.mjs';

const MONGO_URI = 'mongodb://localhost:27017/assessment_db';
const API_URL = 'http://localhost:3000/api';

async function testE2ESubmission() {
    let submissionId;
    try {
        await mongoose.connect(MONGO_URI, { dbName: 'assessment_db' });
        console.log('✅ Test script connected to MongoDB');

        const problem = await Problem.findOne({ title: 'Two Sum' });
        if (!problem) {
            console.error('❌ Problem "Two Sum" not found. Make sure to seed the database.');
            return;
        }
        console.log(`✅ Found problem "Two Sum" with ID: ${problem._id}`);

        const submissionPayload = {
            problemId: problem._id.toString(),
            language: 'python',
            code: `class Solution:
    def twoSum(self, nums, target):
        numMap = {}
        n = len(nums)

        for i in range(n):
            complement = target - nums[i]
            if complement in numMap:
                return [numMap[complement], i]
            numMap[nums[i]] = i

        return []  # No solution found`,
        };

        console.log('📤 Submitting code...');
        const submitRes = await fetch(`${API_URL}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(submissionPayload),
        });

        if (!submitRes.ok) {
            const errorBody = await submitRes.text();
            throw new Error(`Submission failed: ${submitRes.status} ${errorBody}`);
        }

        const submission = await submitRes.json();
        submissionId = submission._id;
        console.log(`✅ Submission created with ID: ${submissionId}`);

        console.log('⏳ Waiting for 15 seconds for the judge to process the submission...');
        await new Promise(resolve => setTimeout(resolve, 15000));

        console.log(`🔍 Fetching result for submission ID: ${submissionId}`);
        const resultRes = await fetch(`${API_URL}/submissions/${submissionId}`);
        if (!resultRes.ok) {
            throw new Error(`Failed to fetch submission result: ${resultRes.status}`);
        }

        const result = await resultRes.json();
        console.log('✅ Submission result:');
        console.dir(result, { depth: null });

    } catch (err) {
        console.error('❌ Test script error:', err);
    } finally {
        await mongoose.connection.close();
        console.log('✅ Test script MongoDB connection closed');
    }
}

testE2ESubmission();
