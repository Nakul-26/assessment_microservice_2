import { describe, it, expect } from 'vitest';
import College from '../../models/College.mjs';
import * as authService from './auth.service.js';
import { signup } from './college.service.js';

describe('college.service.signup', () => {
  it('creates a new College and its first user as admin', async () => {
    const result = await signup({
      collegeName: 'Acme Institute of Technology',
      name: 'Jane Doe',
      email: `jane-${Date.now()}@example.com`,
      password: 'password123'
    });

    expect(result.token).toBeDefined();
    expect(result.user.role).toBe('admin');
    expect(result.user.collegeId).toBeDefined();

    const college = await College.findById(result.user.collegeId);
    expect(college).not.toBeNull();
    expect(college.name).toBe('Acme Institute of Technology');
    expect(college.slug).toBe('acme-institute-of-technology');
    expect(college.planId).toBe('free');
  });

  it('dedupes the slug when two colleges share a name', async () => {
    const first = await signup({
      collegeName: 'Shared Name College',
      name: 'Admin One',
      email: `admin1-${Date.now()}@example.com`,
      password: 'password123'
    });
    const second = await signup({
      collegeName: 'Shared Name College',
      name: 'Admin Two',
      email: `admin2-${Date.now()}@example.com`,
      password: 'password123'
    });

    const firstCollege = await College.findById(first.user.collegeId);
    const secondCollege = await College.findById(second.user.collegeId);
    expect(firstCollege.slug).not.toBe(secondCollege.slug);
  });

  it('rolls back the College if the admin user cannot be created', async () => {
    const email = `dup-${Date.now()}@example.com`;
    await authService.register({ name: 'Existing User', email, password: 'password123', role: 'student' });

    const collegesBefore = await College.countDocuments();

    await expect(
      signup({ collegeName: 'Orphan College', name: 'New Admin', email, password: 'password123' })
    ).rejects.toMatchObject({ status: 409 });

    const collegesAfter = await College.countDocuments();
    expect(collegesAfter).toBe(collegesBefore);

    const orphan = await College.findOne({ name: 'Orphan College' });
    expect(orphan).toBeNull();
  });

  it('rejects when the college name is missing', async () => {
    await expect(
      signup({ collegeName: '', name: 'Admin', email: `noname-${Date.now()}@example.com`, password: 'password123' })
    ).rejects.toMatchObject({ status: 400 });
  });
});
