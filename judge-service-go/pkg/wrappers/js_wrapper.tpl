const { performance } = require('perf_hooks');
const COMPARE_MODE = "{{COMPARE_MODE}}"; // STRUCTURAL, STRICT, APPROX, ORDER_INSENSITIVE, TEXT
const { {{FUNCTION_NAME}} } = require('./submission.js');

// Helper to capture stdout/stderr for a specific (possibly async) function call
async function captureStreamsAsync(func) {
    const oldStdoutWrite = process.stdout.write;
    const oldStderrWrite = process.stderr.write;

    let stdout = '';
    let stderr = '';

    // wrapper that mimics the original signature (chunk, encoding, cb)
    function makeWriteWrapper(original, accumulator) {
        return function (chunk, encoding, callback) {
            try {
                // chunk may be Buffer or string
                accumulator += chunk && chunk.toString ? chunk.toString() : String(chunk);
            } catch (e) {
                // ignore
            }
            // forward to original so internals still work
            try {
                return original.apply(this, arguments);
            } catch (e) {
                // some environments may not want forwarding; ignore
                return true;
            }
        };
    }

    process.stdout.write = makeWriteWrapper(oldStdoutWrite, stdout);
    process.stderr.write = makeWriteWrapper(oldStderrWrite, stderr);

    // But we can't update the closed-over stdout/stderr used above; use closures that push to variables:
    // Replace with more robust approach:
    stdout = '';
    stderr = '';
    process.stdout.write = function (chunk, encoding, callback) {
        stdout += (chunk && chunk.toString) ? chunk.toString() : String(chunk);
        return oldStdoutWrite.apply(process.stdout, arguments);
    };
    process.stderr.write = function (chunk, encoding, callback) {
        stderr += (chunk && chunk.toString) ? chunk.toString() : String(chunk);
        return oldStderrWrite.apply(process.stderr, arguments);
    };

    try {
        const result = await func(); // await promises as needed
        return { result, stdout, stderr };
    } finally {
        // restore originals no matter what
        process.stdout.write = oldStdoutWrite;
        process.stderr.write = oldStderrWrite;
    }
}

function normalize(value, visited = new Set(), depth = 0) {
    const maxDepth = 1000; // prevent infinite loops

    if (depth > maxDepth) {
        return '[Max Depth Exceeded]';
    }

    if (value === null || typeof value !== 'object') return value;

    if (visited.has(value)) return '[Circular]';
    visited.add(value);

    try {
        if (value && typeof value === 'object' && 'val' in value && 'next' in value) {
            const nodes = [];
            let curr = value;
            let currentDepth = 0;
            while (curr && currentDepth < maxDepth) {
                // check safely for val property
                nodes.push(curr.val);
                curr = curr.next;
                currentDepth++;
            }
            return { __type: 'LinkedList', values: nodes };
        }

        if (value && typeof value === 'object' && 'val' in value && ('left' in value || 'right' in value)) {
            return {
                __type: 'TreeNode',
                val: value.val,
                left: normalize(value.left, visited, depth + 1),
                right: normalize(value.right, visited, depth + 1),
            };
        }

        if (Array.isArray(value)) {
            return value.map(v => normalize(v, visited, depth + 1));
        }

        const obj = {};
        const keys = Object.keys(value).sort();
        for (const key of keys) {
            obj[key] = normalize(value[key], visited, depth + 1);
        }
        return obj;
    } finally {
        // remove from visited to avoid false-circular on sibling branches
        visited.delete(value);
    }
}

function normalizeText(value) {
    if (typeof value !== 'string') {
        value = String(value);
    }
    return value.trim().replace(/\s+/g, ' ');
}

function deepEqual(a, b, epsilon = 1e-6) {
    switch (COMPARE_MODE) {
        case 'STRICT':
            return a === b;
        case 'APPROX':
            if (typeof a !== 'number' || typeof b !== 'number') return false;
            return Math.abs(a - b) < epsilon * Math.max(1, Math.abs(a), Math.abs(b));
        case 'TEXT':
            return normalizeText(a) === normalizeText(b);
        case 'ORDER_INSENSITIVE':
            if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
                return false;
            }
            const sortedA = [...a].sort();
            const sortedB = [...b].sort();
            return _structuralDeepEqual(sortedA, sortedB, epsilon); // Use structural equal for sorted arrays
        default:
            return _structuralDeepEqual(a, b, epsilon);
    }
}

