import { strict as assert } from 'node:assert';
import { describe, it, vi } from 'vitest';
import { main } from '../src/index.js';
import * as configModule from '../src/config.js';
import * as githubModule from '../src/github/client.js';
import * as pipelineModule from '../src/etl/pipeline.js';
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
      usageUpserted: 2
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
});
