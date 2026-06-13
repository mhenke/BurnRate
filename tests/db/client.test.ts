import { strict as assert } from 'node:assert';
import { describe, it, afterAll, beforeAll } from 'vitest';
import { initDb, getDb, closeDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { sql } from 'drizzle-orm';

describe('client and migration runner', () => {
  beforeAll(() => {
    initDb(':memory:');
  });

  afterAll(async () => {
    await closeDb();
  });

  it('initializes and returns a client', () => {
    const db = getDb();
    assert.ok(db, 'db should be initialized');
  });

  it('runs migrations successfully and registers tables', async () => {
    const db = getDb();
    
    // Run migrations
    await runMigrations(db);

    // Verify raw_reports table exists by querying sqlite_master
    const res = db.all(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='raw_reports'`) as Array<{ name: string }>;
    assert.equal(res[0]?.name, 'raw_reports');
  });
});
