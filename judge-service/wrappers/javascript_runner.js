import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

async function main() {
    const userCodePath = process.argv[2];
    const functionName = process.argv[3];
    const argsJson = process.argv[4];

    if (!userCodePath || !functionName || !argsJson) {
        console.error('Usage: node javascript_runner.js <userCodePath> <functionName> <argsJson>');
        process.exit(1);
    }

    try {
        const userCode = fs.readFileSync(userCodePath, 'utf8').replace(/\\n/g, '\n');

        const script = `
${userCode}

const args = ${argsJson};
const result = ${functionName}(...Object.values(args));
console.log(JSON.stringify(result));
`;

        const tempScriptPath = path.join(path.dirname(userCodePath), `runner_${Date.now()}.js`);
        fs.writeFileSync(tempScriptPath, script);

        exec(`node ${tempScriptPath}`, (error, stdout, stderr) => {
            fs.unlinkSync(tempScriptPath);
            if (error) {
                console.error(stderr);
                process.exit(1);
            }
            console.log(stdout);
        });

    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

main();
