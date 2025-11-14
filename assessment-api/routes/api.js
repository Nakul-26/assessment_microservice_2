import express from 'express';
import amqp from 'amqplib';
import { createClient } from 'redis';

import Problem from '../models/Problem.mjs';
import Submission from '../models/Submission.mjs';
import { validate } from '../middleware/validator.mjs';

const router = express.Router();

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://localhost';
const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';
const QUEUE_NAME = 'submission_queue';

// Redis client
const redisClient = createClient({ url: REDIS_URI });
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect().then(() => {
    console.log('Connected to Redis');
}).catch(err => {
    console.error('Redis connection error:', err);
});

// @route   GET /api/problems
// @desc    Get all problems
router.get('/problems', async (req, res) => {
    try {
        const problems = await Problem.find().select('-testCases');
        res.json(problems);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/problems/:_id
// @desc    Get a problem by ID
router.get('/problems/:_id', async (req, res) => {
    try {
        const problem = await Problem.findById(req.params._id);
        if (!problem) {
            return res.status(404).json({ msg: 'Problem not found' });
        }
        res.json(problem);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/problems
// @desc    Create a new problem
router.post('/problems', validate('problem'), async (req, res) => {
    try {
        const payload = { ...req.body };

        // Server-side validation
        const validationErrors = [];
        if (Array.isArray(payload.testCases)) {
            payload.testCases.forEach((tc, i) => {
                if (tc.input === undefined || tc.input === null) {
                    validationErrors.push(`testCases[${i}].input is required`);
                }
                if (tc.expectedOutput === undefined || tc.expectedOutput === null) {
                    validationErrors.push(`testCases[${i}].expectedOutput is required`);
                }
            });
        }

        // Ensure there's at least one function definition provided for some language
        const fnDefs = payload.functionDefinitions || {};
        const hasFn = Object.keys(fnDefs).some(k => fnDefs[k] && fnDefs[k].name && fnDefs[k].template);
        if (!hasFn) {
            validationErrors.push('At least one function definition (name and template) must be provided for a language.');
        }

        if (validationErrors.length > 0) {
            return res.status(400).json({ msg: 'Validation failed', errors: validationErrors });
        }

        const newProblem = new Problem(payload);
        const problem = await newProblem.save();
        res.status(201).json({ message: 'Problem created successfully', problem: problem });
    } catch (err) {
        console.error('Error creating problem:', err);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/problems/:_id
// @desc    Delete a problem by ID
router.delete('/problems/:_id', async (req, res) => {
    try {
        const problem = await Problem.findByIdAndDelete(req.params._id);
        if (!problem) {
            return res.status(404).json({ msg: 'Problem not found' });
        }
        res.json({ msg: 'Problem removed' });
    } catch (err) {
        console.error('Error deleting problem:', err);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/problems/:_id
// @desc    Update a problem by ID
router.put('/problems/:_id', validate('problem'), async (req, res) => {
    try {
        const { _id } = req.params;
        const payload = { ...req.body };

        // Server-side validation
        const validationErrors = [];
        if (Array.isArray(payload.testCases)) {
            payload.testCases.forEach((tc, i) => {
                if (tc.input === undefined || tc.input === null) {
                    validationErrors.push(`testCases[${i}].input is required`);
                }
                if (tc.expectedOutput === undefined || tc.expectedOutput === null) {
                    validationErrors.push(`testCases[${i}].expectedOutput is required`);
                }
            });
        }

        // Ensure there's at least one function definition provided for some language
        const fnDefs = payload.functionDefinitions || {};
        const hasFn = Object.keys(fnDefs).some(k => fnDefs[k] && fnDefs[k].name && fnDefs[k].template);
        if (!hasFn) {
            validationErrors.push('At least one function definition (name and template) must be provided for a language.');
        }

        if (validationErrors.length > 0) {
            return res.status(400).json({ msg: 'Validation failed', errors: validationErrors });
        }

        const updatedProblem = await Problem.findByIdAndUpdate(_id, payload, { new: true, runValidators: true });

        if (!updatedProblem) {
            return res.status(404).json({ msg: 'Problem not found' });
        }
        res.json({ message: 'Problem updated successfully', problem: updatedProblem });
    } catch (err) {
        console.error('Error updating problem:', err);
        res.status(500).send('Server Error');
    }
});

// small helper: if string looks like JSON parse it, otherwise return the raw string/number
function tryParseMaybeJSON(s) {
    if (s === undefined) return s;
    if (typeof s !== 'string') return s;
    try {
        return JSON.parse(s);
    } catch (e) {
        // coerce numbers
        if (!isNaN(Number(s))) return Number(s);
        if (s === 'true') return true;
        if (s === 'false') return false;
        return s;
    }
}

// @route   POST /api/problems/preview
// @desc    Preview wrapper + parsed tests for a problem payload and language
router.post('/problems/preview', async (req, res) => {
    try {
        const { problem, language } = req.body;
        if (!problem || !language) return res.status(400).json({ msg: 'Missing problem or language in request' });

        // Read the wrapper template for the requested language from judge-service-go templates
        const tplPath = new URL('.', import.meta.url).pathname + '../../judge-service-go/pkg/wrappers/';
        const langTplFile = {
            javascript: 'js_wrapper.tpl',
            python: 'python_wrapper.tpl',
            java: 'java_wrapper.tpl',
            c: 'c_wrapper.tpl',
            csharp: 'csharp_wrapper.tpl'
        }[language] || 'js_wrapper.tpl';

        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.default.join(process.cwd(), 'judge-service-go', 'pkg', 'wrappers', langTplFile);
        let tpl = '';
        try {
            tpl = fs.default.readFileSync(filePath, 'utf8');
        } catch (err) {
            // If the judge-service templates aren't available in this container, fall back to a minimal preview template
            console.warn('Failed to read template for preview, using fallback template:', err.message);
            if (language === 'python') {
                tpl = '# wrapper preview for python\n# TESTS: {{TESTS_JSON}}\n# FUNCTION: {{FUNCTION_NAME}}\n# USER_CODE_MARKER';
            } else if (language === 'java') {
                tpl = '// wrapper preview for java\n// TESTS: {{TESTS_JSON}}\n// FUNCTION: {{FUNCTION_NAME}}\n// CLASS: {{CLASS_NAME}}\n// USER_CODE_MARKER';
            } else {
                tpl = '// wrapper preview for js\n// TESTS: {{TESTS_JSON}}\n// FUNCTION: {{FUNCTION_NAME}}\n// USER_CODE_MARKER';
            }
        }

        const tests = (problem.testCases || []).map((tc, idx) => {
            return { input: tc.input, expectedOutput: tc.expectedOutput, isHidden: !!tc.isHidden };
        });

        // Replace placeholders in template with serialized tests and a placeholder function name
        const testsJSON = JSON.stringify(tests);
        const functionName = (problem.functionDefinitions && problem.functionDefinitions[language] && problem.functionDefinitions[language].name) || 'solution';
        tpl = tpl.replace(/{{TESTS_JSON}}/g, testsJSON);
        tpl = tpl.replace(/{{FUNCTION_NAME}}/g, functionName);
        tpl = tpl.replace(/{{CLASS_NAME}}/g, functionName);

        return res.json({ wrapper: tpl, tests: tests });
    } catch (err) {
        console.error('Preview error:', err);
        res.status(500).json({ msg: 'Preview failed' });
    }
});

// @route   POST /api/submit
// @desc    Submit code for a problem asynchronously
router.post('/submit', validate('submission'), async (req, res) => {
    const { problemId, code, language } = req.body;
    console.log(`Received submission for problem ID: ${problemId}`);
    console.log(`Code length: ${code.length} characters`);
    console.log(`Language: ${language}`);
    console.log(`Request bode:`, req.body);

    try {
        // 1. Create submission with "Pending" status
        const submission = new Submission({
            problemId,
            code,
            language,
            status: 'Pending'
        });
        await submission.save();

        // Fetch the problem to get test cases
        const problem = await Problem.findById(problemId);
        console.log(`Fetched problem for submission ID ${submission._id}:`, problem);
        if (!problem) {
            return res.status(404).json({ msg: 'Problem not found' });
        }

        // 2. Publish submission details to RabbitMQ
        const connection = await amqp.connect(RABBITMQ_URI);
        const channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });

        const tests = problem.testCases.map(tc => ({
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            isHidden: tc.isHidden
        }));

        const functionName = problem.functionDefinitions.get(language)?.name || 'solution';

        const messageBody = {
            schemaVersion: 'v2', // New version
            submissionId: submission._id.toString(),
            problemId: problem._id.toString(),
            language,
            code,
            tests: tests,
            functionName: functionName
        };

        // Lightweight runtime validation to ensure message conforms to expected contract
        function validateSubmissionMessage(msg) {
            if (!msg || typeof msg !== 'object') return false;
            if (!msg.submissionId || !msg.problemId || !msg.language || !msg.code || !msg.functionName) return false;
            if (msg.tests && !Array.isArray(msg.tests)) return false;
            if (Array.isArray(msg.tests)) {
                for (const t of msg.tests) {
                    if (typeof t !== 'object') return false;
                    if (!('input' in t) || !('expectedOutput' in t)) return false;
                }
            }
            return true;
        }

        if (!validateSubmissionMessage(messageBody)) {
            console.error('Submission message failed validation, not publishing:', messageBody);
            await channel.close();
            await connection.close();
            return res.status(500).json({ msg: 'Internal server error: invalid submission message' });
        }

        channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(messageBody)), { persistent: true });

        console.log(`Sent submission ID ${submission._id} to queue.`);
        await channel.close();
        await connection.close();

        // 3. Respond to user immediately
        res.status(202).json(submission);

    } catch (err) {
        console.error('Submit Error:', err);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/submissions/:_id
// @desc    Get submission status and result
router.get('/submissions/:_id', async (req, res) => {
    const { _id } = req.params;

    try {
        // 1. Check Redis cache first
        const cachedResult = await redisClient.get(`submission:${_id}`);
        if (cachedResult) {
            console.log(`Cache hit for submission: ${_id}`);
            console.log('Cached result:', cachedResult);
            console.log('Returning cached result for submission:', _id);
            console.log('Parsed cached result:', JSON.parse(cachedResult));
            return res.json(JSON.parse(cachedResult));
        }

        // 2. If not in cache, get from MongoDB
        console.log(`Cache miss for submission: ${_id}. Checking DB.`);
        const submission = await Submission.findById(_id);
        console.log('Submission fetched from DB:', submission);
        if (!submission) {
            return res.status(404).json({ msg: 'Submission not found' });
        }

        console.log('Submission status:', submission.status);
        // Optional: Cache the result if it's final (Success/Fail)
        if (submission.status === 'Success' || submission.status === 'Fail') {
            await redisClient.set(`submission:${_id}`, JSON.stringify(submission), { EX: 3600 }); // Cache for 1 hour
        }
        // console.log('Submission fetched from DB:', submission);
        res.json(submission);

    } catch (err) {
        console.error('Get Submission Error:', err);
        res.status(500).send('Server Error');
    }
});

export default router;