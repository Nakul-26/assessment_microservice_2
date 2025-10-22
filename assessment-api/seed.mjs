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
        required: true
    }
});

const Problem = mongoose.models.Problem || mongoose.model('Problem', ProblemSchema);

const sampleProblems = [
    {
        title: 'Two Sum',
        description: 'Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.',
        difficulty: 'Easy',
        testCases: [
            {
                input: { nums: [2, 7, 11, 15], target: 9 },
                expectedOutput: [0, 1]
            },
            {
                input: { nums: [3, 2, 4], target: 6 },
                expectedOutput: [1, 2]
            }
        ],
        functionSignatures: {
            javascript: `function userFunction(input) {\n  const { nums, target } = input;\n  // Write your code here\n}`,
            python: `def two_sum(nums, target):\n  # Write your code here`,
            java: `class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        // Write your code here\n    }\n}`,
            cpp: `vector<int> twoSum(vector<int>& nums, int target) {\n    // Write your code here\n}`
        }
    },
    {
        title: 'Add Two Numbers',
        description: 'Given two numbers, return their sum.',
        difficulty: 'Easy',
        testCases: [
            {
                input: { num1: 1, num2: 2 },
                expectedOutput: 3
            },
            {
                input: { num1: 10, num2: 20 },
                expectedOutput: 30
            }
        ],
        functionSignatures: {
            javascript: `function userFunction(input) {\n  const { num1, num2 } = input;\n  // Write your code here\n}`,
            python: `def add_two_numbers(num1, num2):\n  # Write your code here`,
            java: `class Solution {\n    public int addTwoNumbers(int num1, int num2) {\n        // Write your code here\n    }\n}`,
            cpp: `int addTwoNumbers(int num1, int num2) {\n    // Write your code here\n}`
        }
    },
    {
        title: 'Greeter',
        description: 'Write a function that takes a name and returns a greeting.',
        difficulty: 'Easy',
        testCases: [
            {
                input: { name: "World" },
                expectedOutput: "Hello, World!"
            }
        ],
        functionSignatures: {
            javascript: `function greet(name) {\n  // Write your code here\n}`,
            python: `def greet(name):\n  # Write your code here`,
            java: `class Solution {\n    public String greet(String name) {\n        // Write your code here\n    }\n}`,
            cpp: `string greet(string name) {\n    // Write your code here\n}`
        }
    }
];

const seedDB = async () => {
    try {
        await mongoose.connect(dbURI, { dbName: 'assessment_db' });
        console.log('MongoDB connected for seeding...');
        await Problem.deleteMany({});
        await Problem.create(sampleProblems);
        console.log('Database seeded!');
    } catch (err) {
        console.error('Seeding error:', err);
    } finally {
        mongoose.connection.close();
        console.log('MongoDB connection closed.');
    }
};

seedDB();