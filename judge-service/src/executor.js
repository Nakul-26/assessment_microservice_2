import Docker from "dockerode/lib/docker.js";
import fs from "fs-extra";
import path from "path";
// import os from "os"; // No longer needed
import { v4 as uuidv4 } from "uuid";
import { SANDBOX } from "./config.js";
import tar from "tar-stream"; // New import
import { Readable } from "stream"; // New import

const docker = new Docker();

const MAX_OUTPUT_BYTES = SANDBOX.MAX_STDOUT_BYTES;

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
  const jsonMatches = output.match(/\{[\s\S]*?\}/g); // Match JSON objects
  if (jsonMatches) {
    // return last valid JSON
    for (let i = jsonMatches.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(jsonMatches[i]);
      } catch {}
    }
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
export async function runSubmission({ language, userCode, tests = [], timeoutMs }) {
  const id = uuidv4();
  // No tmpDir creation on host

  let container; // Declare container here for finally block access
  try {
    const fileName = `submission${language.fileExt}`;

    // Load wrapper template
    const wrapperTpl = await fs.readFile(path.join(process.cwd(), "src", "wrappers", language.wrapperTemplate), "utf8");
    // replace TESTS_JSON placeholder safely
    const testsJson = JSON.stringify(tests);
    // Inject export automatically
    // Wrap user's code to export `solution`
    // Wrap user code safely
    const exportedUserCode = `${userCode.trim()};
    // Ensure solution is exported
    const solution = userFunction;
    module.exports = { solution };
    `;

    // Merge with wrapper
    const finalCode = wrapperTpl
      .replace("{{TESTS_JSON}}", JSON.stringify(tests))
      .replace("// USER_CODE_MARKER", exportedUserCode);

    // Optional: debug merged code
    await fs.writeFile(path.join(process.cwd(), "finalCode.js"), finalCode, "utf8");
    console.log("Final code:\n", finalCode);

    const pidsLimit = SANDBOX.PIDS_LIMIT;
    const timeout = timeoutMs || SANDBOX.TIMEOUT_MS;
    console.log('SANDBOX.TIMEOUT_MS:', SANDBOX.TIMEOUT_MS, 'timeout:', timeout);

    // Check if image exists, pull if not
    // usage
    try {
      await docker.getImage(language.image).inspect();
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

    const createOpts = {
      Image: language.image,
      WorkingDir: '/app',
      Cmd: language.runCmd(fileName),
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
    const onData = (chunk) => {
      if (outputBytes >= MAX_OUTPUT_BYTES) return;
      const s = chunk.toString();
      const newBytes = Buffer.byteLength(s);
      if (outputBytes + newBytes > MAX_OUTPUT_BYTES) {
        // append only remaining slice
        const allowed = MAX_OUTPUT_BYTES - outputBytes;
        output += s.slice(0, allowed);
        outputBytes = MAX_OUTPUT_BYTES;
      } else {
        output += s;
        outputBytes += newBytes;
      }
    };
    stream.on("data", onData);

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
    try {
      const logs = await container.logs({ stdout: true, stderr: true, timestamps: false });
      onData(logs.toString());
    } catch (e) {}

    if (waitRes.timedOut) {
      return {
        status: "timeout",
        message: `Execution exceeded ${timeout} ms`,
        rawOutput: output
      };
    }

    // parse last JSON from output
    const parsed = safeParseJSONFromOutput(output);

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
