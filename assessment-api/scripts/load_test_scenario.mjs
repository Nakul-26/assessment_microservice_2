import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import path from 'path';
import jwt from 'jsonwebtoken';

dotenv.config({ path: path.resolve('.env') });

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const INTEGRATION_SECRET = process.env.TESTING_PLATFORM_KEY || 'testing_platform_secret';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

let JWT_TOKEN = process.env.TEST_JWT; 
if (!JWT_TOKEN) {
  console.log("Generating a temporary test JWT token...");
  const fakeUserId = "000000000000000000000001";
  const rawToken = jwt.sign(
    { _id: fakeUserId, id: fakeUserId, role: 'student' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  JWT_TOKEN = `Bearer ${rawToken}`;
}

// Allow passing concurrency as a command line argument
const argConcurrency = process.argv[2] ? parseInt(process.argv[2], 10) : null;
const CONCURRENCY = argConcurrency || 500;
const PROBLEM_ID = "6a25a3ba7b3b51a116fcbb29"; // Valid problem ID
const CODE_PAYLOAD = "print('load test')";

async function loadTest() {
  console.log(`🚀 Starting Load Test with ${CONCURRENCY} concurrent submissions...`);
  console.log(`API URL: ${API_URL}`);
  
  if (!JWT_TOKEN) {
    console.warn("⚠️ Warning: TEST_JWT environment variable not set. Integration submissions will fail with 401 Unauthorized.");
    console.warn("Proceeding anyway to test API latency and rejection rate...");
  }

  const startTime = Date.now();
  
  // We don't want to exhaust Node's event loop, so we batch them if > 1000
  // For 500, Promise.all is fine.
  
  const requests = Array.from({ length: CONCURRENCY }).map((_, _i) => {
    const reqId = `load-test-${uuidv4()}`;
    
    return axios.post(`${API_URL}/api/integration/submissions`, {
      problemId: PROBLEM_ID,
      code: CODE_PAYLOAD,
      language: 'python'
    }, {
      headers: {
        'x-service-key': INTEGRATION_SECRET,
        'Authorization': JWT_TOKEN || 'Bearer fake-token',
        'x-request-id': reqId
      },
      validateStatus: () => true // Resolve all statuses so Promise.all doesn't fail early
    }).then(res => ({
      reqId,
      status: res.status,
      time: Date.now() - startTime
    })).catch(err => ({
      reqId,
      status: err.response?.status || 500,
      error: err.message,
      time: Date.now() - startTime
    }));
  });

  const results = await Promise.all(requests);
  const endTime = Date.now();
  
  const duration = (endTime - startTime) / 1000;
  
  // Metrics calculation
  const times = results.map(r => r.time).sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.50)] || 0;
  const p95 = times[Math.floor(times.length * 0.95)] || 0;
  const p99 = times[Math.floor(times.length * 0.99)] || 0;

  const statusCounts = results.reduce((acc, curr) => {
    acc[curr.status] = (acc[curr.status] || 0) + 1;
    return acc;
  }, {});

  const successes = results.filter(r => r.status >= 200 && r.status < 300).length;
  const backpressure = results.filter(r => r.status === 503).length;

  console.log("\n📊 Load Test Results 📊");
  console.log("------------------------");
  console.log(`Total Requests: ${CONCURRENCY}`);
  console.log(`Duration: ${duration.toFixed(2)} seconds`);
  console.log(`Throughput: ${(CONCURRENCY / duration).toFixed(2)} req/sec`);
  console.log(`Latency - p50: ${p50}ms | p95: ${p95}ms | p99: ${p99}ms`);
  console.log(`Successful (2xx): ${successes}`);
  console.log(`Rejected by Backpressure (503): ${backpressure}`);
  console.log("\nStatus Breakdown:");
  console.table(statusCounts);
  
  if (backpressure > 0) {
    console.log("✅ Backpressure protection successfully kicked in.");
  } else if (successes === 0) {
    console.log("⚠️ No successful requests. Check token or endpoint configuration.");
  } else {
    console.log("✅ System handled the load smoothly.");
  }
}

loadTest();
