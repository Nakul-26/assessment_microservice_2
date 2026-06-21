import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import Problem from '../../models/Problem.mjs';
import * as authService from '../services/auth.service.js';

describe('Problems API', () => {
  let adminToken;
  let studentToken;

  beforeEach(async () => {
    // Create admin user
    const admin = await authService.register({
      name: 'Admin User',
      email: `admin-${Date.now()}@test.com`,
      password: 'password123',
      role: 'admin'
    });
    adminToken = admin.token;

    // Create student user
    const student = await authService.register({
      name: 'Student User',
      email: `student-${Date.now()}@test.com`,
      password: 'password123',
      role: 'student'
    });
    studentToken = student.token;

    // Seed some problems
    await Problem.create([
      {
        title: 'Two Sum',
        description: 'Sum of two numbers',
        difficulty: 'Easy',
        functionName: 'twoSum',
        parameters: [{ name: 'nums', type: 'array<number>' }, { name: 'target', type: 'number' }],
        returnType: 'array<number>',
        testCases: [{ inputs: [[2, 7, 11, 15], 9], expected: [0, 1], isSample: true }],
        referenceSolution: 'function twoSum(nums, target) { return [0, 1]; }',
        solutionLanguage: 'javascript'
      },
      {
        title: 'Reverse String',
        description: 'Reverse it',
        difficulty: 'Easy',
        functionName: 'reverseString',
        parameters: [{ name: 's', type: 'string' }],
        returnType: 'string',
        testCases: [{ inputs: ['hello'], expected: 'olleh', isSample: true }],
        referenceSolution: 'function reverseString(s) { return "olleh"; }',
        solutionLanguage: 'javascript'
      }
    ]);
  });

  it('GET /api/problems should return list of problems', async () => {
    const res = await request(app).get('/api/problems');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });

  it('GET /api/problems/:id should return a specific problem', async () => {
    const listRes = await request(app).get('/api/problems');
    const problem = listRes.body.find(p => p.title === 'Two Sum');
    const problemId = problem._id;

    const res = await request(app).get(`/api/problems/${problemId}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Two Sum');
  });

  it('POST /api/problems should create a problem for admin', async () => {
    const newProblem = {
      title: 'Add Two Numbers',
      description: 'Add them',
      difficulty: 'Medium',
      functionName: 'addTwo',
      parameters: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
      returnType: 'number',
      testCases: [{ inputs: [1, 2], expected: 3, isSample: true }],
      referenceSolution: 'function addTwo(a, b) { return a + b; }',
      solutionLanguage: 'javascript'
    };

    const res = await request(app)
      .post('/api/problems')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(newProblem);
    
    expect(res.status).toBe(201);
    expect(res.body.problem.title).toBe('Add Two Numbers');
  });

  it('POST /api/problems should fail for student', async () => {
    const res = await request(app)
      .post('/api/problems')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Unauthorized' });
    
    expect(res.status).toBe(403);
  });
});
