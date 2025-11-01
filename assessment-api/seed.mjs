import 'dotenv/config';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: 'assessment-api/.env' });

const dbURI = process.env.MONGO_URI;

const { Schema } = mongoose;

const ProblemSchema = new Schema({
    id: {
        type: Number,
        required: true,
        unique: true
    },
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
            id: {
                type: Number,
                required: true
            },
            type: {
                type: String,
                required: true
            },
            input: {
                type: Schema.Types.Mixed,
                required: true
            },
            expectedOutput: {
                type: Schema.Types.Mixed,
                required: true
            },
            meta: {
                types: [String],
                returns: String
            },
            isHidden: {
                type: Boolean,
                default: false
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
        id: 1,
        title: 'Two Sum',
        description: 'Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.',
        difficulty: 'Easy',
        testCases: [
            {
                id: 1,
                type: 'sample',
                input: JSON.stringify([[2, 7, 11, 15], 9]),
                expectedOutput: JSON.stringify([0, 1])
            },
            {
                id: 2,
                type: 'sample',
                input: JSON.stringify([[3, 2, 4], 6]),
                expectedOutput: JSON.stringify([1, 2])
            }
        ],
        functionSignatures: {
            javascript: `function twoSum(nums, target) {\n  // Write your code here\n}`,
            python: `def two_sum(nums, target):\n  # Write your code here`,
            java: `class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        // Write your code here\n    }\n}`,
            cpp: `vector<int> twoSum(vector<int>& nums, int target) {\n    // Write your code here\n}`
        },
        functionName: {
            javascript: "twoSum",
            python: "two_sum",
            java: "twoSum",
            cpp: "twoSum"
        }
    },
    {
        id: 2,
        title: 'Add Two Numbers',
        description: 'Given two numbers, return their sum.',
        difficulty: 'Easy',
        testCases: [
            {
                id: 1,
                type: 'sample',
                input: JSON.stringify([1, 2]),
                expectedOutput: JSON.stringify(3)
            },
            {
                id: 2,
                type: 'sample',
                input: JSON.stringify([10, 20]),
                expectedOutput: JSON.stringify(30)
            }
        ],
        functionSignatures: {
            javascript: `function addTwoNumbers(num1, num2) {\n  // Write your code here\n}`,
            python: `def add_two_numbers(num1, num2):\n  # Write your code here`,
            java: `class Solution {\n    public int addTwoNumbers(int num1, int num2) {\n        // Write your code here\n    }\n}`,
            cpp: `int addTwoNumbers(int num1, int num2) {\n    // Write your code here\n}`
        },
        functionName: {
            javascript: "addTwoNumbers",
            python: "add_two_numbers",
            java: "addTwoNumbers",
            cpp: "addTwoNumbers"
        }
    },
    {
        id: 3,
        title: 'Greeter',
        description: 'Write a function that takes a name and returns a greeting.',
        difficulty: 'Easy',
        testCases: [
            {
                id: 1,
                type: 'sample',
                input: JSON.stringify({ name: "World" }),
                expectedOutput: JSON.stringify("Hello, World!")
            }
        ],
        functionSignatures: {
            javascript: `function greet(name) {\n  // Write your code here\n}`,
            python: `def greet(name):\n  # Write your code here`,
            java: `class Solution {\n    public String greet(String name) {\n        // Write your code here\n    }\n}`,
            cpp: `string greet(string name) {\n    // Write your code here\n}`
        },
        functionName: {
            javascript: "greet",
            python: "greet",
            java: "greet",
            cpp: "greet"
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