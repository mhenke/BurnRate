import { describe, it, vi, beforeEach, afterEach } from 'vitest';
import { strict as assert } from 'node:assert';
import { runBudgetSync, type BudgetSyncConfig } from '../../src/budget/budget_sync.js';
import type { GitHubClient } from '../../src/github/client.js';
import { initDb, closeDb, getDb } from '../../src/db/client.js';
import {
  budgetSnapshotsSq,
  poolSnapshotsSq,
  notificationLogSq,
} from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

let testPoolSnapshot: any = null;

function createMockGitHubClient(overrides?: { budget_used?: number }): GitHubClient {
  const budgetUsed = overrides?.budget_used ?? 7500;

  const octokitMock = {
    request: vi.fn().mockResolvedValue({
      data: {
        timePeriod: { year: 2026, month: 6 },
        organization: 'acme-inc',
        usageItems: [
          {
            product: 'Copilot',
            sku: 'Copilot AI Credits',
            netAmount: budgetUsed,
          }
        ]
      },
    }),
  };

  return {
    octokit: octokitMock as any,
    enterprise: 'acme',
    org: 'acme-inc',
    fetchSignedUrl: async <T>() => ({}) as T,
  };
}

function createMockDb() {
  const mockInsert = {
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    }),
  };

  const mockSelect = {
    from: vi.fn().mockImplementation((table: any) => {
      if (table === poolSnapshotsSq) {
        return {
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(testPoolSnapshot ? [testPoolSnapshot] : []),
          }),
        };
      }
      return {
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      };
    }),
  };

  return {
    insert: vi.fn().mockReturnValue(mockInsert),
    select: vi.fn().mockReturnValue(mockSelect),
    run: vi.fn(),
    isSqlite: true,
    constructor: {
      name: 'BaseSQLiteDatabase',
    },
  };
}

