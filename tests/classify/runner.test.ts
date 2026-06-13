import { strict as assert } from 'node:assert';
import { describe, it, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb, getDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runClassify } from '../../src/classify/runner.js';
import { sql } from 'drizzle-orm';
import { usersSq, dailyUsageSq, classificationHistorySq } from '../../src/db/schema.js';

describe('classify runner integration', () => {
  beforeAll(() => {
    initDb(':memory:');
    runMigrations(getDb());
  });

  afterAll(async () => {
    await closeDb();
  });

  it('throws error when daily_usage is empty', async () => {
    const db = getDb();
    await assert.rejects(
      () => runClassify(db, { valueConfigPath: 'config/value_config.sample.yml', reason: 'manual', showReport: false }),
      /No daily_usage data found/
    );
  });

  it('throws error when insufficient days of data', async () => {
    const db = getDb();
    // Insert only 5 days of data
    for (let day = 1; day <= 5; day++) {
      await db.insert(dailyUsageSq).values({ usageDate: `2026-06-0${day}`, githubLogin: 'user1', credits: '100', tokensInput: 0, tokensOutput: 0, chatRequests: 0, agentRequests: 0, acceptedLines: 0, suggestedLines: 0, acceptanceRate: '0', creditsPerAccLoc: '0' });
    }

    await assert.rejects(
      () => runClassify(db, { valueConfigPath: 'config/value_config.sample.yml', reason: 'manual', showReport: false }),
      /Insufficient data: only 5 distinct days found, need 30/
    );
  });

  it('classifies users and updates tiers in database', async () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    
    // Clear any existing data
    await db.delete(usersSq).run();
    await db.delete(dailyUsageSq).run();
    await db.delete(classificationHistorySq).run();

    // Insert 30 days of data for 3 users with different usage patterns
    for (let day = 0; day < 30; day++) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      const dateStr = date.toISOString().slice(0, 10);
      
      // High user: 1000 credits/day
      await db.insert(dailyUsageSq).values({ usageDate: dateStr, githubLogin: 'high-user', credits: '1000', tokensInput: 0, tokensOutput: 0, chatRequests: 0, agentRequests: 0, acceptedLines: 0, suggestedLines: 0, acceptanceRate: '0', creditsPerAccLoc: '0' });
      // Medium user: 100 credits/day
      await db.insert(dailyUsageSq).values({ usageDate: dateStr, githubLogin: 'medium-user', credits: '100', tokensInput: 0, tokensOutput: 0, chatRequests: 0, agentRequests: 0, acceptedLines: 0, suggestedLines: 0, acceptanceRate: '0', creditsPerAccLoc: '0' });
      // Low user: 10 credits/day
      await db.insert(dailyUsageSq).values({ usageDate: dateStr, githubLogin: 'low-user', credits: '10', tokensInput: 0, tokensOutput: 0, chatRequests: 0, agentRequests: 0, acceptedLines: 0, suggestedLines: 0, acceptanceRate: '0', creditsPerAccLoc: '0' });
    }

    // Insert users with null tiers
    await db.insert(usersSq).values({ githubLogin: 'high-user', enterprise: 'test', org: 'test', team: 'Platform', displayName: 'High User', email: null, employeeId: null, manager: null, seatCreatedAt: null, lastActivityAt: null, consumptionTier: null, valueTier: null, bucketUpdatedAt: null });
    await db.insert(usersSq).values({ githubLogin: 'medium-user', enterprise: 'test', org: 'test', team: 'Platform', displayName: 'Medium User', email: null, employeeId: null, manager: null, seatCreatedAt: null, lastActivityAt: null, consumptionTier: null, valueTier: null, bucketUpdatedAt: null });
    await db.insert(usersSq).values({ githubLogin: 'low-user', enterprise: 'test', org: 'test', team: 'Platform', displayName: 'Low User', email: null, employeeId: null, manager: null, seatCreatedAt: null, lastActivityAt: null, consumptionTier: null, valueTier: null, bucketUpdatedAt: null });

    // Run classification
    const result = await runClassify(db, { valueConfigPath: 'config/value_config.sample.yml', reason: 'manual', showReport: false });

    // Verify results
    assert.ok(result.totalUsers >= 3);
    assert.ok(result.changedUsers >= 3, `Expected at least 3 changed users, got ${result.changedUsers}`);

    // Verify tiers were updated in database
    const users = await db.select().from(usersSq).all();
    const highUser = users.find(u => u.githubLogin === 'high-user');
    const mediumUser = users.find(u => u.githubLogin === 'medium-user');
    const lowUser = users.find(u => u.githubLogin === 'low-user');

    assert.ok(highUser, 'high-user should exist');
    assert.ok(mediumUser, 'medium-user should exist');
    assert.ok(lowUser, 'low-user should exist');

    // Verify classification history was recorded
    const history = await db.select().from(classificationHistorySq).all();
    assert.ok(history.length >= 3, `Expected at least 3 history records, got ${history.length}`);
  });

  it('does not re-classify users with no changes', async () => {
    const db = getDb();
    
    // Run classification again - should have 0 changes since tiers already set
    const result = await runClassify(db, { valueConfigPath: 'config/value_config.sample.yml', reason: 'manual', showReport: false });

    assert.equal(result.changedUsers, 0, 'Should have 0 changes on second run');
  });
});
