
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const dbURI = process.env.MONGO_URI;

const { Schema } = mongoose;

const ProblemSchema = new Schema({
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    difficulty: {
        type: String,
        enum: ['Easy', 'Medium', 'Hard'],
        required: true
    },
    testCases: [
        {
            input: {
                type: Schema.Types.Mixed,
                required: true
            },
            expectedOutput: {
                type: Schema.Types.Mixed,
                required: true
            }
        }
    ],
    functionSignatures: {
        type: Map,
        of: String,
        default: {}
    }
});

const Problem = mongoose.models.Problem || mongoose.model('Problem', ProblemSchema);

const sampleProblem2 = {
    title: 'Add Two Numbers',
    description: 'Given two numbers, return their sum.',
    difficulty: 'Easy',
    testCases: [
        {
            input: { "num1": 1, "num2": 2 },
            expectedOutput: 3
        },
        {
            input: { "num1": 10, "num2": 20 },
            expectedOutput: 30
        }
    ],
    functionSignatures: {
        javascript: `function addTwoNumbers(num1, num2) {\n  // Write your code here\n}`,
        python: `def add_two_numbers(num1, num2):\n  # Write your code here`,
        java: `class Solution {\n    public int addTwoNumbers(int num1, int num2) {\n        // Write your code here\n    }\n}`,
        cpp: `int addTwoNumbers(int num1, int num2) {\n    // Write your code here\n}`
    }
};

const seedDB = async () => {
    try {
        await mongoose.connect(dbURI, { dbName: 'assessment_db' });
        console.log('MongoDB connected for seeding...');
        await Problem.create(sampleProblem2);
        console.log('Database seeded!');
    } catch (err) {
        console.error('Seeding error:', err);
    } finally {
        mongoose.connection.close();
        console.log('MongoDB connection closed.');
    }
};

seedDB();
