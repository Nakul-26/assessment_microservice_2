const { {{FUNCTION_NAME}} } = require('./submission.js');

function deepEqual(a, b, epsilon = 1e-9) {
    if (a === b) return true;

    if (typeof a === 'number' && typeof b === 'number') {
        return Math.abs(a - b) < epsilon;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        // For unordered arrays, sort them before comparison
        const sortedA = [...a].sort();
        const sortedB = [...b].sort();
        for (let i = 0; i < sortedA.length; i++) {
            if (!deepEqual(sortedA[i], sortedB[i], epsilon)) return false;
        }
        return true;
    }

    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!keysB.includes(key) || !deepEqual(a[key], b[key], epsilon)) {
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
