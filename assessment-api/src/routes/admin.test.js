import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import * as authService from '../services/auth.service.js';
import User from '../../models/User.mjs';
import Problem from '../../models/Problem.mjs';
import Assessment from '../../models/Assessment.mjs';
import Submission from '../../models/Submission.mjs';
import AuditLog from '../../models/AuditLog.mjs';

describe('Admin Routes, Bulk Import, and Rejudge API', () => {
  let superadminToken;
  let superadminUser;

  beforeEach(async () => {
    // Clear user, problem, assessment, submission, audit log DBs
    await User.deleteMany({});
    await Problem.deleteMany({});
    await Assessment.deleteMany({});
    await Submission.deleteMany({});
    await AuditLog.deleteMany({});

    const superadmin = await authService.register({
      name: 'Super Admin',
      email: 'superadmin@test.com',
      password: 'password123',
      role: 'superadmin'
    });
    superadminToken = superadmin.token;
    superadminUser = superadmin.user;
  });

  it('POST /api/admin/bulk-import-students should successfully import valid students and generate passwords', async () => {
    const importPayload = {
      users: [
        { name: 'John Doe', email: 'john@college.edu', usn: '1BY23CS001', section: 'A' },
        { name: 'Jane Doe', email: 'jane@college.edu', usn: '1BY23CS002', section: 'A' }
      ],
      defaultPassword: 'TempPassword123'
    };

    const res = await request(app)
      .post('/api/admin/bulk-import-students')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send(importPayload);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.created).toHaveLength(2);
    expect(res.body.errors).toHaveLength(0);

    // Verify cleartext password is returned
    expect(res.body.created[0].password).toBe('TempPassword123');
    expect(res.body.created[0].usn).toBe('1BY23CS001');
    expect(res.body.created[0].section).toBe('A');

    // Verify they are saved in MongoDB
    const storedUser = await User.findOne({ email: 'john@college.edu' });
    expect(storedUser).toBeDefined();
    expect(storedUser.name).toBe('John Doe');
    expect(storedUser.usn).toBe('1BY23CS001');
    expect(storedUser.section).toBe('A');
    expect(storedUser.role).toBe('student');
  });

  it('POST /api/admin/bulk-import-students should catch internal batch duplicates and DB duplicates', async () => {
    await authService.register({
      name: 'Existing Student',
      email: 'conflict@college.edu',
      password: 'password123',
      role: 'student',
      usn: '1BY23CS999'
    });

    const importPayload = {
      users: [
        { name: 'Student A', email: 'batch-dup@test.com', usn: 'USN001', section: 'A' },
        { name: 'Student B', email: 'batch-dup@test.com', usn: 'USN002', section: 'A' },
        { name: 'Student C', email: 'conflict@college.edu', usn: 'USN003', section: 'A' },
        { name: 'Student D', email: 'unique@college.edu', usn: '1BY23CS999', section: 'B' },
        { name: 'Valid Student', email: 'valid@college.edu', usn: 'USN004', section: 'B' }
      ],
      defaultPassword: 'TempPassword123'
    };

    const res = await request(app)
      .post('/api/admin/bulk-import-students')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send(importPayload);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.errors).toHaveLength(3);

    const errors = res.body.errors;
    expect(errors.some(e => e.error.includes('Duplicate email in upload batch'))).toBe(true);
    expect(errors.some(e => e.error.includes('Email already registered in system'))).toBe(true);
    expect(errors.some(e => e.error.includes('USN already registered in system'))).toBe(true);
  });

  describe('Rejudge APIs', () => {
    let problem;
    let assessment;
    let submission;

    beforeEach(async () => {
      // Create problem
      problem = await Problem.create({
        title: 'Two Sum',
        description: 'Find two numbers that add up to target',
        difficulty: 'Easy',
        functionName: 'twoSum',
        parameters: [
          { name: 'nums', type: 'array<number>' },
          { name: 'target', type: 'number' }
        ],
        returnType: 'array<number>',
        testCases: [
          { inputs: [[2,7,11,15], 9], expected: [0,1], isSample: true, isHidden: false }
        ]
      });

      // Create assessment
      assessment = await Assessment.create({
        title: 'Midterm Coding Assessment',
        problems: [{ problemId: problem._id, maxScore: 50 }],
        durationMinutes: 60,
        startTime: new Date(),
        endTime: new Date(Date.now() + 2 * 3600 * 1000),
        createdBy: superadminUser.id
      });

      // Create submission
      submission = await Submission.create({
        problemId: problem._id,
        userId: superadminUser.id,
        assessmentId: assessment._id,
        code: 'def twoSum(nums, target): return [0, 1]',
        language: 'python',
        status: 'Success',
        score: 50,
        output: '{"status":"Accepted"}',
        testResult: { status: 'Accepted', passed: 1, total: 1 }
      });
    });

    it('POST /api/admin/rejudge/submission/:submissionId should successfully trigger a single submission rejudge', async () => {
      const res = await request(app)
        .post(`/api/admin/rejudge/submission/${submission._id}`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.msg).toContain('Rejudge scheduled successfully');

      // Verify DB submission status is reset to Pending
      const updatedSubmission = await Submission.findById(submission._id);
      expect(updatedSubmission.status).toBe('Pending');
      expect(updatedSubmission.score).toBe(0);
      expect(updatedSubmission.output).toBeUndefined();

      // Verify audit log creation
      const audit = await AuditLog.findOne({ event: 'REJUDGE_SUBMISSION' });
      expect(audit).toBeDefined();
      expect(audit.userId.toString()).toBe(superadminUser.id);
      expect(audit.details.submissionId.toString()).toBe(submission._id.toString());
    });

    it('POST /api/admin/rejudge/problem/:problemId should trigger rejudge for all problem submissions', async () => {
      const res = await request(app)
        .post(`/api/admin/rejudge/problem/${problem._id}`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);

      const updatedSubmission = await Submission.findById(submission._id);
      expect(updatedSubmission.status).toBe('Pending');

      const audit = await AuditLog.findOne({ event: 'REJUDGE_PROBLEM' });
      expect(audit).toBeDefined();
      expect(audit.details.problemId.toString()).toBe(problem._id.toString());
    });

    it('POST /api/admin/rejudge/assessment/:assessmentId should trigger rejudge for all assessment submissions', async () => {
      const res = await request(app)
        .post(`/api/admin/rejudge/assessment/${assessment._id}`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);

      const updatedSubmission = await Submission.findById(submission._id);
      expect(updatedSubmission.status).toBe('Pending');

      const audit = await AuditLog.findOne({ event: 'REJUDGE_ASSESSMENT' });
      expect(audit).toBeDefined();
      expect(audit.details.assessmentId.toString()).toBe(assessment._id.toString());
    });
  });
});
