import { strict as assert } from 'node:assert';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runEnforce } from '../../src/enforce/runner.js';
import { DEFAULT_BUDGET_POLICY } from '../../src/enforce/types.js';
import { poolSnapshotsSq, dailyUsageSq, usersSq, ulbAuditSq } from '../../src/db/schema.js';

describe('enforce runner integration', () => {
  beforeAll(async () => {
    initDb(':memory:');
    await runMigrations(getDb());
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.delete(ulbAuditSq).run();
    await db.delete(dailyUsageSq).run();
    await db.delete(usersSq).run();
    await db.delete(poolSnapshotsSq).run();
  });

  it('throws when no pool_snapshots data exists', async () => {
    const db = getDb();
    await assert.rejects(
      () => runEnforce(db, DEFAULT_BUDGET_POLICY, { reason: 'manual', dryRun: false }),
      /No pool_snapshots data found/,
    );
  });

  it('throws when pool_snapshots data is stale', async () => {
    const db = getDb();
    // Insert a snapshot from 5 days ago (stale)
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 5);
    const staleDateStr = staleDate.toISOString().slice(0, 10);

    await db.insert(poolSnapshotsSq).values({
      snapshotDate: staleDateStr,
      totalCredits: '100000',
      creditsUsed: '50000',
      creditsRemaining: '50000',
    });

    await assert.rejects(
      () => runEnforce(db, DEFAULT_BUDGET_POLICY, { reason: 'manual', dryRun: false }),
      /stale/,
    );
  });

  it('throws when no daily_usage data exists', async () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(poolSnapshotsSq).values({
      snapshotDate: today,
      totalCredits: '100000',
      creditsUsed: '50000',
      creditsRemaining: '50000',
    });

    await assert.rejects(
      () => runEnforce(db, DEFAULT_BUDGET_POLICY, { reason: 'manual', dryRun: false }),
      /No daily_usage data found/,
    );
  });

  it('writes ulb_audit records on throttle', async () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    await db.insert(poolSnapshotsSq).values({
      snapshotDate: today,
      totalCredits: '100000',
      creditsUsed: '80000',
      creditsRemaining: '20000',
    });

    for (let day = 0; day < 30; day++) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      const dateStr = date.toISOString().slice(0, 10);
      await db.insert(dailyUsageSq).values({
        usageDate: dateStr, githubLogin: 'heavy-user', credits: '2000',
        tokensInput: 0, tokensOutput: 0, chatRequests: 0, agentRequests: 0,
        acceptedLines: 0, suggestedLines: 0, acceptanceRate: '0', creditsPerAccLoc: '0',
        modelBreakdown: '{}', ideBreakdown: '{}', languageBreakdown: '{}',
      });
    }

    await db.insert(usersSq).values({
      githubLogin: 'heavy-user', enterprise: 'test', org: 'test',
      team: 'Platform', displayName: 'Heavy User',
      consumptionTier: 'extreme', email: null, employeeId: null,
      manager: null, seatCreatedAt: null, lastActivityAt: null,
      bucketUpdatedAt: null,
    });

    const result = await runEnforce(db, DEFAULT_BUDGET_POLICY, {
      reason: 'manual', dryRun: false,
    });

    assert.equal(result.action, 'throttle');
    assert.ok(result.changes.length > 0);

    const auditRows = await db.select().from(ulbAuditSq).all();
    assert.ok(auditRows.length > 0, 'Should write audit records');
  });

  it('does not write when dryRun is true', async () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    await db.insert(poolSnapshotsSq).values({
      snapshotDate: today,
      totalCredits: '100000',
      creditsUsed: '80000',
      creditsRemaining: '20000',
    });

    for (let day = 0; day < 30; day++) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      const dateStr = date.toISOString().slice(0, 10);
      await db.insert(dailyUsageSq).values({
        usageDate: dateStr, githubLogin: 'heavy-user', credits: '2000',
        tokensInput: 0, tokensOutput: 0, chatRequests: 0, agentRequests: 0,
        acceptedLines: 0, suggestedLines: 0, acceptanceRate: '0', creditsPerAccLoc: '0',
        modelBreakdown: '{}', ideBreakdown: '{}', languageBreakdown: '{}',
      });
    }

    await db.insert(usersSq).values({
      githubLogin: 'heavy-user', enterprise: 'test', org: 'test',
      team: 'Platform', displayName: 'Heavy User',
      consumptionTier: 'extreme', email: null, employeeId: null,
      manager: null, seatCreatedAt: null, lastActivityAt: null,
      bucketUpdatedAt: null,
    });

    await runEnforce(db, DEFAULT_BUDGET_POLICY, { reason: 'manual', dryRun: true });

    const auditRows = await db.select().from(ulbAuditSq).all();
    assert.equal(auditRows.length, 0, 'Should not write audit records in dry run');
  });

  // Finding #14: Edge case — null tier defaults to medium
  it('defaults null consumption tier to medium', async () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    await db.insert(poolSnapshotsSq).values({
      snapshotDate: today,
      totalCredits: '100000',
      creditsUsed: '10000',
      creditsRemaining: '90000',
    });

    for (let day = 0; day < 30; day++) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      const dateStr = date.toISOString().slice(0, 10);
      await db.insert(dailyUsageSq).values({
        usageDate: dateStr, githubLogin: 'null-tier-user', credits: '500',
        tokensInput: 0, tokensOutput: 0, chatRequests: 0, agentRequests: 0,
        acceptedLines: 0, suggestedLines: 0, acceptanceRate: '0', creditsPerAccLoc: '0',
        modelBreakdown: '{}', ideBreakdown: '{}', languageBreakdown: '{}',
      });
    }

    await db.insert(usersSq).values({
      githubLogin: 'null-tier-user', enterprise: 'test', org: 'test',
      team: 'Platform', displayName: 'Null Tier User',
      consumptionTier: null, email: null, employeeId: null,
      manager: null, seatCreatedAt: null, lastActivityAt: null,
      bucketUpdatedAt: null,
    });

    const result = await runEnforce(db, DEFAULT_BUDGET_POLICY, {
      reason: 'manual', dryRun: false,
    });

    // Should not crash, should produce valid result
    assert.ok(!Number.isNaN(result.projectedEom));
    assert.ok(!Number.isNaN(result.gap));
  });
});
