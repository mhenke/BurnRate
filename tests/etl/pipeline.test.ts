import { strict as assert } from 'node:assert';
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { initDb, getDb, closeDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runObserveOnlyPipeline } from '../../src/etl/pipeline.js';
import { sql } from 'drizzle-orm';

describe('ETL pipeline orchestration', () => {
  beforeAll(async () => {
    const db = initDb(':memory:');
    await runMigrations(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  it('runs the observe-only pipeline, fetching and upserting data', async () => {
    const db = getDb();

    // Mock API payloads
    const mockUserReport = {
      report_day: '2026-06-12',
      data: [{ github_login: 'jdoe', credits_used: 150 }]
    };
    const mockEnterpriseReport = {
      report_day: '2026-06-12',
      data: [{ github_login: 'jdoe', display_name: 'John Doe', seat_created_at: '2026-01-01T00:00:00Z' }]
    };
    const mockTeamReport = {
      report_day: '2026-06-12',
      data: [{ team: 'platform', credits_used: 150 }]
    };

    // Octokit Mock
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
                assignee: { login: 'jdoe' },
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

    const result = await runObserveOnlyPipeline(ghClientMock, db, '2026-06-12');

    // Verify pipeline stats
    assert.ok(result.rawStored >= 3);
    assert.ok(result.usageUpserted >= 1);

    // Verify raw reports were stored
    const raws = db.all(sql`SELECT report_type, report_day FROM raw_reports`) as any[];
    assert.ok(raws.some((r: any) => r.report_type === 'users-1-day'));
    assert.ok(raws.some((r: any) => r.report_type === 'enterprise-1-day'));
    assert.ok(raws.some((r: any) => r.report_type === 'enterprise-user-teams-1-day'));
    assert.ok(raws.some((r: any) => r.report_type === 'seats'));

    // Verify user was upserted
    const users = db.all(sql`SELECT github_login, seat_created_at FROM users`) as any[];
    assert.equal(users.length, 1);
    assert.equal(users[0].github_login, 'jdoe');
    assert.ok(users[0].seat_created_at);

    // Verify daily usage was upserted
    const usage = db.all(sql`SELECT github_login, credits FROM daily_usage`) as any[];
    assert.equal(usage.length, 1);
    assert.equal(usage[0].github_login, 'jdoe');
    assert.equal(String(usage[0].credits), '150');

    // Verify team usage was upserted
    const teamUsage = db.all(sql`SELECT team, credits FROM team_usage`) as any[];
    assert.equal(teamUsage.length, 1);
    assert.equal(teamUsage[0].team, 'platform');
    assert.equal(String(teamUsage[0].credits), '150');
  });
});
