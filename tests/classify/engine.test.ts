import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { classifyUsers } from '../../src/classify/engine.js';

describe('classify engine', () => {
  it('assigns percentile-based consumption tiers', () => {
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
      bucketUpdatedAt: null,
    }));

    const result = classifyUsers(userCredits, currentUsers, 'manual');

    assert.equal(result.stats.totalUsers, 4);
    assert.equal(result.stats.changedUsers, 4);
    assert.equal(result.stats.tierCounts.medium, 2);
    assert.equal(result.stats.tierCounts.high, 1);
    assert.equal(result.stats.tierCounts.extreme, 1);
  });

  it('assigns all to medium when fewer than 4 users', () => {
    const userCredits = [
      { githubLogin: 'user1', totalCredits: 10 },
      { githubLogin: 'user2', totalCredits: 20 },
      { githubLogin: 'user3', totalCredits: 30 },
    ];
    const currentUsers = userCredits.map(u => ({
      githubLogin: u.githubLogin,
      team: 'platform',
      consumptionTier: null,
      bucketUpdatedAt: null,
    }));

    const result = classifyUsers(userCredits, currentUsers, 'manual');

    assert.equal(result.stats.totalUsers, 3);
    assert.equal(result.stats.tierCounts.medium, 3);
    assert.equal(result.stats.tierCounts.low, 0);
    assert.equal(result.stats.tierCounts.high, 0);
    assert.equal(result.stats.tierCounts.extreme, 0);
  });

  it('only includes users with changed tiers in changes array', () => {
    const userCredits = [
      { githubLogin: 'user1', totalCredits: 10 },
      { githubLogin: 'user2', totalCredits: 20 },
      { githubLogin: 'user3', totalCredits: 30 },
      { githubLogin: 'user4', totalCredits: 40 },
    ];
    const currentUsers = [
      { githubLogin: 'user1', team: 'platform', consumptionTier: 'medium', bucketUpdatedAt: '2026-06-01' },
      { githubLogin: 'user2', team: 'platform', consumptionTier: 'medium', bucketUpdatedAt: '2026-06-01' },
      { githubLogin: 'user3', team: 'platform', consumptionTier: 'high', bucketUpdatedAt: '2026-06-01' },
      { githubLogin: 'user4', team: 'platform', consumptionTier: 'extreme', bucketUpdatedAt: '2026-06-01' },
    ];

    const result = classifyUsers(userCredits, currentUsers, 'manual');

    assert.equal(result.stats.changedUsers, 0);
    assert.equal(result.changes.length, 0);
  });

  it('executes classification efficiently under high scale (10,000 users)', () => {
    const userCount = 10000;
    const userCredits = Array.from({ length: userCount }, (_, i) => ({
      githubLogin: `user-${i}`,
      totalCredits: Math.floor(Math.random() * 1000),
    }));
    const currentUsers = userCredits.map(u => ({
      githubLogin: u.githubLogin,
      team: null,
      consumptionTier: null,
      bucketUpdatedAt: null,
    }));

    const start = performance.now();
    const result = classifyUsers(userCredits, currentUsers, 'scale_test');
    const duration = performance.now() - start;

    assert.equal(result.stats.totalUsers, userCount);
    assert.ok(duration < 150, `Scale classification took too long: ${duration.toFixed(2)}ms`);
  });
});
