const { {{FUNCTION_NAME}} } = require('./submission.js');

async function run() {
    if (typeof {{FUNCTION_NAME}} !== 'function') {
        console.log(JSON.stringify({ status: 'error', message: 'Result is not a function' }));
        return;
    }

    const testCases = {{TESTS_JSON}};

    const results = [];
    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const input = JSON.parse(testCase.input);
        const expectedOutput = JSON.parse(testCase.expectedOutput);

        try {
            const output = await {{FUNCTION_NAME}}(...input);
            const isCorrect = JSON.stringify(output) === JSON.stringify(expectedOutput);
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
