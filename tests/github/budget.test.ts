import { strict as assert } from 'node:assert';
import { describe, it, vi } from 'vitest';
import { fetchBilling } from '../../src/github/budget.js';
import type { GitHubClient } from '../../src/github/client.js';

describe('fetchBilling', () => {
  it('fetches budget data successfully', async () => {
    const mockBudgetData = {
      budget: {
        total_budget: 10000,
        budget_used: 7500,
        budget_remaining: 2500,
        pct_used: 75,
        pct_elapsed: 60,
        forecast_7d: 8500,
        forecast_30d: 9500,
      },
    };

    const octokitMock = {
      request: vi.fn().mockResolvedValue({ data: mockBudgetData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client);

    assert.deepEqual(result, {
      total_budget: 10000,
      budget_used: 7500,
      budget_remaining: 2500,
      pct_used: 75,
      pct_elapsed: 60,
      forecast_7d: 8500,
      forecast_30d: 9500,
      alert_level: 'warning',
    });

    assert.equal(octokitMock.request.mock.calls[0][0], 'GET /enterprises/{enterprise}/copilot/billing');
    assert.equal(octokitMock.request.mock.calls[0][1]?.enterprise, 'acme');
  });

  it('sets alert_level to critical when pct_used >= 90', async () => {
    const mockBudgetData = {
      budget: {
        total_budget: 10000,
        budget_used: 9500,
        budget_remaining: 500,
        pct_used: 95,
        pct_elapsed: 80,
      },
    };

    const octokitMock = {
      request: vi.fn().mockResolvedValue({ data: mockBudgetData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client);

    assert.equal(result.alert_level, 'critical');
  });

  it('sets alert_level to critical when pct_elapsed >= 90', async () => {
    const mockBudgetData = {
      budget: {
        total_budget: 10000,
        budget_used: 5000,
        budget_remaining: 5000,
        pct_used: 50,
        pct_elapsed: 95,
      },
    };

    const octokitMock = {
      request: vi.fn().mockResolvedValue({ data: mockBudgetData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client);

    assert.equal(result.alert_level, 'critical');
  });

  it('sets alert_level to warning when pct_used >= 75', async () => {
    const mockBudgetData = {
      budget: {
        total_budget: 10000,
        budget_used: 7500,
        budget_remaining: 2500,
        pct_used: 75,
        pct_elapsed: 50,
      },
    };

    const octokitMock = {
      request: vi.fn().mockResolvedValue({ data: mockBudgetData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client);

    assert.equal(result.alert_level, 'warning');
  });

  it('sets alert_level to info when under thresholds', async () => {
    const mockBudgetData = {
      budget: {
        total_budget: 10000,
        budget_used: 5000,
        budget_remaining: 5000,
        pct_used: 50,
        pct_elapsed: 40,
      },
    };

    const octokitMock = {
      request: vi.fn().mockResolvedValue({ data: mockBudgetData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client);

    assert.equal(result.alert_level, 'info');
  });

  it('throws error when budget data is not available', async () => {
    const mockData = {
      seat_management_setting: 'selected_actors',
    };

    const octokitMock = {
      request: vi.fn().mockResolvedValue({ data: mockData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    await assert.rejects(
      async () => fetchBilling(client),
      /Budget data not available from GitHub API/,
    );
  });

  it('retries on failure using withRetry', async () => {
    const mockBudgetData = {
      budget: {
        total_budget: 10000,
        budget_used: 5000,
        budget_remaining: 5000,
        pct_used: 50,
        pct_elapsed: 40,
      },
    };

    const octokitMock = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ data: mockBudgetData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client, { maxAttempts: 3, delays: [100, 200], delayFn: () => Promise.resolve() });

    assert.equal(result.total_budget, 10000);
    assert.equal(octokitMock.request.mock.calls.length, 3);
  });

  it('uses custom retry options when provided', async () => {
    const mockBudgetData = {
      budget: {
        total_budget: 10000,
        budget_used: 5000,
        budget_remaining: 5000,
        pct_used: 50,
        pct_elapsed: 40,
      },
    };

    const octokitMock = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('Rate limited'))
        .mockResolvedValueOnce({ data: mockBudgetData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client, { maxAttempts: 2, delays: [500], delayFn: () => Promise.resolve() });

    assert.equal(result.total_budget, 10000);
    assert.equal(octokitMock.request.mock.calls.length, 2);
  });
});
