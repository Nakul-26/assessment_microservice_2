
const API_URL = 'http://localhost:3000/api';
const CONCURRENT_STUDENTS = 50;
const SUBMISSIONS_PER_STUDENT = 1;
const DEFAULT_PASS = 'LoadTest@2026';

async function runLoadTest() {
  console.log(`🚀 Starting Load Test with ${CONCURRENT_STUDENTS} students...`);
  const startTime = Date.now();

  // 1. Login as Admin
  console.log('🔑 Authenticating as admin...');
  const adminLoginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.com', password: 'password' })
  });
  const { token: adminToken } = await adminLoginRes.json();

  // 2. Create Test Assessment
  console.log('📝 Creating load test assessment...');
  const problemsRes = await fetch(`${API_URL}/problems`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const problems = await problemsRes.json();
  const problemId = problems[0]._id; // Use Two Sum or similar

  const assessmentRes = await fetch(`${API_URL}/assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'Simulated Exam Load Test',
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      durationMinutes: 60,
      problems: [{ problemId, maxScore: 100 }],
      status: 'Published'
    })
  });
  const assessment = await assessmentRes.json();
  const assessmentId = assessment._id;

  // 3. Create Students
  console.log('👥 Creating 50 test students...');
  const studentsToImport = Array.from({ length: CONCURRENT_STUDENTS }).map((_, i) => ({
    name: `Load Test Student ${i}`,
    email: `loadtest_${i}@example.com`
  }));

  await fetch(`${API_URL}/admin/bulk-import-students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ users: studentsToImport, defaultPassword: DEFAULT_PASS })
  });

  // 4. Simulate Concurrent Activity
  console.log('⚡ Starting concurrent simulations...');
  const results = {
    started: 0,
    submissions: 0,
    success: 0,
    errors: 0,
    latencies: []
  };

  const studentPromises = studentsToImport.map(async (studentData, i) => {
    try {
      // Small random delay to jitter the start (0-3 seconds)
      await new Promise(r => setTimeout(() => r(), Math.random() * 3000));

      // Student Login
      const loginRes = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: studentData.email, password: DEFAULT_PASS })
      });
      const { token: studentToken } = await loginRes.json();

      // Start Assessment
      const startRes = await fetch(`${API_URL}/assessments/${assessmentId}/start`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${studentToken}` }
      });
      const attempt = await startRes.json();
      results.started++;

      // Make Submissions
      for (let s = 0; s < SUBMISSIONS_PER_STUDENT; s++) {
        const subStartTime = Date.now();
        const subRes = await fetch(`${API_URL}/problems/${problemId}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
          body: JSON.stringify({
            language: 'javascript',
            code: 'function twoSum(nums, target) { return [0, 1]; }',
            attemptId: attempt._id
          })
        });
        
        if (subRes.ok) {
          results.submissions++;
          results.success++;
          results.latencies.push(Date.now() - subStartTime);
        } else {
          results.errors++;
        }
      }

      // Final Submit
      await fetch(`${API_URL}/assessments/attempts/${attempt._id}/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${studentToken}` }
      });

    } catch (err) {
      console.error(`Error in student ${i}:`, err.message);
      results.errors++;
    }
  });

  await Promise.all(studentPromises);

  // 5. Report
  const totalDuration = (Date.now() - startTime) / 1000;
  const avgLatency = results.latencies.length > 0 
    ? (results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length).toFixed(0) 
    : 0;

  console.log('\n--- Load Test Report ---');
  console.log(`Total Duration:   ${totalDuration}s`);
  console.log(`Students Started: ${results.started}`);
  console.log(`Total Runs:       ${results.submissions}`);
  console.log(`Success Rate:     ${((results.success / results.submissions) * 100).toFixed(1)}%`);
  console.log(`Avg Run Latency:  ${avgLatency}ms`);
  console.log(`Errors:           ${results.errors}`);
  console.log('------------------------\n');
  
  if (results.errors === 0 && results.success > 0) {
    console.log('✅ System handled 50 concurrent students successfully!');
  } else {
    console.warn('⚠️ Load test completed with some errors.');
  }
}

runLoadTest().catch(console.error);
