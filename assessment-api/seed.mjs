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

const sampleProblem = {
    title: 'Two Sum',
    description: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. You may assume that each input would have exactly one solution, and you may not use the same element twice. You can return the answer in any order.',
    difficulty: 'Easy',
    testCases: [
        {
            input: { "nums": [2, 7, 11, 15], "target": 9 },
            expectedOutput: [0, 1]
        },
        {
            input: { "nums": [3, 2, 4], "target": 6 },
            expectedOutput: [1, 2]
        }
    ],
    functionSignatures: {
        javascript: `function twoSum(nums, target) {
  // Write your code here
}`,
        python: `def two_sum(nums, target):
  # Write your code here`,
        java: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        // Write your code here
    }
}`,
        cpp: `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        // Write your code here
    }
};`
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