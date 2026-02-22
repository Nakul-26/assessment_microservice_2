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
    },
    {
        title: 'Kth Largest Element',
        description: 'Given an array of integers and an integer k, return the k-th largest element (1-based).',
        difficulty: 'Medium',
        tags: ['Array', 'Sorting', 'Heap'],
        isPremium: false,
        testCases: [
            {
                input: [[3, 2, 1, 5, 6, 4], 2],
                expectedOutput: 5,
                isHidden: false
            },
            {
                input: [[3, 2, 3, 1, 2, 4, 5, 5, 6], 4],
                expectedOutput: 4,
                isHidden: false
            },
            {
                input: [[1], 1],
                expectedOutput: 1,
                isHidden: false
            }
        ],
        functionDefinitions: {
            javascript: {
                name: 'kthLargest',
                template: 'function kthLargest(nums, k) {\n  // your code here\n}'
            },
            python: {
                name: 'kth_largest',
                template: 'def kth_largest(nums, k):\n    pass'
            }
        },
        expectedIoType: {
            inputParameters: [
                { name: 'nums', type: 'number[]' },
                { name: 'k', type: 'number' }
            ],
            outputType: 'number'
        }
    },
    {
        title: 'Longest Common Prefix',
        description: 'Given an array of strings, return the longest common prefix among them.',
        difficulty: 'Hard',
        tags: ['String', 'Prefix'],
        isPremium: false,
        testCases: [
            {
                input: [['flower', 'flow', 'flight']],
                expectedOutput: 'fl',
                isHidden: false
            },
            {
                input: [['dog', 'racecar', 'car']],
                expectedOutput: '',
                isHidden: false
            },
            {
                input: [['interview', 'internet', 'internal']],
                expectedOutput: 'inter',
                isHidden: false
            }
        ],
        functionDefinitions: {
            javascript: {
                name: 'longestCommonPrefix',
                template: 'function longestCommonPrefix(strs) {\n  // your code here\n}'
            },
            python: {
                name: 'longest_common_prefix',
                template: 'def longest_common_prefix(strs):\n    pass'
            }
        },
        expectedIoType: {
            inputParameters: [
                { name: 'strs', type: 'string[]' }
            ],
            outputType: 'string'
        }
    }
];

const seedDB = async () => {
    try {
        await mongoose.connect(dbURI, { dbName: 'assessment_db' });
        console.log('MongoDB connected for seeding...');
        const bulkOps = sampleProblems.map(problem => ({
            updateOne: {
                filter: { title: problem.title },
                update: { $set: problem },
                upsert: true
            }
        }));
        const result = await Problem.bulkWrite(bulkOps, { ordered: false });
        console.log('Database seeded (upsert):', {
            inserted: result.upsertedCount,
            modified: result.modifiedCount,
            matched: result.matchedCount
        });
    } catch (err) {
        console.error('Seeding error:', err);
    } finally {
        mongoose.connection.close();
        console.log('MongoDB connection closed.');
    }
};

seedDB();