function _structuralDeepEqual(a, b, epsilon) {
    if (a === b) return true;

    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        if (typeof a === 'number' && typeof b === 'number') {
            return Math.abs(a - b) < epsilon * Math.max(1, Math.abs(a), Math.abs(b));
        }
        return a === b;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!_structuralDeepEqual(a[i], b[i], epsilon)) return false;
        }
        return true;
    }

    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();

    if (keysA.length !== keysB.length) return false;

    for (let i = 0; i < keysA.length; i++) {
        const key = keysA[i];
        if (keysB[i] !== key || !_structuralDeepEqual(a[key], b[key], epsilon)) {
            return false;
        }
    }

    return true;
}

function safeStringify(obj, maxLen = 2000) {
    const cache = new Set();
    try {
        const s = JSON.stringify(obj, (key, value) => {
            if (typeof value === 'object' && value !== null) {
                if (cache.has(value)) {
                    return '[Circular]';
                }
                cache.add(value);
            }
            if (typeof value === 'bigint') {
                return value.toString();
            }
            return value;
        }, 2);
        if (s && s.length > maxLen) {
            return s.slice(0, maxLen) + '…(truncated)';
        }
        return s;
    } catch (e) {
        // fallback
        try { return String(obj).slice(0, maxLen); } catch (_) { return '[Unserializable]'; }
    }
}

function diffSummary(actual, expected) {
    if (Array.isArray(actual) && Array.isArray(expected)) {
        if (actual.length !== expected.length) {
            return `Array length mismatch: expected ${expected.length}, got ${actual.length}`;
        }
        for (let i = 0; i < actual.length; i++) {
            if (!deepEqual(actual[i], expected[i])) {
                return `Mismatch at index ${i}: expected ${safeStringify(expected[i])}, got ${safeStringify(actual[i])}`;
            }
        }
    }
    return `Values differ: expected ${safeStringify(expected)}, got ${safeStringify(actual)}`;
}

// Ensure truncation returns a string
function truncateOutput(obj, maxLen = 2000) {
    return safeStringify(obj, maxLen);
}

// --- IMPORTANT: the generator should insert raw JSON here (no quotes) ---
// e.g. const testCases = [{"input":[1,2],"expectedOutput":3}, ...];
const testCases = {{TESTS_JSON}};

async function run() {
    if (typeof {{FUNCTION_NAME}} !== 'function') {
        console.log(safeStringify({ status: 'error', message: 'Result is not a function' }));
        return;
    }

    // small guard for runaway number of tests
    if (!Array.isArray(testCases) || testCases.length > 5000) {
        console.log(safeStringify({ status: 'error', message: 'Invalid or too many test cases' }));
        return;
    }

    const submissionResult = {
        status: 'finished',
        passed: 0,
        total: testCases.length,
        details: [],
    };

    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const { input = [], expectedOutput } = testCase;

        let output, error, stack, stdout, stderr;
        let ok = false;

        const startTime = performance.now();
        try {
            const captureResult = await captureStreamsAsync(async () => {
                return await {{FUNCTION_NAME}}(...input);
            });

            output = captureResult.result;
            stdout = captureResult.stdout;
            stderr = captureResult.stderr;

            if (output === undefined) {
                error = 'Function returned undefined';
            } else {
                const normalizedOutput = normalize(output);
                const normalizedExpected = normalize(expectedOutput);
                ok = deepEqual(normalizedOutput, normalizedExpected);

                if (!ok) {
                    error = diffSummary(normalizedOutput, normalizedExpected);
                }
                output = normalizedOutput;
            }
        } catch (e) {
            error = e && e.toString ? e.toString() : String(e);
            stack = e && e.stack ? e.stack : undefined;
            stdout = stdout || '';
            stderr = (stderr || '') + (e && e.stderr ? e.stderr : '');
        }
        const durationMs = performance.now() - startTime;

        submissionResult.details.push({
            test: i, // 0-based index (consistent with other parts of your system)
            ok,
            output: truncateOutput(output),
            expected: truncateOutput(normalize(expectedOutput)),
            error: error,
            stack: stack,
            stdout: truncateOutput(stdout, 2000),
            stderr: truncateOutput(stderr, 2000),
            durationMs: durationMs,
        });

        if (ok) {
            submissionResult.passed++;
        }
    }

    console.log(safeStringify(submissionResult, 1000000));
}

run().catch(error => {
    console.log(safeStringify({ status: 'error', message: error.toString(), stack: error.stack }, 1000000));
});