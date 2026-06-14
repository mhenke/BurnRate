import { strict as assert } from 'node:assert';
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { initDb, closeDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runObserveOnlyPipeline } from '../../src/etl/pipeline.js';
import { runClassify } from '../../src/classify/runner.js';
import { runBudgetSync } from '../../src/budget/budget_sync.js';
import { sql, eq } from 'drizzle-orm';
import { dailyUsagePg, poolSnapshotsPg, budgetSnapshotsPg, notificationLogPg } from '../../src/db/schema.js';

const pgUrl = process.env.TEST_POSTGRES_URL;

describe('PostgreSQL Integration Test', () => {
  let db: any;

  beforeAll(async () => {
    if (!pgUrl) return;
    db = initDb(pgUrl);
    await runMigrations(db);
  });

  afterAll(async () => {
    if (db) {
      // Clean up test tables to avoid pollution
      await db.execute(sql`DROP TABLE IF EXISTS raw_reports CASCADE`);
      await db.execute(sql`DROP TABLE IF EXISTS users CASCADE`);
      await db.execute(sql`DROP TABLE IF EXISTS daily_usage CASCADE`);
      await db.execute(sql`DROP TABLE IF EXISTS team_usage CASCADE`);
      await db.execute(sql`DROP TABLE IF EXISTS pool_snapshots CASCADE`);
      await db.execute(sql`DROP TABLE IF EXISTS classification_history CASCADE`);
      await db.execute(sql`DROP TABLE IF EXISTS budget_snapshots CASCADE`);
      await db.execute(sql`DROP TABLE IF EXISTS notification_log CASCADE`);
      await closeDb();
    }
  });

  it('runs database operations against PostgreSQL', { skip: !pgUrl }, async () => {
    // 1. Verify schema tables registered
    const res = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'raw_reports'
    `);
    assert.equal(res.rows[0]?.table_name, 'raw_reports');

    // 2. Mock API payloads for the pipeline
    const mockUserReport = {
      report_day: '2026-06-12',
      data: [{ github_login: 'postgres-user', credits_used: 150 }]
    };
    const mockEnterpriseReport = {
      report_day: '2026-06-12',
      data: [{ github_login: 'postgres-user', display_name: 'Postgres User', seat_created_at: '2026-01-01T00:00:00Z' }]
    };
    const mockTeamReport = {
      report_day: '2026-06-12',
      data: [
        { team: 'platform', credits_used: 150, active_users: 1, avg_acceptance_rate: 0.5 },
        { github_login: 'postgres-user', team: 'platform' }
      ]
    };

    const requestMock = vi.fn().mockImplementation((endpoint: string) => {
      if (endpoint.includes('users-1-day')) {
        return Promise.resolve({ data: { download_links: ['https://example.com/users-link'] } });
      }
      if (endpoint.includes('enterprise-1-day')) {
        return Promise.resolve({ data: { download_links: ['https://example.com/ent-link'] } });
      }
      if (endpoint.includes('enterprise-user-teams-1-day')) {
        return Promise.resolve({ data: { download_links: ['https://example.com/team-link'] } });
      }
      return Promise.resolve({ data: { download_links: [] } });
    });

    const iteratorMock = {
      async *[Symbol.asyncIterator]() {
        yield {
          data: {
            seats: [
              {
                assignee: { login: 'postgres-user' },
                created_at: '2026-01-01T00:00:00Z',
                last_activity_at: '2026-06-12T12:00:00Z'
              }
            ]
          }
        };
      }
    };
    const paginateMock = {
      iterator: vi.fn().mockReturnValue(iteratorMock)
    };

    const fetchSignedUrlMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('users-link')) return Promise.resolve(mockUserReport);
      if (url.includes('ent-link')) return Promise.resolve(mockEnterpriseReport);
      if (url.includes('team-link')) return Promise.resolve(mockTeamReport);
      return Promise.resolve({});
    });

    const ghClientMock: any = {
      octokit: {
        request: requestMock,
        paginate: paginateMock,
        rest: {
          enterpriseAdmin: {
            listCopilotSeatsForEnterprise: {}
          }
        }
      },
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: fetchSignedUrlMock
    };

    // Run observation ETL pipeline against Postgres
    const pipelineResult = await runObserveOnlyPipeline(ghClientMock, db, '2026-06-12');
    assert.ok(pipelineResult.rawStored >= 3);
    assert.ok(pipelineResult.usageUpserted >= 1);

    // Verify raw reports were stored in postgres
    const rawsRes = await db.execute(sql`SELECT report_type, report_day FROM raw_reports`);
    const raws = rawsRes.rows;
    assert.ok(raws.some((r: any) => r.report_type === 'users-1-day'));

    // Verify user was upserted in postgres
    const usersRes = await db.execute(sql`SELECT github_login, team FROM users`);
    const users = usersRes.rows;
    assert.equal(users[0]?.github_login, 'postgres-user');
    assert.equal(users[0]?.team, 'platform');

    // 3. Verify PostgreSQL classification updates & transactional writes
    // Seed enough daily usage data to pass the 30-day distinct count requirement
    for (let day = 0; day < 30; day++) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      const dateStr = date.toISOString().slice(0, 10);
      await db.insert(dailyUsagePg).values({
        usageDate: new Date(dateStr),
        githubLogin: 'postgres-user',
        credits: '100',
        tokensInput: 0n,
        tokensOutput: 0n,
      }).onConflictDoNothing().execute();
    }

    // Run classification command
    const classifyResult = await runClassify(db, {
      valueConfigPath: 'config/value_config.sample.yml',
      reason: 'manual',
      showReport: false
    });
    assert.ok(classifyResult.totalUsers >= 1);
  });

  it('runs budget sync pipeline against PostgreSQL', { skip: !pgUrl }, async () => {
    // 1. Seed pool_snapshots in postgres
    const todayStr = new Date().toISOString().slice(0, 10);
    await db.insert(poolSnapshotsPg).values({
      snapshotDate: new Date(todayStr),
      totalCredits: '10000.00',
      creditsUsed: '5000.00',
      creditsRemaining: '5000.00',
      forecast7d: '9500.00',
      forecast30d: '9200.00',
      pctElapsed: '50.0000',
    }).onConflictDoNothing().execute();

    // 2. Mock GitHub client returning credit usage
    const mockUsageData = {
      timePeriod: { year: 2026, month: 6 },
      organization: 'acme-inc',
      usageItems: [
        {
          product: 'Copilot',
          sku: 'Copilot AI Credits',
          netAmount: 5500,
        }
      ]
    };

    const octokitMock = {
      request: vi.fn().mockResolvedValue({ data: mockUsageData }),
    };

    const ghClientMock: any = {
      octokit: octokitMock,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async () => ({})
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ number: 999, html_url: 'https://github.com/test' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // Seed a yesterday budget snapshot so we transition from ok to warning
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);
    await db.insert(budgetSnapshotsPg).values({
      snapshotDate: new Date(yesterdayStr),
      totalBudget: '10000.00',
      budgetUsed: '4000.00',
      budgetRemaining: '6000.00',
      pctUsed: '40.0000',
      pctElapsed: '46.0000',
      forecast7d: '8500.00',
      forecast30d: '8200.00',
      pctOfBudget7d: '85.0000',
      pctOfBudget30d: '82.0000',
      alertLevel: 'ok',
      notified: false,
      source: 'pool_fallback',
    }).onConflictDoNothing().execute();

    // 3. Call runBudgetSync with postgres db
    const syncResult = await runBudgetSync({
      db,
      github: ghClientMock,
      slackWebhookUrl: 'https://hooks.slack.com/services/test',
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    });

    // 4. Verify it inserts budget_snapshots and logs notifications in postgres
    assert.equal(syncResult.alertLevel, 'warning'); // 95% forecast7d >= 90% is warning
    assert.equal(syncResult.slackNotified, true);
    assert.equal(syncResult.issueNotified, true);

    const snapshots = await db.select().from(budgetSnapshotsPg).where(eq(budgetSnapshotsPg.snapshotDate, todayStr));
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].alertLevel, 'warning');

    const logs = await db.select().from(notificationLogPg).where(eq(notificationLogPg.snapshotDate, todayStr));
    assert.ok(logs.length >= 2); // Slack and GitHub Issue
    assert.equal(logs[0].success, true);

    vi.unstubAllGlobals();
  });
});
