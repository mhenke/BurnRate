import { strict as assert } from 'node:assert';
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { initDb, closeDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runObserveOnlyPipeline } from '../../src/etl/pipeline.js';
import { runClassify } from '../../src/classify/runner.js';
import { sql } from 'drizzle-orm';
import { dailyUsagePg } from '../../src/db/schema.js';

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
        usageDate: dateStr,
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
});
