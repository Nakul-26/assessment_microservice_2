import mongoose from 'mongoose';
import Problem from './models/Problem.mjs';
import 'dotenv/config';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/assessment-db';

async function fixJavaInput() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB connected');

        const problem = await Problem.findOne({ title: "Sum of Two Numbers" });
        if (problem) {
            console.log('Found problem "Sum of Two Numbers"');

            let updated = false;
            const newTestCases = problem.testCases.map(tc => {
                if (tc.input && Array.isArray(tc.input) && tc.input.length > 0 && !Array.isArray(tc.input[0])) {
                    console.log('Wrapping input for test case:', tc.input);
                    tc.input = [tc.input];
                    updated = true;
                }
                return tc;
            });

            if (updated) {
                problem.testCases = newTestCases;
                await problem.save();
                console.log('Problem updated successfully.');
            } else {
                console.log('No updates needed for test cases.');
            }

        } else {
            console.log('Problem "Sum of Two Numbers" not found.');
        }

    } catch (error) {
        console.error('Error fixing Java input:', error);
    } finally {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
            console.log('MongoDB connection closed.');
        }
    }
}

fixJavaInput();
