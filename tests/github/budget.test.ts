import { strict as assert } from 'node:assert';
import { describe, it, vi } from 'vitest';
import { fetchBilling } from '../../src/github/budget.js';
import type { GitHubClient } from '../../src/github/client.js';

describe('fetchBilling', () => {
  it('fetches billing usage successfully', async () => {
    const mockUsageData = {
      timePeriod: { year: 2026, month: 6 },
      organization: 'acme-inc',
      usageItems: [
        {
          product: 'Copilot',
          sku: 'Copilot AI Credits',
          netAmount: 7500,
        }
      ]
    };

    const octokitMock = {
      request: vi.fn().mockResolvedValue({ data: mockUsageData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client);

    assert.deepEqual(result, {
      total_budget: 0,
      budget_used: 7500,
      budget_remaining: 0,
      pct_used: 0,
      pct_elapsed: 0,
    });

    assert.equal(octokitMock.request.mock.calls[0][0], 'GET /organizations/{org}/settings/billing/ai_credit/usage');
    assert.equal(octokitMock.request.mock.calls[0][1]?.org, 'acme-inc');
  });

  it('sums multiple Copilot usage items and ignores non-Copilot items', async () => {
    const mockUsageData = {
      timePeriod: { year: 2026, month: 6 },
      organization: 'acme-inc',
      usageItems: [
        {
          product: 'Copilot',
          sku: 'Copilot AI Credits',
          netAmount: 5000,
        },
        {
          product: 'Copilot',
          sku: 'Copilot AI Credits',
          netAmount: 2500,
        },
        {
          product: 'Actions',
          sku: 'Compute time',
          netAmount: 1000,
        }
      ]
    };

    const octokitMock = {
      request: vi.fn().mockResolvedValue({ data: mockUsageData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client);

    assert.equal(result.budget_used, 7500);
  });

  it('retries on failure using withRetry', async () => {
    const mockUsageData = {
      timePeriod: { year: 2026, month: 6 },
      organization: 'acme-inc',
      usageItems: [
        {
          product: 'Copilot',
          sku: 'Copilot AI Credits',
          netAmount: 5000,
        }
      ]
    };

    const octokitMock = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ data: mockUsageData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client, { maxAttempts: 3, delays: [100, 200], delayFn: () => Promise.resolve() });

    assert.equal(result.budget_used, 5000);
    assert.equal(octokitMock.request.mock.calls.length, 3);
  });

  it('uses custom retry options when provided', async () => {
    const mockUsageData = {
      timePeriod: { year: 2026, month: 6 },
      organization: 'acme-inc',
      usageItems: [
        {
          product: 'Copilot',
          sku: 'Copilot AI Credits',
          netAmount: 5000,
        }
      ]
    };

    const octokitMock = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('Rate limited'))
        .mockResolvedValueOnce({ data: mockUsageData }),
    };

    const client: GitHubClient = {
      octokit: octokitMock as any,
      enterprise: 'acme',
      org: 'acme-inc',
      fetchSignedUrl: async <T>() => ({}) as T,
    };

    const result = await fetchBilling(client, { maxAttempts: 2, delays: [500], delayFn: () => Promise.resolve() });

    assert.equal(result.budget_used, 5000);
    assert.equal(octokitMock.request.mock.calls.length, 2);
  });
});
