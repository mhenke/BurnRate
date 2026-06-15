import { strict as assert } from 'node:assert';
import { describe, it, vi } from 'vitest';
import { main } from '../src/index.js';
import * as configModule from '../src/config.js';
import * as githubModule from '../src/github/client.js';
import * as pipelineModule from '../src/etl/pipeline.js';
import * as classifyModule from '../src/classify/runner.js';
import * as budgetModule from '../src/budget/budget_sync.js';
import * as dbClientModule from '../src/db/client.js';
const { initDb, closeDb } = dbClientModule;
import { runMigrations } from '../src/db/migrate.js';
import { sql } from 'drizzle-orm';

describe('CLI entrypoint', () => {
  it('exports main function', () => {
    assert.equal(typeof main, 'function');
  });

  it('handles the check command', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['node', 'src/index.js', 'check']);
    assert.ok(logSpy.mock.calls.some(call => call[0].includes('Config check: OK')));
    logSpy.mockRestore();
  });

  it('throws on unknown commands', async () => {
    await assert.rejects(
      () => main(['node', 'src/index.js', 'invalid-command-xyz']),
      /Unknown command/
    );
  });

  it('runs the etl command', async () => {
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockReturnValue({
      github: { enterprise: 'acme', org: 'acme-inc', token: 'fake' },
      postgres: { url: ':memory:' }
    });

    const ghClientMock: any = { enterprise: 'acme', org: 'acme-inc' };
    const createGhClientSpy = vi.spyOn(githubModule, 'createGitHubClient').mockReturnValue(ghClientMock);

    const pipelineSpy = vi.spyOn(pipelineModule, 'runObserveOnlyPipeline').mockResolvedValue({
      rawStored: 5,
      usageUpserted: 2,
      errors: [],
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await main(['node', 'src/index.js', 'etl']);

    assert.ok(logSpy.mock.calls.some(call => call[0].includes('ETL complete: 5 raw reports stored')));

    loadConfigSpy.mockRestore();
    createGhClientSpy.mockRestore();
    pipelineSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('runs the forecast command', async () => {
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockReturnValue({
      github: { enterprise: 'acme', org: 'acme-inc', token: 'fake' },
      postgres: { url: ':memory:' }
    });

    // Set up in-memory DB and seed
    const db = initDb(':memory:');
    await runMigrations(db);

    const initDbSpy = vi.spyOn(dbClientModule, 'initDb').mockReturnValue(db);

    await db.run(sql`INSERT INTO daily_usage (usage_date, github_login, credits) VALUES ('2026-06-12', 'jdoe', '100')`);
    await db.run(sql`INSERT INTO pool_snapshots (snapshot_date, total_credits, credits_used, credits_remaining) VALUES ('2026-06-12', '10000', '5000', '5000')`);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await main(['node', 'src/index.js', 'forecast']);

    assert.ok(logSpy.mock.calls.length > 0);
    const printed = JSON.parse(logSpy.mock.calls[0][0]);
    assert.equal(printed.rate7d, 100);
    assert.equal(printed.alertLevel, 'ok');

    await closeDb();
    initDbSpy.mockRestore();
    loadConfigSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('runs the forecast command and aligns daysElapsed with the last available record date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));

    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockReturnValue({
      github: { enterprise: 'acme', org: 'acme-inc', token: 'fake' },
      postgres: { url: ':memory:' }
    });

    const db = initDb(':memory:');
    await runMigrations(db);

    const initDbSpy = vi.spyOn(dbClientModule, 'initDb').mockReturnValue(db);

    await db.run(sql`INSERT INTO daily_usage (usage_date, github_login, credits) VALUES ('2026-06-12', 'jdoe', '100')`);
    await db.run(sql`INSERT INTO pool_snapshots (snapshot_date, total_credits, credits_used, credits_remaining) VALUES ('2026-06-12', '10000', '5000', '5000')`);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await main(['node', 'src/index.js', 'forecast']);

    assert.ok(logSpy.mock.calls.length > 0);
    const printed = JSON.parse(logSpy.mock.calls[0][0]);
    // The last available record is June 12, so daysElapsed should be 12 instead of 15.
    // daysInMonth is 30.
    // remainingDays = 30 - 12 = 18.
    // creditsUsedMtd = 100.
    // rate7d = 100.
    // forecast7d = 100 + 100 * 18 = 1900.
    assert.equal(printed.forecast7d, 1900);

    await closeDb();
    initDbSpy.mockRestore();
    loadConfigSpy.mockRestore();
    logSpy.mockRestore();
    vi.useRealTimers();
  });


  it('routes the classify command with flags', async () => {
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockReturnValue({
      github: { enterprise: 'acme', org: 'acme-inc', token: 'fake' },
      postgres: { url: ':memory:' }
    });
    const classifySpy = vi.spyOn(classifyModule, 'runClassify').mockResolvedValue({
      totalUsers: 1,
      changedUsers: 0,
      missingTeamCount: 0,
      tierCounts: { low: 0, medium: 1, high: 0, extreme: 0 },
    });

    await main(['node', 'src/index.ts', 'classify', '--report']);

    assert.equal(classifySpy.mock.calls[0]?.[1].showReport, true);
    classifySpy.mockRestore();
    loadConfigSpy.mockRestore();
  });

  it('routes the budget-sync command with flags', async () => {
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockReturnValue({
      github: { enterprise: 'acme', org: 'acme-inc', token: 'fake' },
      postgres: { url: ':memory:' }
    });
    const budgetSyncSpy = vi.spyOn(budgetModule, 'runBudgetSync').mockResolvedValue({
      snapshotDate: '2026-06-13',
      totalBudget: 10000,
      budgetUsed: 5000,
      pctUsed: 50,
      pctOfBudget7d: 55,
      pctOfBudget30d: 52,
      alertLevel: 'ok',
      notificationsDispatched: 0,
      errors: [],
    });

    await main(['node', 'src/index.ts', 'budget-sync', '--dry-run', '--json-logs']);

    assert.equal(budgetSyncSpy.mock.calls[0]?.[0].dryRun, true);
    budgetSyncSpy.mockRestore();
    loadConfigSpy.mockRestore();
  });
});
