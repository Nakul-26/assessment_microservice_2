import { describe, it, expect, beforeEach } from 'vitest';
import * as systemService from './system.service.js';
import User from '../../models/User.mjs';
import SystemSettings from '../../models/SystemSettings.mjs';

describe('System Service Unit Tests', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    await SystemSettings.deleteMany({});
  });

  it('should get and set settings correctly', async () => {
    // 1. Get non-existent setting should return default value
    const defVal = await systemService.getSetting('non_existent', 'default_val');
    expect(defVal).toBe('default_val');

    // 2. Set setting
    const saved = await systemService.setSetting('test_key', { a: 1 });
    expect(saved).toEqual({ a: 1 });

    // 3. Get existing setting
    const val = await systemService.getSetting('test_key');
    expect(val).toEqual({ a: 1 });
  });

  it('should get and update incident banner settings', async () => {
    // 1. Get default banner (inactive)
    const banner = await systemService.getIncidentBanner();
    expect(banner.active).toBe(false);

    // 2. Update banner to warning
    const updated = await systemService.updateIncidentBanner({
      active: true,
      message: 'System Maintenance',
      type: 'warning'
    });
    expect(updated.active).toBe(true);
    expect(updated.message).toBe('System Maintenance');
    expect(updated.type).toBe('warning');

    // 3. Verify it is persisted
    const current = await systemService.getIncidentBanner();
    expect(current.active).toBe(true);
    expect(current.message).toBe('System Maintenance');
  });

  it('should export and import database state correctly', async () => {
    // 1. Create a user
    await User.create({
      name: 'Simulated User',
      email: 'sim@test.com',
      password: 'password123',
      role: 'student'
    });

    // 2. Export database
    const backup = await systemService.exportDatabase();
    expect(backup.users).toHaveLength(1);
    expect(backup.users[0].email).toBe('sim@test.com');

    // 3. Clear DB
    await User.deleteMany({});

    // 4. Restore DB from backup
    const results = await systemService.importDatabase(backup);
    expect(results.users).toBe(1);

    // 5. Verify restored state
    const users = await User.find({});
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe('Simulated User');
  });
});
