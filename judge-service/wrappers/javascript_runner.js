import fs from 'fs';
import { VM } from 'vm2';

async function main() {
    const inputJson = process.argv[2];

    if (!inputJson) {
        console.error('Usage: node javascript_runner.js <inputJson>');
        process.exit(1);
    }

    try {
        const { code, functionName, input } = JSON.parse(inputJson);

        const vm = new VM({
            timeout: 1000,
            sandbox: {
                console: {
                    log: (...args) => {
                        // Intercept console.log and stringify the output
                        const output = args.map(arg => JSON.stringify(arg)).join(' ');
                        process.stdout.write(output);
                    }
                }
            }
        });

        const script = `
${code}
const result = ${functionName}(...Object.values(input));
JSON.stringify(result);
`;

        const result = vm.run(script);
        console.log(result);

    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

main();