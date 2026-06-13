import { strict as assert } from 'node:assert';
import { describe, it, vi } from 'vitest';
import { sendSlackNotification, sendGitHubIssue } from '../../src/budget/notifications.js';
import type { BudgetReport } from '../../src/github/budget.js';

const mockReport: BudgetReport = {
  total_budget: 10000,
  budget_used: 7500,
  budget_remaining: 2500,
  pct_used: 75,
  pct_elapsed: 60,
  forecast_7d: 8500,
  forecast_30d: 9500,
  alert_level: 'warning',
};

function createMockDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    constructor: {
      name: 'BaseSQLiteDatabase',
    },
  };
}

describe('sendSlackNotification', () => {
  it('sends notification to Slack successfully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb();

    const config = {
      webhookUrl: 'https://hooks.slack.com/services/TEST',
      channel: '#alerts',
      username: 'BurnRate Bot',
    };

    const result = await sendSlackNotification(db as any, config, mockReport, '2026-06-13');

    assert.equal(result.success, true);
    assert.equal(result.channel, 'slack');
    assert.equal(result.externalId, '#alerts');

    const callArgs = mockFetch.mock.calls[0];
    assert.equal(callArgs[0], config.webhookUrl);
    assert.equal(callArgs[1]?.method, 'POST');

    const body = JSON.parse(callArgs[1]?.body as string);
    assert.equal(body.channel, '#alerts');
    assert.equal(body.username, 'BurnRate Bot');
    assert.equal(body.attachments[0].color, 'warning');

    vi.unstubAllGlobals();
  });

  it('uses default channel when not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb();

    const config = {
      webhookUrl: 'https://hooks.slack.com/services/TEST',
    };

    const result = await sendSlackNotification(db as any, config, mockReport, '2026-06-13');

    assert.equal(result.externalId, 'default');

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    assert.equal(body.channel, '#alerts');

    vi.unstubAllGlobals();
  });

  it('sets color to danger for critical alerts', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb();

    const criticalReport: BudgetReport = {
      ...mockReport,
      alert_level: 'critical',
    };

    const config = {
      webhookUrl: 'https://hooks.slack.com/services/TEST',
    };

    await sendSlackNotification(db as any, config, criticalReport, '2026-06-13');

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    assert.equal(body.attachments[0].color, 'danger');

    vi.unstubAllGlobals();
  });

  it('handles Slack webhook failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb();

    const config = {
      webhookUrl: 'https://hooks.slack.com/services/INVALID',
    };

    const result = await sendSlackNotification(db as any, config, mockReport, '2026-06-13');

    assert.equal(result.success, false);
    assert.equal(result.channel, 'slack');
    assert.ok(result.errorMessage?.includes('404'));

    vi.unstubAllGlobals();
  });

  it('handles network errors', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb();

    const config = {
      webhookUrl: 'https://hooks.slack.com/services/TEST',
    };

    const result = await sendSlackNotification(db as any, config, mockReport, '2026-06-13');

    assert.equal(result.success, false);
    assert.equal(result.channel, 'slack');
    assert.equal(result.errorMessage, 'Network error');

    vi.unstubAllGlobals();
  });
});

describe('sendGitHubIssue', () => {
  it('creates GitHub issue successfully', async () => {
    const mockResponse = {
      ok: true,
      status: 201,
      statusText: 'Created',
      json: vi.fn().mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/acme/burnrate/issues/123',
      }),
    };

    const mockFetch = vi.fn().mockResolvedValue(mockResponse);

    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb();

    const config = {
      owner: 'acme',
      repo: 'burnrate',
      token: 'ghp_TEST',
    };

    const result = await sendGitHubIssue(db as any, config, mockReport, '2026-06-13');

    assert.equal(result.success, true);
    assert.equal(result.channel, 'github_issue');
    assert.equal(result.externalId, '123');

    const callArgs = mockFetch.mock.calls[0];
    assert.equal(callArgs[0], 'https://api.github.com/repos/acme/burnrate/issues');

    const headers = callArgs[1]?.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer ghp_TEST');
    assert.equal(headers['X-GitHub-Api-Version'], '2026-03-10');

    const body = JSON.parse(callArgs[1]?.body as string);
    assert.ok(body.title.includes('[BurnRate]'));
    assert.ok(body.title.includes('WARNING'));
    assert.ok(body.body.includes('Budget Status'));
    assert.deepEqual(body.labels, ['budget', 'alert', 'warning']);

    vi.unstubAllGlobals();
  });

  it('creates issue with critical alert level', async () => {
    const mockResponse = {
      ok: true,
      status: 201,
      statusText: 'Created',
      json: vi.fn().mockResolvedValue({
        number: 124,
        html_url: 'https://github.com/acme/burnrate/issues/124',
      }),
    };

    const mockFetch = vi.fn().mockResolvedValue(mockResponse);

    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb();

    const criticalReport: BudgetReport = {
      ...mockReport,
      alert_level: 'critical',
    };

    const config = {
      owner: 'acme',
      repo: 'burnrate',
      token: 'ghp_TEST',
    };

    await sendGitHubIssue(db as any, config, criticalReport, '2026-06-13');

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    assert.ok(body.title.includes('CRITICAL'));
    assert.deepEqual(body.labels, ['budget', 'alert', 'critical']);

    vi.unstubAllGlobals();
  });

  it('handles GitHub API failure', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: vi.fn().mockResolvedValue('Bad credentials'),
    };

    const mockFetch = vi.fn().mockResolvedValue(mockResponse);

    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb();

    const config = {
      owner: 'acme',
      repo: 'burnrate',
      token: 'invalid_token',
    };

    const result = await sendGitHubIssue(db as any, config, mockReport, '2026-06-13');

    assert.equal(result.success, false);
    assert.equal(result.channel, 'github_issue');
    assert.ok(result.errorMessage?.includes('401'));

    vi.unstubAllGlobals();
  });

  it('handles network errors', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb();

    const config = {
      owner: 'acme',
      repo: 'burnrate',
      token: 'ghp_TEST',
    };

    const result = await sendGitHubIssue(db as any, config, mockReport, '2026-06-13');

    assert.equal(result.success, false);
    assert.equal(result.channel, 'github_issue');
    assert.equal(result.errorMessage, 'Network error');

    vi.unstubAllGlobals();
  });
});
