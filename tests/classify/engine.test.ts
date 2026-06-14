import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { classifyUsers } from '../../src/classify/engine.js';
import { loadValueConfig } from '../../src/classify/value_config.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createTestConfig() {
  const dir = mkdtempSync(join(tmpdir(), 'burnrate-'));
  const file = join(dir, 'value_config.yml');
  writeFileSync(
    file,
    `critical:\n  teams:\n    - platform\nnormal:\n  teams:\n    - product\nlow_priority:\n  teams:\n    - marketing\n`,
    'utf8',
  );
  return loadValueConfig(file);
}

describe('classify engine', () => {
  it('assigns percentile-based consumption tiers', () => {
    const config = createTestConfig();
    const userCredits = [
      { githubLogin: 'user1', totalCredits: 10 },
      { githubLogin: 'user2', totalCredits: 20 },
      { githubLogin: 'user3', totalCredits: 30 },
      { githubLogin: 'user4', totalCredits: 40 },
    ];
    const currentUsers = userCredits.map(u => ({
      githubLogin: u.githubLogin,
      team: 'platform',
      consumptionTier: null,
      valueTier: null,
      bucketUpdatedAt: null,
    }));

    const result = classifyUsers(userCredits, currentUsers, config, 'manual');

    assert.equal(result.stats.totalUsers, 4);
    assert.equal(result.stats.changedUsers, 4);
    // With credits [10,20,30,40]: percentiles are 0.25, 0.50, 0.75, 1.00
    // Which maps to: medium, medium, high, extreme
    assert.equal(result.stats.tierCounts.medium, 2);
    assert.equal(result.stats.tierCounts.high, 1);
    assert.equal(result.stats.tierCounts.extreme, 1);
  });

  it('assigns all to medium when fewer than 4 users', () => {
    const config = createTestConfig();
    const userCredits = [
      { githubLogin: 'user1', totalCredits: 10 },
      { githubLogin: 'user2', totalCredits: 20 },
      { githubLogin: 'user3', totalCredits: 30 },
    ];
    const currentUsers = userCredits.map(u => ({
      githubLogin: u.githubLogin,
      team: 'platform',
      consumptionTier: null,
      valueTier: null,
      bucketUpdatedAt: null,
    }));

    const result = classifyUsers(userCredits, currentUsers, config, 'manual');

    assert.equal(result.stats.totalUsers, 3);
    assert.equal(result.stats.tierCounts.medium, 3);
    assert.equal(result.stats.tierCounts.low, 0);
    assert.equal(result.stats.tierCounts.high, 0);
    assert.equal(result.stats.tierCounts.extreme, 0);
  });

  it('defaults missing team to normal value tier', () => {
    const config = createTestConfig();
    const userCredits = [
      { githubLogin: 'user1', totalCredits: 10 },
      { githubLogin: 'user2', totalCredits: 20 },
      { githubLogin: 'user3', totalCredits: 30 },
      { githubLogin: 'user4', totalCredits: 40 },
    ];
    const currentUsers = userCredits.map(u => ({
      githubLogin: u.githubLogin,
      team: null,
      consumptionTier: null,
      valueTier: null,
      bucketUpdatedAt: null,
    }));

    const result = classifyUsers(userCredits, currentUsers, config, 'manual');

    assert.equal(result.stats.missingTeamCount, 4);
    // All should have valueTier 'normal'
    for (const change of result.changes) {
      assert.equal(change.valueTierNew, 'normal');
    }
  });

  it('only includes users with changed tiers in changes array', () => {
    const config = createTestConfig();
    const userCredits = [
      { githubLogin: 'user1', totalCredits: 10 },
      { githubLogin: 'user2', totalCredits: 20 },
      { githubLogin: 'user3', totalCredits: 30 },
      { githubLogin: 'user4', totalCredits: 40 },
    ];
    // Pre-populate with same tiers that the classifier would assign
    // Percentiles: 0.25 (medium), 0.50 (medium), 0.75 (high), 1.00 (extreme)
    const currentUsers = [
      { githubLogin: 'user1', team: 'platform', consumptionTier: 'medium', valueTier: 'critical', bucketUpdatedAt: '2026-06-01' },
      { githubLogin: 'user2', team: 'platform', consumptionTier: 'medium', valueTier: 'critical', bucketUpdatedAt: '2026-06-01' },
      { githubLogin: 'user3', team: 'platform', consumptionTier: 'high', valueTier: 'critical', bucketUpdatedAt: '2026-06-01' },
      { githubLogin: 'user4', team: 'platform', consumptionTier: 'extreme', valueTier: 'critical', bucketUpdatedAt: '2026-06-01' },
    ];

    const result = classifyUsers(userCredits, currentUsers, config, 'manual');

    // No changes expected since tiers match
    assert.equal(result.stats.changedUsers, 0);
    assert.equal(result.changes.length, 0);
  });

  it('executes classification efficiently under high scale (10,000 users)', () => {
    const config = createTestConfig();
    const userCount = 10000;
    const userCredits = Array.from({ length: userCount }, (_, i) => ({
      githubLogin: `user-${i}`,
      totalCredits: Math.floor(Math.random() * 1000),
    }));
    const currentUsers = userCredits.map(u => ({
      githubLogin: u.githubLogin,
      team: null,
      consumptionTier: null,
      valueTier: null,
      bucketUpdatedAt: null,
    }));

    const start = performance.now();
    const result = classifyUsers(userCredits, currentUsers, config, 'scale_test');
    const duration = performance.now() - start;

    assert.equal(result.stats.totalUsers, userCount);
    // Ensure classification takes less than 150ms
    assert.ok(duration < 150, `Scale classification took too long: ${duration.toFixed(2)}ms`);
  });
});
