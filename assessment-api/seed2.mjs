
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
                type: String,
                required: true
            },
            expectedOutput: {
                type: String,
                required: true
            }
        }
    ],
    boilerplates: {
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
            input: '1 2',
            expectedOutput: '3'
        },
        {
            input: '10 20',
            expectedOutput: '30'
        }
    ],
    boilerplates: {
        javascript: `// JavaScript boilerplate for Add Two Numbers\n// Example: function addTwoNumbers(num1, num2) { return num1 + num2; }`,
        python: `# Python boilerplate for Add Two Numbers\n# Example: def add_two_numbers(num1, num2): return num1 + num2`,
        java: `// Java boilerplate for Add Two Numbers\n// Example: class Solution { public int addTwoNumbers(int num1, int num2) { return num1 + num2; } }`,
        cpp: `// C++ boilerplate for Add Two Numbers\n// Example: int addTwoNumbers(int num1, int num2) { return num1 + num2; }`
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
