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

const sampleProblem = {
    title: 'Two Sum',
    description: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. You may assume that each input would have exactly one solution, and you may not use the same element twice. You can return the answer in any order.',
    difficulty: 'Easy',
    testCases: [
        {
            input: '[2,7,11,15] 9',
            expectedOutput: '0,1'
        },
        {
            input: '[3,2,4] 6',
            expectedOutput: '1,2'
        }
    ],
    boilerplates: {
        javascript: `// JavaScript boilerplate for Two Sum\n// Example: function twoSum(nums, target) { ... }`,
        python: `# Python boilerplate for Two Sum\n# Example: def two_sum(nums, target): ...`,
        java: `// Java boilerplate for Two Sum\n// Example: class Solution { public int[] twoSum(int[] nums, int target) { ... } }`,
        cpp: `// C++ boilerplate for Two Sum\n// Example: class Solution { public: vector<int> twoSum(vector<int>& nums, int target) { ... } };`
    }
};

const seedDB = async () => {
    try {
        await mongoose.connect(dbURI, { dbName: 'assessment_db' });
        console.log('MongoDB connected for seeding...');
        await Problem.deleteMany({});
        await Problem.create(sampleProblem);
        console.log('Database seeded!');
    } catch (err) {
        console.error('Seeding error:', err);
    } finally {
        mongoose.connection.close();
        console.log('MongoDB connection closed.');
    }
};

seedDB();