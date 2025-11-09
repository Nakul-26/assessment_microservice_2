const EXPECTED_OUTPUT_TYPE = "{{EXPECTED_OUTPUT_TYPE}}";
const { {{FUNCTION_NAME}} } = require('./submission.js');

function normalize(value, visited = new Set()) {
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
        const maxDepth = 10000; // prevent infinite loops
        let depth = 0;
        while (curr && depth < maxDepth) {
            nodes.push(curr.val);
            curr = curr.next;
            depth++;
        }
        return { __type: 'LinkedList', values: nodes };
    }

    // Handle trees (e.g. binary tree nodes)
    if (value && 'val' in value && ('left' in value || 'right' in value)) {
        return {
            __type: 'TreeNode',
            val: value.val,
            left: normalize(value.left, visited),
            right: normalize(value.right, visited),
        };
    }

    // Handle generic arrays and objects
    if (Array.isArray(value)) {
        return value.map(v => normalize(v, visited));
    }

    const obj = {};
    for (const key in value) {
        obj[key] = normalize(value[key], visited);
    }
    return obj;
}

function _deepEqual(a, b, epsilon) {
    // This is the recursive part, without the EXPECTED_OUTPUT_TYPE logic.
    let valA = typeof a === 'string' && !isNaN(Number(a)) ? Number(a) : a;
    let valB = typeof b === 'string' && !isNaN(Number(b)) ? Number(b) : b;

    if (valA === valB) return true;

    if (typeof valA === 'number' && typeof valB === 'number') {
        return Math.abs(valA - valB) < epsilon;
    }

    if (Array.isArray(valA) && Array.isArray(valB)) {
        if (valA.length !== valB.length) return false;
        for (let i = 0; i < valA.length; i++) {
            if (!_deepEqual(valA[i], valB[i], epsilon)) return false;
        }
        return true;
    }

    if (typeof valA === 'object' && valA !== null && typeof valB === 'object' && valB !== null) {
        const keysA = Object.keys(valA);
        const keysB = Object.keys(valB);

        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!keysB.includes(key) || !_deepEqual(valA[key], valB[key], epsilon)) {
                return false;
            }
        }
        return true;
    }

    return false;
}


function deepEqual(a, b, epsilon = 1e-9) {
    // If expected output type is explicitly 'string', compare as strings
    if (EXPECTED_OUTPUT_TYPE === 'string') {
        return String(a) === String(b);
    }

    // If expected output type is explicitly 'number', compare as numbers
    if (EXPECTED_OUTPUT_TYPE === 'number') {
        let numA = typeof a === 'string' && !isNaN(Number(a)) ? Number(a) : a;
        let numB = typeof b === 'string' && !isNaN(Number(b)) ? Number(b) : b;
        if (typeof numA === 'number' && typeof numB === 'number') {
            return Math.abs(numA - numB) < epsilon;
        }
        return false;
    }

    // If expected output type is explicitly 'array', compare as ordered arrays
    if (EXPECTED_OUTPUT_TYPE === 'array') {
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                // Use the recursive helper
                if (!_deepEqual(a[i], b[i], epsilon)) return false;
            }
            return true;
        }
        return false;
    }

    // Default behavior
    return _deepEqual(a, b, epsilon);
}

async function run() {
    if (typeof {{FUNCTION_NAME}} !== 'function') {
        console.log(JSON.stringify({ status: 'error', message: 'Result is not a function' }));
        return;
    }

    const testCases = {{TESTS_JSON}};

    const results = [];
    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const input = testCase.input;
        const expectedOutput = testCase.expectedOutput;

        try {
            const output = await {{FUNCTION_NAME}}(...input);

            // Normalize complex structures before comparing
            const normalizedOutput = normalize(output);
            const normalizedExpected = normalize(expectedOutput);

            const isCorrect = deepEqual(normalizedOutput, normalizedExpected);
            results.push({ test: i + 1, ok: isCorrect, output: normalizedOutput });
        } catch (error) {
            results.push({ test: i + 1, ok: false, error: error.toString() });
        }
    }

    const summary = {
        status: 'finished',
        passed: results.filter(r => r.ok).length,
        total: results.length,
        details: results,
    };

    console.log(JSON.stringify(summary));
}

run().catch(error => {
    console.log(JSON.stringify({ status: 'error', message: error.toString() }));
});
