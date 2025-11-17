import 'dotenv/config';
import mongoose from 'mongoose';
import Problem from './models/Problem.mjs'; // Import the official model
import dotenv from 'dotenv';
dotenv.config({ path: 'assessment-api/.env' });

const dbURI = process.env.MONGO_URI;

const sampleProblems = [
    {
        title: 'Two Sum',
        description: 'Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.',
        difficulty: 'Easy',
        tags: ['Array', 'Hash Table'],
        isPremium: false,
        testCases: [
            {
                input: [[2, 7, 11, 15], 9],
                expectedOutput: [0, 1],
                isHidden: false
            },
            {
                input: [[3, 2, 4], 6],
                expectedOutput: [1, 2],
                isHidden: false
            }
        ],
        functionDefinitions: {
            javascript: {
                name: 'twoSum',
                template: 'function twoSum(nums, target) {\n  // your code here\n}'
            },
            python: {
                name: 'two_sum',
                template: 'def two_sum(nums, target):\n    pass'
            }
        },
        expectedIoType: {
            inputParameters: [
                { name: 'nums', type: 'number[]' },
                { name: 'target', type: 'number' }
            ],
            outputType: 'number[]'
        }
    },
    {
        title: 'Add Two Numbers',
        description: 'Given two numbers, return their sum.',
        difficulty: 'Easy',
        tags: ['Math'],
        isPremium: false,
        testCases: [
            {
                input: [1, 2],
                expectedOutput: 3,
                isHidden: false
            },
            {
                input: [10, 20],
                expectedOutput: 30,
                isHidden: false
            }
        ],
        functionDefinitions: {
            javascript: {
                name: 'addTwoNumbers',
                template: 'function addTwoNumbers(num1, num2) {\n  // your code here\n}'
            },
            python: {
                name: 'add_two_numbers',
                template: 'def add_two_numbers(num1, num2):\n    pass'
            }
        },
        expectedIoType: {
            inputParameters: [
                { name: 'num1', type: 'number' },
                { name: 'num2', type: 'number' }
            ],
            outputType: 'number'
        }
    },
    {
        title: 'Valid Palindrome',
        description: 'Given a string `s`, return `true` if it is a palindrome, or `false` otherwise.',
        difficulty: 'Easy',
        tags: ['String', 'Two Pointers'],
        isPremium: false,
        testCases: [
            {
                input: ['A man, a plan, a canal: Panama'],
                expectedOutput: true,
                isHidden: false
            },
            {
                input: ['race a car'],
                expectedOutput: false,
                isHidden: false
            }
        ],
        functionDefinitions: {
            javascript: {
                name: 'isPalindrome',
                template: 'function isPalindrome(s) {\n  // your code here\n}'
            },
            python: {
                name: 'is_palindrome',
                template: 'def is_palindrome(s):\n    pass'
            }
        },
        expectedIoType: {
            inputParameters: [
                { name: 's', type: 'string' }
            ],
            outputType: 'boolean'
        }
    },
    {
        title: 'Sum of Even Numbers',
        description: 'Write a function that takes an array of integers and returns the sum of its even numbers.',
        difficulty: 'Easy',
        tags: ['Array', 'Math'],
        isPremium: false,
        testCases: [
            {
                input: [[1, 2, 3, 4, 5, 6]],
                expectedOutput: 12,
                isHidden: false
            },
            {
                input: [[1, 3, 5, 7]],
                expectedOutput: 0,
                isHidden: false
            },
            {
                input: [[-2, -3, -4, 5]],
                expectedOutput: -6,
                isHidden: false
            },
            {
                input: [[0, 2, 4, 6, 8]],
                expectedOutput: 20,
                isHidden: false
            }
        ],
        functionDefinitions: {
            java: {
                name: 'sumOfEvenNumbers',
                template: 'public class Solution {\n    public static int sumOfEvenNumbers(int[] nums) {\n        // your code here\n    }\n}'
            }
        },
        expectedIoType: {
            inputParameters: [
                { name: 'nums', type: 'int[]' }
            ],
            outputType: 'int'
        }
    }
];

const seedDB = async () => {
    try {
        await mongoose.connect(dbURI, { dbName: 'assessment_db' });
        console.log('MongoDB connected for seeding...');
        // Drop the collection to remove all documents and indexes
        await mongoose.connection.db.dropCollection('problems').catch(err => {
            if (err.code === 26) { // 26 is the error code for "ns not found" (collection doesn't exist)
                console.log('Collection "problems" not found, skipping drop.');
            } else {
                throw err;
            }
        });
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