describe('runBudgetSync', () => {
  let db: any;
  let github: GitHubClient;

  beforeEach(() => {
    testPoolSnapshot = {
      totalCredits: '10000',
      creditsUsed: '7500',
      forecast7d: '8500',
      forecast30d: '9500',
    };
    db = createMockDb();
    github = createMockGitHubClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches budget data and computes metrics', async () => {
    const config: BudgetSyncConfig = {
      db,
      github,
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.equal(result.snapshotDate, new Date().toISOString().split('T')[0]);
    assert.equal(result.totalBudget, 10000);
    assert.equal(result.budgetUsed, 7500);
    assert.ok(result.pctUsed >= 0);
    assert.equal(result.alertLevel, 'warning'); // max of 85% (7d) and 95% (30d) is 95% which is warning
  });

  it('uses pool_snapshots fallback when API fails', async () => {
    const failingGithub: GitHubClient = {
      octokit: {
        request: vi.fn().mockRejectedValue(new Error('API error')),
      },
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    testPoolSnapshot = {
      totalCredits: '9000',
      creditsUsed: '6000',
      forecast7d: '9000',
      forecast30d: '9500',
    };

    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: any) => {
        if (table === poolSnapshotsSq) {
          return {
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([testPoolSnapshot]),
            }),
          };
        }
        return {
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        };
      }),
    }));

    const config: BudgetSyncConfig = {
      db,
      github: failingGithub,
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.equal(result.totalBudget, 9000);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].includes('API error'));
  });

  it('handles empty pool_snapshots table', async () => {
    const failingGithub: GitHubClient = {
      octokit: {
        request: vi.fn().mockRejectedValue(new Error('API error')),
      },
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    testPoolSnapshot = null;

    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      })),
    }));

    const config: BudgetSyncConfig = {
      db,
      github: failingGithub,
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.equal(result.totalBudget, 0);
    assert.equal(result.budgetUsed, 0);
    assert.equal(result.pctOfBudget7d, null);
    assert.equal(result.pctOfBudget30d, null);
    assert.equal(result.alertLevel, 'ok');
  });

  it('computes alert_level as critical when pct_of_budget >= 110', async () => {
    github = createMockGitHubClient({ budget_used: 7500 });
    testPoolSnapshot = {
      totalCredits: '10000',
      creditsUsed: '7500',
      forecast7d: '11500',
      forecast30d: '11200',
    };

    const config: BudgetSyncConfig = {
      db,
      github,
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.equal(result.alertLevel, 'critical');
  });

  it('computes alert_level as escalation when pct_of_budget >= 100', async () => {
    github = createMockGitHubClient({ budget_used: 7500 });
    testPoolSnapshot = {
      totalCredits: '10000',
      creditsUsed: '7500',
      forecast7d: '10500',
      forecast30d: '10200',
    };

    const config: BudgetSyncConfig = {
      db,
      github,
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.equal(result.alertLevel, 'escalation');
  });

  it('computes alert_level as warning when pct_of_budget >= 90', async () => {
    github = createMockGitHubClient({ budget_used: 7500 });
    testPoolSnapshot = {
      totalCredits: '10000',
      creditsUsed: '7500',
      forecast7d: '9500',
      forecast30d: '9200',
    };

    const config: BudgetSyncConfig = {
      db,
      github,
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.equal(result.alertLevel, 'warning');
  });

  it('computes alert_level as ok when pct_of_budget < 90', async () => {
    github = createMockGitHubClient({ budget_used: 7500 });
    testPoolSnapshot = {
      totalCredits: '10000',
      creditsUsed: '7500',
      forecast7d: '8500',
      forecast30d: '8800',
    };

    const config: BudgetSyncConfig = {
      db,
      github,
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.equal(result.alertLevel, 'ok');
  });

  it('does not notify when alert_level is unchanged from yesterday', async () => {
    testPoolSnapshot = {
      totalCredits: '10000',
      creditsUsed: '7500',
      forecast7d: '9500',
      forecast30d: '9200',
    };

    db.select = vi.fn().mockImplementation((fields: any) => {
      const mockSelect = {
        from: vi.fn().mockImplementation((table: any) => {
          if (table === poolSnapshotsSq) {
            return {
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([testPoolSnapshot]),
              }),
            };
          } else if (table === budgetSnapshotsSq) {
            return {
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  { snapshotDate: '2026-06-12', alertLevel: 'warning' },
                ]),
              }),
            };
          }
          return {
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          };
        }),
      };
      return mockSelect;
    });

    const config: BudgetSyncConfig = {
      db,
      github,
      slackWebhookUrl: 'https://hooks.slack.com/test',
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    vi.stubGlobal('fetch', mockFetch);

    const result = await runBudgetSync(config);

    assert.equal(result.slackNotified, false);
    assert.equal(result.issueNotified, false);

    vi.unstubAllGlobals();
  });

  it('notifies when alert_level changes from yesterday', async () => {
    testPoolSnapshot = {
      totalCredits: '10000',
      creditsUsed: '7500',
      forecast7d: '9500',
      forecast30d: '9200',
    };

    db.select = vi.fn().mockImplementation((fields: any) => {
      const mockSelect = {
        from: vi.fn().mockImplementation((table: any) => {
          if (table === poolSnapshotsSq) {
            return {
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([testPoolSnapshot]),
              }),
            };
          } else if (table === budgetSnapshotsSq) {
            return {
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  { snapshotDate: '2026-06-12', alertLevel: 'ok' },
                ]),
              }),
            };
          }
          return {
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          };
        }),
      };
      return mockSelect;
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ number: 123, html_url: 'https://github.com/test' }),
    });

    vi.stubGlobal('fetch', mockFetch);

    const config: BudgetSyncConfig = {
      db,
      github,
      slackWebhookUrl: 'https://hooks.slack.com/test',
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.equal(result.slackNotified, true);
    assert.equal(result.issueNotified, true);

    vi.unstubAllGlobals();
  });

  it('sends all_clear notification when alert_level returns to ok', async () => {
    testPoolSnapshot = {
      totalCredits: '10000',
      creditsUsed: '7500',
      forecast7d: '8500',
      forecast30d: '8800',
    };

    db.select = vi.fn().mockImplementation((fields: any) => {
      const mockSelect = {
        from: vi.fn().mockImplementation((table: any) => {
          if (table === poolSnapshotsSq) {
            return {
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([testPoolSnapshot]),
              }),
            };
          } else if (table === budgetSnapshotsSq) {
            return {
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  { snapshotDate: '2026-06-12', alertLevel: 'critical' },
                ]),
              }),
            };
          }
          return {
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          };
        }),
      };
      return mockSelect;
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ number: 124, html_url: 'https://github.com/test' }),
    });

    vi.stubGlobal('fetch', mockFetch);

    github = createMockGitHubClient({ budget_used: 7500 });

    const config: BudgetSyncConfig = {
      db,
      github,
      slackWebhookUrl: 'https://hooks.slack.com/test',
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.equal(result.alertLevel, 'ok');
    assert.equal(result.slackNotified, true);
    assert.equal(result.issueNotified, true);

    vi.unstubAllGlobals();
  });

  it('skips notifications in dry-run mode', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    vi.stubGlobal('fetch', mockFetch);

    const config: BudgetSyncConfig = {
      db,
      github,
      slackWebhookUrl: 'https://hooks.slack.com/test',
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
      dryRun: true,
    };

    const result = await runBudgetSync(config);

    assert.equal(mockFetch.mock.calls.length, 0);
    assert.equal(result.slackNotified, false);
    assert.equal(result.issueNotified, false);

    vi.unstubAllGlobals();
  });

  it('handles partial notification failure (Slack fails, GitHub succeeds)', async () => {
    testPoolSnapshot = {
      totalCredits: '10000',
      creditsUsed: '7500',
      forecast7d: '9500',
      forecast30d: '9200',
    };

    db.select = vi.fn().mockImplementation((fields: any) => {
      const mockSelect = {
        from: vi.fn().mockImplementation((table: any) => {
          if (table === poolSnapshotsSq) {
            return {
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([testPoolSnapshot]),
              }),
            };
          } else if (table === budgetSnapshotsSq) {
            return {
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  { snapshotDate: '2026-06-12', alertLevel: 'ok' },
                ]),
              }),
            };
          }
          return {
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          };
        }),
      };
      return mockSelect;
    });

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('slack')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });
      } else {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: vi.fn().mockResolvedValue({ number: 125, html_url: 'https://github.com/test' }),
        });
      }
    });

    vi.stubGlobal('fetch', mockFetch);

    const config: BudgetSyncConfig = {
      db,
      github,
      slackWebhookUrl: 'https://hooks.slack.com/test',
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.equal(result.slackNotified, false);
    assert.equal(result.issueNotified, true);
    assert.ok(result.errors.some(e => e.includes('Slack')));

    vi.unstubAllGlobals();
  });

  it('returns errors array with failure messages', async () => {
    const failingGithub: GitHubClient = {
      octokit: {
        request: vi.fn().mockRejectedValue(new Error('Budget API: 401 unauthorized')),
      },
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      })),
    }));

    const config: BudgetSyncConfig = {
      db,
      github: failingGithub,
      issueRepoOwner: 'acme',
      issueRepoName: 'burnrate',
      issueRepoToken: 'ghp_test',
      fetchOptions: { delayFn: () => Promise.resolve() },
    };

    const result = await runBudgetSync(config);

    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].includes('API error'));
  });
});
