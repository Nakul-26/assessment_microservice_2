const COMPARE_MODE = "{{COMPARE_MODE}}"; // STRUCTURAL, STRICT, APPROX, ORDER_INSENSITIVE, TEXT
const { {{FUNCTION_NAME}} } = require('./submission.js');

function normalize(value, visited = new Set(), depth = 0) {
    const maxDepth = 1000; // prevent infinite loops

    if (depth > maxDepth) {
        return '[Max Depth Exceeded]';
    }

    // Avoid circular references
    if (value && typeof value === 'object') {
        if (visited.has(value)) return '[Circular]';
        visited.add(value);
    }

    if (value === null || typeof value !== 'object') return value;

    // Handle linked lists
    if (value && 'val' in value && 'next' in value) {
        const nodes = [];
        let curr = value;
        let currentDepth = 0;
        while (curr && currentDepth < maxDepth) {
            nodes.push(curr.val);
            curr = curr.next;
            currentDepth++;
        }
        return { __type: 'LinkedList', values: nodes };
    }

    // Handle trees (e.g. binary tree nodes)
    if (value && 'val' in value && ('left' in value || 'right' in value)) {
        return {
            __type: 'TreeNode',
            val: value.val,
            left: normalize(value.left, visited, depth + 1),
            right: normalize(value.right, visited, depth + 1),
        };
    }

    // Handle generic arrays
    if (Array.isArray(value)) {
        return value.map(v => normalize(v, visited, depth + 1));
    }

    // Handle generic objects with sorted keys
    const obj = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
        obj[key] = normalize(value[key], visited, depth + 1);
    }
    return obj;
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
            // This is a simplified sort for demonstration. A more robust solution
            // would handle nested objects and arrays within the unsorted array.
            const sortedA = [...a].sort();
            const sortedB = [...b].sort();
            return deepEqual(sortedA, sortedB, epsilon);
        case 'STRUCTURAL':
        default:
            return _structuralDeepEqual(a, b, epsilon);
    }
}

function _structuralDeepEqual(a, b, epsilon) {
    if (a === b) return true;

    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        // Fallback to approx for numbers if they weren't caught by a specific mode
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

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (!keysB.includes(key) || !_structuralDeepEqual(a[key], b[key], epsilon)) {
            return false;
        }
    }

    return true;
}

function safeStringify(obj) {
    const cache = new Set();
    return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (cache.has(value)) {
                return '[Circular]';
            }
            cache.add(value);
        }
        return value;
    }, 2); // Add indentation for readability
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
    if (typeof actual === 'object' && actual !== null && typeof expected === 'object' && expected !== null) {
        const keysA = Object.keys(actual);
        const keysB = Object.keys(expected);
        if (keysA.length !== keysB.length) {
            return `Object key count mismatch: expected ${keysB.length}, got ${keysA.length}`;
        }
        for (const key of keysB) {
            if (!keysA.includes(key)) {
                return `Missing key in output: "${key}"`;
            }
            if (!deepEqual(actual[key], expected[key])) {
                return `Mismatch at key "${key}": expected ${safeStringify(expected[key])}, got ${safeStringify(actual[key])}`;
            }
        }
    }
    return `Values differ: expected ${safeStringify(expected)}, got ${safeStringify(actual)}`;
}

function truncateOutput(obj, maxLen = 2000) {
    const s = safeStringify(obj);
    if (s.length > maxLen) {
        return s.slice(0, maxLen) + '…(truncated)';
    }
    return obj;
}

async function run() {
    if (typeof {{FUNCTION_NAME}} !== 'function') {
        console.log(safeStringify({ status: 'error', message: 'Result is not a function' }));
        return;
    }

    const testCases = JSON.parse(`{{TESTS_JSON}}`);

    const results = [];
    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const input = testCase.input;
        const expectedOutput = testCase.expectedOutput;

        try {
            const output = await {{FUNCTION_NAME}}(...input[0]);

            if (output === undefined) {
                results.push({
                    test: i + 1,
                    ok: false,
                    error: 'Function returned undefined',
                    expected: truncateOutput(expectedOutput),
                });
                continue;
            }

            // Normalize complex structures before comparing
            const normalizedOutput = normalize(output);
            const normalizedExpected = normalize(expectedOutput);

            const isCorrect = deepEqual(normalizedOutput, normalizedExpected);
            const result = {
                test: i + 1,
                ok: isCorrect,
                output: truncateOutput(normalizedOutput),
                expected: truncateOutput(normalizedExpected),
            };
            if (!isCorrect) {
                result.diff = diffSummary(normalizedOutput, normalizedExpected);
            }
            results.push(result);
        } catch (error) {
            results.push({
                test: i + 1,
                ok: false,
                error: error.toString(),
                expected: truncateOutput(expectedOutput),
            });
        }
    }

    const summary = {
        status: 'finished',
        passed: results.filter(r => r.ok).length,
        total: results.length,
        details: results,
    };

    console.log(safeStringify(summary));
}

run().catch(error => {
    console.log(safeStringify({ status: 'error', message: error.toString() }));
});
