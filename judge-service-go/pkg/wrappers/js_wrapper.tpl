const EXPECTED_OUTPUT_TYPE = "{{EXPECTED_OUTPUT_TYPE}}";
const { {{FUNCTION_NAME}} } = require('./submission.js');

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
        // If after conversion, they are not both numbers, they are not equal
        return false;
    }

    // Default behavior: attempt to convert string numbers to actual numbers for comparison
    let valA = typeof a === 'string' && !isNaN(Number(a)) ? Number(a) : a;
    let valB = typeof b === 'string' && !isNaN(Number(b)) ? Number(b) : b;

    if (valA === valB) return true;

    if (typeof valA === 'number' && typeof valB === 'number') {
        return Math.abs(valA - valB) < epsilon;
    }

    if (Array.isArray(valA) && Array.isArray(valB)) {
        if (valA.length !== valB.length) return false;
        // For unordered arrays, sort them before comparison
        const sortedA = [...valA].sort();
        const sortedB = [...valB].sort();
        for (let i = 0; i < sortedA.length; i++) {
            if (!deepEqual(sortedA[i], sortedB[i], epsilon)) return false;
        }
        return true;
    }

    if (typeof valA === 'object' && valA !== null && typeof valB === 'object' && valB !== null) {
        const keysA = Object.keys(valA);
        const keysB = Object.keys(valB);

        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!keysB.includes(key) || !deepEqual(valA[key], valB[key], epsilon)) {
                return false;
            }
        }
        return true;
    }

    return false;
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
            const isCorrect = deepEqual(output, expectedOutput);
            results.push({ test: i + 1, ok: isCorrect, output });
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
