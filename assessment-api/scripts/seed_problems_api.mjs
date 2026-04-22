import mongoose from "mongoose";
import Problem from "../models/Problem.mjs";

const MONGO_URI = process.env.MONGO_URI || "mongodb://mongo:27017/assessment_db";
const DB_NAME = process.env.MONGO_DB_NAME || "assessment_db";

const PROBLEMS = [
  {
    title: "Two Sum",
    description:
      "Return the indices of the two numbers such that they add up to the target. Assume exactly one valid answer exists.",
    difficulty: "Easy",
    functionName: "twoSum",
    parameters: [
      { name: "nums", type: "array<number>" },
      { name: "target", type: "number" }
    ],
    returnType: "array<number>",
    compareConfig: {
      mode: "EXACT",
      floatTolerance: 0,
      orderInsensitive: false
    },
    testCases: [
      {
        inputs: [[2, 7, 11, 15], 9],
        expected: [0, 1],
        isSample: true,
        isHidden: false
      },
      {
        inputs: [[3, 2, 4], 6],
        expected: [1, 2],
        isSample: true,
        isHidden: false
      },
      {
        inputs: [[3, 3], 6],
        expected: [0, 1],
        isSample: false,
        isHidden: true
      }
    ],
    tags: ["array", "hash-map"],
    isPremium: false
  },
  {
    title: "Valid Palindrome",
    description:
      "Return true if the input string is a palindrome after converting to lowercase and removing non-alphanumeric characters.",
    difficulty: "Easy",
    functionName: "isPalindrome",
    parameters: [
      { name: "s", type: "string" }
    ],
    returnType: "boolean",
    compareConfig: {
      mode: "EXACT",
      floatTolerance: 0,
      orderInsensitive: false
    },
    testCases: [
      {
        inputs: ["A man, a plan, a canal: Panama"],
        expected: true,
        isSample: true,
        isHidden: false
      },
      {
        inputs: ["race a car"],
        expected: false,
        isSample: true,
        isHidden: false
      },
      {
        inputs: [" "],
        expected: true,
        isSample: false,
        isHidden: true
      }
    ],
    tags: ["string", "two-pointers"],
    isPremium: false
  },
  {
    title: "Kth Largest Element",
    description: "Return the kth largest element in the array. k is 1-based.",
    difficulty: "Medium",
    functionName: "findKthLargest",
    parameters: [
      { name: "nums", type: "array<number>" },
      { name: "k", type: "number" }
    ],
    returnType: "number",
    compareConfig: {
      mode: "EXACT",
      floatTolerance: 0,
      orderInsensitive: false
    },
    testCases: [
      {
        inputs: [[3, 2, 1, 5, 6, 4], 2],
        expected: 5,
        isSample: true,
        isHidden: false
      },
      {
        inputs: [[3, 2, 3, 1, 2, 4, 5, 5, 6], 4],
        expected: 4,
        isSample: true,
        isHidden: false
      },
      {
        inputs: [[7, 10, 4, 3, 20, 15], 3],
        expected: 10,
        isSample: false,
        isHidden: true
      }
    ],
    tags: ["array", "heap", "selection"],
    isPremium: false
  },
  {
    title: "Longest Common Prefix",
    description: "Return the longest common prefix string amongst an array of strings.",
    difficulty: "Easy",
    functionName: "longestCommonPrefix",
    parameters: [
      { name: "strs", type: "array<string>" }
    ],
    returnType: "string",
    compareConfig: {
      mode: "EXACT",
      floatTolerance: 0,
      orderInsensitive: false
    },
    testCases: [
      {
        inputs: [["flower", "flow", "flight"]],
        expected: "fl",
        isSample: true,
        isHidden: false
      },
      {
        inputs: [["dog", "racecar", "car"]],
        expected: "",
        isSample: true,
        isHidden: false
      },
      {
        inputs: [["interview", "internet", "internal"]],
        expected: "inter",
        isSample: false,
        isHidden: true
      }
    ],
    tags: ["string"],
    isPremium: false
  }
];

async function seedProblems() {
  await mongoose.connect(MONGO_URI, {
    dbName: DB_NAME,
    serverSelectionTimeoutMS: 20000
  });

  console.log(`Connected to MongoDB: ${MONGO_URI}`);

  let created = 0;
  let updated = 0;

  for (const payload of PROBLEMS) {
    const existing = await Problem.findOne({ title: payload.title }).select("_id");
    if (existing) {
      await Problem.updateOne({ _id: existing._id }, { $set: payload }, { runValidators: true });
      updated += 1;
      console.log(`Updated: ${payload.title}`);
      continue;
    }

    await Problem.create(payload);
    created += 1;
    console.log(`Created: ${payload.title}`);
  }

  const total = await Problem.countDocuments();
  console.log(`Seed complete. Created=${created} Updated=${updated} Total=${total}`);
}

seedProblems()
  .catch((err) => {
    console.error("Problem seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
