
import mongoose from 'mongoose';
import Problem from './models/Problem.mjs';

const MONGO_URI = 'mongodb://mongo:27017/assessment_db';

async function listProblems() {
    try {
        await mongoose.connect(MONGO_URI, { dbName: 'assessment_db' });
        console.log('✅ Connected to MongoDB');

        const problems = await Problem.find({}, 'title');
        if (problems.length === 0) {
            console.log('No problems found in the database.');
        } else {
            console.log('Problems in the database:');
            problems.forEach(p => console.log(`- ${p.title}`));
        }

    } catch (err) {
        console.error('❌ Error connecting to MongoDB or fetching problems:', err);
    } finally {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed');
    }
}

listProblems();
