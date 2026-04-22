import 'dotenv/config';
import mongoose from 'mongoose';
import Problem from './models/Problem.mjs'; // Import the official model
import dotenv from 'dotenv';
dotenv.config({ path: 'assessment-api/.env' });

const dbURI = process.env.MONGO_URI;

async function checkProblemData() {
    try {
        await mongoose.connect(dbURI, { dbName: 'assessment_db' });
        console.log('✅ Connected to MongoDB');

        const problem = await Problem.findOne({ title: 'Sum of Even Numbers' });
        if (!problem) {
            console.error('❌ Problem not found');
            return;
        }

        console.log('Problem found:');
        console.log('  title:', problem.title);
        console.log('  functionName:', problem.functionName);
        console.log('  parameters:', problem.parameters);
        console.log('  returnType:', problem.returnType);
        console.log('  testCases:', problem.testCases);

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed');
    }
}

checkProblemData();
