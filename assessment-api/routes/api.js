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

// @route   GET /api/problems/:id
// @desc    Get a problem by ID
router.get('/problems/:id', async (req, res) => {
    try {
        const problem = await Problem.findById(req.params.id);
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
        // Accept both legacy shape (testCases[].input / expectedOutput) and new shape (inputRaw / expectedOutputRaw)
        const payload = { ...req.body };
        if (Array.isArray(payload.testCases)) {
            payload.testCases = payload.testCases.map((tc, idx) => {
                const out = { ...tc };
                // map new fields to legacy DB schema
                if (tc.inputRaw !== undefined && tc.input === undefined) out.input = tryParseMaybeJSON(tc.inputRaw);
                if (tc.expectedOutputRaw !== undefined && tc.expectedOutput === undefined) out.expectedOutput = tryParseMaybeJSON(tc.expectedOutputRaw);
                // ensure id/type/isHidden defaults
                if (out.id === undefined) out.id = tc.id || idx + 1;
                if (out.type === undefined) out.type = tc.type || 'sample';
                if (out.isHidden === undefined) out.isHidden = !!tc.isHidden;
                return out;
            });
        }

        // Server-side validation: ensure each test case has input and expectedOutput after mapping
        const validationErrors = [];
        if (Array.isArray(payload.testCases)) {
            payload.testCases.forEach((tc, i) => {
                if (tc.input === undefined || tc.input === null || tc.input === '') {
                    validationErrors.push(`testCases[${i}].input is required`);
                }
                if (tc.expectedOutput === undefined || tc.expectedOutput === null || tc.expectedOutput === '') {
                    validationErrors.push(`testCases[${i}].expectedOutput is required`);
                }
            });
        }

        // Ensure there's at least one function name provided for some language
        const fnMap = payload.functionName || {};
        const hasFn = Object.keys(fnMap).some(k => fnMap[k] && fnMap[k].toString().trim() !== '');
        if (!hasFn) {
            validationErrors.push('At least one functionName (per-language) must be provided');
        }

        if (validationErrors.length > 0) {
            return res.status(400).json({ msg: 'Validation failed', errors: validationErrors });
        }

        // Ensure maps exist for functionSignatures and functionName (Mongoose expects Map)
        if (!payload.functionSignatures) payload.functionSignatures = {};
        if (!payload.functionName) payload.functionName = {};

        const newProblem = new Problem(payload);
        const problem = await newProblem.save();
        res.status(201).json({ message: 'Problem created successfully', problem: problem });
    } catch (err) {
        console.error('Error creating problem:', err);
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
            java: 'java_wrapper.tpl'
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

        // Build parsed tests using the same rules as the Go wrapper: named lines, positional, JSON, scalar coercion
        function coerceScalar(s) {
            s = String(s).trim();
            if (s === '') return '';
            if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
            if (!isNaN(Number(s)) && s.indexOf(' ') === -1) {
                // integer or float
                const n = Number(s);
                return Number.isInteger(n) ? parseInt(s, 10) : n;
            }
            // quoted string
            if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
                return s.slice(1, -1);
            }
            return s;
        }

        function tryParseJSON(s) {
            try {
                return JSON.parse(s);
            } catch (e) {
                return null;
            }
        }

        function parseInputRaw(raw, expectedIoType) {
            const out = {};
            if (!raw) return out;
            const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            let namedFound = false;
            for (const line of lines) {
                if (line.includes('=')) {
                    namedFound = true;
                    const [left, right] = line.split(/=(.+)/).map(s => s.trim());
                    const parsed = tryParseJSON(right);
                    out[left] = parsed === null ? coerceScalar(right) : parsed;
                }
            }
            if (namedFound) return out;

            // positional
            if (expectedIoType && Array.isArray(expectedIoType.inputParameters) && expectedIoType.inputParameters.length > 0) {
                for (let i = 0; i < expectedIoType.inputParameters.length && i < lines.length; i++) {
                    const s = lines[i];
                    const parsed = tryParseJSON(s);
                    out[expectedIoType.inputParameters[i].name] = parsed === null ? coerceScalar(s) : parsed;
                }
                return out;
            }

            // try full JSON
            const whole = tryParseJSON(raw);
            if (whole !== null) {
                out['input'] = whole;
                return out;
            }

            // fallback
            out['input'] = raw;
            return out;
        }

        const tests = (problem.testCases || []).map((tc, idx) => {
            const parsed = parseInputRaw(tc.inputRaw || tc.input || '', problem.expectedIoType || {});
            const expected = tryParseJSON(tc.expectedOutputRaw || tc.expectedOutput) ?? coerceScalar(tc.expectedOutputRaw || tc.expectedOutput);
            return { id: (tc.id || idx + 1), input: parsed, expectedOutput: expected, isHidden: !!tc.isHidden };
        });

        // Replace placeholders in template with serialized tests and a placeholder function name
        const testsJSON = JSON.stringify(tests);
        tpl = tpl.replace(/{{TESTS_JSON}}/g, testsJSON);
        tpl = tpl.replace(/{{FUNCTION_NAME}}/g, (problem.functionName && problem.functionName[language]) || 'solution');
        tpl = tpl.replace(/{{CLASS_NAME}}/g, (problem.functionName && problem.functionName[language]) || 'Main');

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

        const messageBody = {
            schemaVersion: 'v1',
            submissionId: submission._id.toString(),
            problemId: problem._id.toString(),
            language,
            code,
            tests: problem.testCases, // Include test cases
            // functionName: problem.functionName.get(language) // Include function name for the specific language
        };

        // Lightweight runtime validation to ensure message conforms to expected contract
        function validateSubmissionMessage(msg) {
            if (!msg || typeof msg !== 'object') return false;
            if (!msg.submissionId || !msg.problemId || !msg.language || !msg.code) return false;
            if (msg.tests && !Array.isArray(msg.tests)) return false;
            if (Array.isArray(msg.tests)) {
                for (const t of msg.tests) {
                    if (typeof t !== 'object') return false;
                    if (!(t.id !== undefined)) return false;
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

// @route   GET /api/submissions/:id
// @desc    Get submission status and result
router.get('/submissions/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Check Redis cache first
        const cachedResult = await redisClient.get(`submission:${id}`);
        if (cachedResult) {
            console.log(`Cache hit for submission: ${id}`);
            console.log('Cached result:', cachedResult);
            console.log('Returning cached result for submission:', id);
            console.log('Parsed cached result:', JSON.parse(cachedResult));
            return res.json(JSON.parse(cachedResult));
        }

        // 2. If not in cache, get from MongoDB
        console.log(`Cache miss for submission: ${id}. Checking DB.`);
        const submission = await Submission.findById(id);
        console.log('Submission fetched from DB:', submission);
        if (!submission) {
            return res.status(404).json({ msg: 'Submission not found' });
        }

        console.log('Submission status:', submission.status);
        // Optional: Cache the result if it's final (Success/Fail)
        if (submission.status === 'Success' || submission.status === 'Fail') {
            await redisClient.set(`submission:${id}`, JSON.stringify(submission), { EX: 3600 }); // Cache for 1 hour
        }
        // console.log('Submission fetched from DB:', submission);
        res.json(submission);

    } catch (err) {
        console.error('Get Submission Error:', err);
        res.status(500).send('Server Error');
    }
});

export default router;