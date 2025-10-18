import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { createClient } from 'redis';

import isEqual from 'lodash.isequal';

const languageConfigs = {
    javascript: {
        fileExtension: 'js',
        compileCommand: null, // No compilation needed for JavaScript
        runCommand: (filePath, functionName, input) => `node wrappers/javascript_runner.js ${filePath} ${functionName} '${JSON.stringify(input)}'`
    },
    python: {
        fileExtension: 'py',
        compileCommand: null, // No compilation needed for Python
        runCommand: (filePath, functionName, input) => `python3 wrappers/python_runner.py ${filePath} ${functionName} '${JSON.stringify(input)}'`
    },
    java: {
        fileExtension: 'java',
        compileCommand: (filePath) => `javac -parameters -cp /usr/local/lib/gson/gson-2.10.1.jar ${filePath} ${path.join(path.dirname(filePath), 'JavaRunner.java')} -d ${path.dirname(filePath)}`,
        runCommand: (filePath, functionName, input) => {
            const dir = path.dirname(filePath);
            return `java -cp ${dir}:/usr/local/lib/gson/gson-2.10.1.jar JavaRunner ${functionName} '${JSON.stringify(input)}'`;
        }
    },
    cpp: {
        fileExtension: 'cpp',
        compileCommand: (filePath, outputName) => `g++ ${filePath} -o ${outputName}`,
        runCommand: (outputPath, input) => `${outputPath} ${input}`
    }
};

import Problem from './models/Problem.js';
import Submission from './models/Submission.js';

// Recreate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Redis Client
const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';
const redisClient = createClient({ url: REDIS_URI });
redisClient.on('error', (err) => console.log('❌ Redis Client Error', err));
redisClient.connect().then(() => console.log('✅ Redis client connected'));

