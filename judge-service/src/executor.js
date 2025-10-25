import Docker from "dockerode/lib/docker.js";
import fs from "fs-extra";
import path from "path";
// import os from "os"; // No longer needed
import { v4 as uuidv4 } from "uuid";
import { SANDBOX } from "./config.js";
import tar from "tar-stream"; // New import
import { Readable, PassThrough } from "stream"; // New import

const docker = new Docker();

const MAX_OUTPUT_BYTES = SANDBOX.MAX_STDOUT_BYTES;

function getType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function pullImage(image) {
  return new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  });
}

function safeParseJSONFromOutput(output) {
  try {
    // Match all JSON-looking blocks in the output
    const matches = output.match(/\{[\s\S]*?\}/g);
    console.log("Detected JSON-like blocks:", matches);

    if (!matches || matches.length === 0) return null;

    // Try to parse from the last to the first, return first valid JSON
    for (let i = matches.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(matches[i]);
        return parsed;
      } catch (e) {
        continue;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}



/**
 * runSubmission
 * @param {Object} opts
 *  - language: language config (from languages/*.js)
 *  - userCode: string
 *  - tests: array of { input: [...], expected: ... }
 *  - timeoutMs: optional override
 */
export async function runSubmission({ language, userCode, tests = [], timeoutMs, funcName }) {
  console.log('runSubmission called with language:', language);
  console.log('Number of tests:', tests.length);
  console.log('Timeout (ms):', timeoutMs);
  console.log('SANDBOX config:', SANDBOX);
  console.log('User code length:', userCode.length);
  console.log('user code:', userCode);
  console.log('Tests:', tests);

  // Type validation based on meta data
  for (const test of tests) {
      if (test.meta && test.meta.types) {
          const expectedTypes = test.meta.types;
          let actualTypes = [];

          if (language.id === 'javascript') {
              // For JS, input is an array of arguments or a single argument
              const inputArgs = Array.isArray(test.input) ? test.input : [test.input];
              actualTypes = inputArgs.map(arg => getType(arg));
          } else if (language.id === 'python') {
              // For Python, input is an object of keyword arguments
              // We need to get types of values in the order they are expected
              // This assumes the order of keys in test.input matches the order of expectedTypes
              // A more robust solution might require parameter names in meta.types
              actualTypes = Object.values(test.input).map(arg => getType(arg));
          }

          if (expectedTypes.length !== actualTypes.length) {
              return {
                  status: "error",
                  message: `Type mismatch in test case: Expected ${expectedTypes.length} arguments, got ${actualTypes.length}.`,
                  rawOutput: ""
              };
          }

          for (let i = 0; i < expectedTypes.length; i++) {
              if (expectedTypes[i] !== actualTypes[i]) {
                  return {
                      status: "error",
                      message: `Type mismatch in test case: Argument ${i + 1} expected type ${expectedTypes[i]}, got ${actualTypes[i]}.`,
                      rawOutput: ""
                  };
              }
          }
      }
  }

  const id = uuidv4();
  // No tmpDir creation on host

  let container; // Declare container here for finally block access
  try {
    const fileName = `submission${language.fileExt}`;

    // Load wrapper template
    const wrapperTpl = await fs.readFile(path.join(process.cwd(), "src", "wrappers", language.wrapperTemplate), "utf8");
    console.log('Loaded wrapper template:', language.wrapperTemplate);
    console.log('Wrapper template length:', wrapperTpl.length);
    console.log('Wrapper template content:', wrapperTpl);
    console.log('process.cwd():', process.cwd());
    console.log('path to wrapper:', path.join(process.cwd(), "src", "wrappers", language.wrapperTemplate));
    console.log("--------------------------------------------------");
    // replace TESTS_JSON placeholder safely
    let testsJson = JSON.stringify(tests);
    // Inject export automatically
    // Wrap user's code to export `solution`
    // Wrap user code safely
    let codeToInject = userCode;
    if (language.id === 'javascript') {
        codeToInject = `${userCode.trim()};\n    // Ensure solution is exported\n    const ${funcName} = userFunction;\n    module.exports = { ${funcName} };\n    `;
    } else if (language.id === 'python' && funcName) {
        codeToInject = `${userCode.trim()}\n\nsolution = ${funcName}`;
    } else if (language.id === 'java' && funcName) {
        // For Java, the function name is used within the wrapper, not directly injected here
        // We will replace a placeholder in the Java wrapper template later
        codeToInject = userCode.trim();
    }

    console.log('Code to inject:', codeToInject);

    const marker = language.id === 'python' ? '# USER_CODE_MARKER' : '// USER_CODE_MARKER';
    // let testsJson = JSON.stringify(tests);
    if (language.id === 'java') {
        testsJson = testsJson.replace(/"/g, '\\"');
    }
    let finalCode = wrapperTpl
      .replace("{{TESTS_JSON}}", testsJson)
      .replace(marker, codeToInject);

    if (language.id === 'java') {
        finalCode = finalCode.replace(/\{\{FUNCTION_NAME\}\}/g, funcName);
        finalCode = finalCode.replace(/\{\{CLASS_NAME\}\}/g, funcName); // Assuming class name is same as function name for now
    }

    console.log('Final code length:', finalCode.length);
    console.log('Final code content:', finalCode);

    const pidsLimit = SANDBOX.PIDS_LIMIT;
    const timeout = timeoutMs || SANDBOX.TIMEOUT_MS;
    console.log('SANDBOX.TIMEOUT_MS:', SANDBOX.TIMEOUT_MS, 'timeout:', timeout);

    // Check if image exists, pull if not
    // usage
    try {
      docker.getImage(language.image).inspect();
    } catch (e) {
      if (e.statusCode === 404) {
        console.log(`Pulling Docker image: ${language.image}`);
        await pullImage(language.image);  // <-- now safe to await
        await ensureImage(language.image); // optional: wait until fully available
      } else {
        throw e;
      }
    }

    // Check if image exists, pull if not
    // try {
    //   await docker.getImage(language.image).inspect();
    // } catch (e) {
    //   if (e.statusCode === 404) { // Image not found
    //     console.log(`Pulling Docker image: ${language.image}`);
    //     await docker.pull(language.image);
    //     console.log(`Successfully pulled ${language.image}`);
    //     await new Promise(resolve => setTimeout(resolve, 1000)); // Add a small delay
    //   } else {
    //     throw e; // Re-throw other errors
    //   }
    // }

    const args = [];
    if (language.id === 'java') {
        for (const test of tests) {
            args.push(test.input.num1, test.input.num2, test.expectedOutput);
        }
    }

    const createOpts = {
      Image: language.image,
      WorkingDir: '/app',
      Cmd: language.runCmd(fileName, args),
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      HostConfig: {
        AutoRemove: true,
        NetworkMode: "none",
        Memory: SANDBOX.MEMORY_BYTES,
        CpuShares: SANDBOX.CPU_SHARES,
        PidsLimit: SANDBOX.PIDS_LIMIT,
        ReadonlyRootfs: false, // set to true if image allows working directory mapping
        // No Binds here
        Tmpfs: { "/tmp": "rw,exec,nosuid,size=64m" },
        CapDrop: ["ALL"],
        SecurityOpt: ["seccomp=unconfined"], // Placeholder: Replace 'unconfined' with path to custom seccomp profile (e.g., `seccomp=/path/to/your/profile.json`)
      }
    };

    container = await docker.createContainer(createOpts); // Assign to container variable

    // Create a tar archive in memory for the code file
    const pack = tar.pack();
    console.log('finalCode length:', finalCode.length);
    pack.entry({ name: fileName, mode: 0o755 }, finalCode);
    pack.finalize();

    await container.putArchive(pack, { path: '/app' });

    // start & attach
    await container.start();
    const stream = await container.attach({ stream: true, stdout: true, stderr: true });

    // stream output with a cap
    let output = "";
    let outputBytes = 0;
    const outputStream = new PassThrough();

    outputStream.on('data', (chunk) => {
        if (outputBytes >= MAX_OUTPUT_BYTES) return;
        const newBytes = chunk.length;
        if (outputBytes + newBytes > MAX_OUTPUT_BYTES) {
            const allowed = MAX_OUTPUT_BYTES - outputBytes;
            output += chunk.slice(0, allowed).toString('utf-8');
            outputBytes = MAX_OUTPUT_BYTES;
        } else {
            output += chunk.toString('utf-8');
            outputBytes += newBytes;
        }
    });

    console.log('Starting container...');
    console.log('Created container, attaching to output stream...');

    console.log('Attaching to container output stream');
    docker.modem.demuxStream(stream, outputStream, outputStream);

    // enforce timeout
    let timedOut = false;
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(async () => {
        timedOut = true;
        try {
          await container.kill().catch(()=>{});
        } catch(e) {}
        resolve({ timedOut: true });
      }, timeout);
    });

    // wait for end or timeout
    const waitRes = await Promise.race([
      container.wait(),
      timeoutPromise
    ]);

    // detach stream
    try { stream.removeAllListeners("data"); } catch (e) {}

    // grab logs too (in-case something remained)
    // try {
    //   const logs = await container.logs({ stdout: true, stderr: true, timestamps: false });
    //   onData(logs.toString());
    // } catch (e) {}

    if (waitRes.timedOut) {
      return {
        status: "timeout",
        message: `Execution exceeded ${timeout} ms`,
        rawOutput: output
      };
    }

    // parse last JSON from output
    const parsed = safeParseJSONFromOutput(output);
    console.log('Raw output from container:', output);
    console.log('Parsed output from container:', parsed);

    if (parsed) {
      // If parsed looks like a single test instead of full summary, check wrapper
      return {
        status: "ok",
        result: parsed, // this should now be the full {status, passed, total, details} object
        rawOutput: output
      };
    } else {
      return {
        status: "error",
        message: "No valid result produced by wrapper",
        rawOutput: output
      };
    }


  } finally {
    // No fs.remove(tmpDir) here
  }
}