export const executeCode = async (submissionId) => {
    console.log(`Processing submission: ${submissionId}`);
    const submission = await Submission.findById(submissionId);
    if (!submission) {
        console.error(`❌ Submission with ID ${submissionId} not found.`);
        return;
    }

    const problem = await Problem.findById(submission.problem);
    if (!problem) {
        console.error(`❌ Problem with ID ${submission.problem} not found.`);
        submission.status = 'Fail';
        submission.output = 'Internal error: Problem not found.';
        await submission.save();
        return;
    }

    console.log(`Found problem: ${problem.title}`);
    submission.status = 'Running';
    await submission.save();

    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        console.log(`Created temp directory: ${tempDir}`);
    }

    const language = submission.language.toLowerCase();
    const config = languageConfigs[language];

    if (!config) {
        submission.status = 'Fail';
        submission.output = `Unsupported language: ${submission.language}`;
        await submission.save();
        console.error(`❌ Unsupported language: ${submission.language} for submission ${submissionId}`);
        return;
    }

    const baseFileName = language === 'java' ? 'Solution' : `code-${Date.now()}`;
    const sourceFileName = `${baseFileName}.${config.fileExtension}`;
    const sourceFilePath = path.join(tempDir, sourceFileName);
    const codeContent = submission.code
        .replace(/\\r\\n/g, '\n') // handle Windows-style newlines
        .replace(/\\n/g, '\n')    // handle escaped newlines
        .replace(/\r\n/g, '\n');  // normalize any stray CRLF
    fs.writeFileSync(sourceFilePath, codeContent);

    console.log(`Wrote submission code to: ${sourceFilePath}`);

    let executablePath = sourceFilePath;
    const filesToCleanUp = [sourceFilePath];

    if (language === 'java') {
        const runnerSourcePath = path.join(__dirname, 'wrappers', 'JavaRunner.java');
        const runnerDestPath = path.join(tempDir, 'JavaRunner.java');
        fs.copyFileSync(runnerSourcePath, runnerDestPath);
        filesToCleanUp.push(runnerDestPath);
    }

    try {
        // Compilation step for compiled languages
        if (config.compileCommand) {
            console.log(`Attempting to compile ${sourceFileName}...`);
            const compileOutputName = language === 'cpp' ? path.join(tempDir, baseFileName) : null;
            const command = config.compileCommand(sourceFilePath, compileOutputName);

            await new Promise((resolve, reject) => {
                exec(command, { timeout: 10000 }, (error, stdout, stderr) => { // 10 second timeout for compilation
                    if (error) {
                        return reject({ type: 'compile_error', output: stderr || error.message });
                    }
                    console.log(`Compilation successful for ${sourceFileName}`);
                    resolve();
                });
            });

            if (language === 'cpp') {
                executablePath = compileOutputName;
                filesToCleanUp.push(compileOutputName);
            } else if (language === 'java') {
                // Java compilation creates .class files in the same directory
                filesToCleanUp.push(path.join(tempDir, `${path.basename(sourceFileName, '.java')}.class`));
            }
        }

        let passedAllTests = true;
        let finalOutput = '';

        const signature = problem.functionSignatures.get(language);
        if (!signature) {
            submission.status = 'Fail';
            submission.output = `Function signature for language \"${language}\" not found.`;
            await submission.save();
            return;
        }

        let functionNameMatch;
        if (language === 'javascript') {
            functionNameMatch = signature.match(/function\s+([a-zA-Z0-9_]+)\s*\(/);
        } else if (language === 'python') {
            functionNameMatch = signature.match(/def\s+([a-zA-Z0-9_]+)\s*\(/);
        } else if (language === 'java') {
            functionNameMatch = signature.match(/public\s+(?:static\s+)?(?:[a-zA-Z0-9_<>[\]]+\s+)?([a-zA-Z0-9_]+)\s*\(/);
        }
        if (!functionNameMatch || !functionNameMatch[1]) {
            submission.status = 'Fail';
            submission.output = `Could not extract function name from signature: ${signature}`;
            await submission.save();
            return;
        }
        const functionName = functionNameMatch[1];

        for (const [index, testCase] of problem.testCases.entries()) {
            console.log(`Running test case ${index + 1}/${problem.testCases.length}`);
            const command = config.runCommand(executablePath, functionName, testCase.input);

            const execution = new Promise((resolve, reject) => {
                exec(command, { timeout: 5000 }, (error, stdout, stderr) => { // 5 second timeout for execution
                    if (error) {
                        return reject({ type: 'runtime_error', output: stderr || error.message });
                    }
                    resolve(stdout.trim());
                });
            });

            const output = await execution;
            let parsedOutput;
            try {
                parsedOutput = JSON.parse(output);
            } catch (e) {
                passedAllTests = false;
                finalOutput = `Test failed on input: ${JSON.stringify(testCase.input)}\nExpected: ${JSON.stringify(testCase.expectedOutput)}\nGot invalid JSON: ${output}`;
                console.log(`Test case ${index + 1} failed due to invalid JSON output`);
                break;
            }

            if (!isEqual(parsedOutput, testCase.expectedOutput)) {
                passedAllTests = false;
                finalOutput = `Test failed on input: ${JSON.stringify(testCase.input)}\nExpected: ${JSON.stringify(testCase.expectedOutput)}\nGot: ${JSON.stringify(parsedOutput)}`;
                console.log(`Test case ${index + 1} failed`);
                break;
            }
            console.log(`Test case ${index + 1} passed`);
        }

        submission.status = passedAllTests ? 'Success' : 'Fail';
        submission.output = passedAllTests ? 'All test cases passed!' : finalOutput;

    } catch (err) {
        submission.status = 'Fail';
        if (err.type === 'compile_error') {
            submission.output = `Compilation Error: ${err.output}`;
            console.error(`Compilation error for submission ${submissionId}:`, err);
        } else if (err.type === 'runtime_error') {
            submission.output = `Runtime Error: ${err.output}`;
            console.error(`Runtime error for submission ${submissionId}:`, err);
        } else {
            submission.output = `Execution Error: ${err.output || err.message}`;
            console.error(`Execution error for submission ${submissionId}:`, err);
        }
    } finally {
        // Clean up all generated files
        for (const file of filesToCleanUp) {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                console.log(`Deleted temp file: ${file}`);
            }
        }
        // For Java, also clean up any .class files that might have been generated
        if (language === 'java') {
            const javaClassFile = path.join(tempDir, `${path.basename(sourceFileName, '.java')}.class`);
            if (fs.existsSync(javaClassFile)) {
                fs.unlinkSync(javaClassFile);
                console.log(`Deleted temp Java class file: ${javaClassFile}`);
            }
        }
        await submission.save();
        // Cache the final result in Redis
        await redisClient.set(`submission:${submissionId}`, JSON.stringify(submission), { EX: 3600 }); // Cache for 1 hour
        console.log(`✅ Finished judging submission ${submissionId}. Result: ${submission.status}. Cached in Redis.`);
    }
};