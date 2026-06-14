import type { GitHubClient } from './client.js';
import { withRetry, type RetryOptions } from '../budget/retry.js';

export type BudgetReport = {
  totalBudget: number;
  budgetUsed: number;
  budgetRemaining: number;
  pctUsed: number;
  pctElapsed: number;
  forecast7d?: number;
  forecast30d?: number;
  alertLevel?: 'info' | 'warning' | 'critical';
};

/**
 * Fetch Copilot AI credit billing data from the GitHub API.
 */
/**
 * Fetch Copilot AI credit billing data from the GitHub API.
 */
export async function fetchBilling(
  client: GitHubClient,
  options?: { maxAttempts?: number; delays?: number[]; delayFn?: (ms: number) => Promise<void> },
): Promise<BudgetReport> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const delays = options?.delays ?? [1000, 2000, 4000];
  const delayFn = options?.delayFn;

  return withRetry(async () => {
    const path = client.org
      ? '/organizations/{org}/settings/billing/ai_credit/usage'
      : '/enterprises/{enterprise}/settings/billing/ai_credit/usage';
    const params = client.org
      ? { org: client.org }
      : { enterprise: client.enterprise };

    const response = await client.octokit.request(
      `GET ${path}`,
      {
        ...params,
        headers: {
          'X-GitHub-Api-Version': '2026-03-10',
        },
      },
    );

    const parsedBody = response.data as {
      timePeriod?: { year: number; month?: number };
      usageItems?: Array<{
        product: string;
        sku: string;
        grossQuantity: number;
        grossAmount: number;
        netAmount: number;
      }>;
    };

    let budgetUsed = 0;
    if (parsedBody.usageItems && Array.isArray(parsedBody.usageItems)) {
      for (const item of parsedBody.usageItems) {
        if (item.sku === 'Copilot AI Credits' || item.product === 'Copilot') {
          budgetUsed += Number(item.netAmount ?? item.grossAmount ?? 0);
        }
      }
    }

    return {
      totalBudget: 0,
      budgetUsed: budgetUsed,
      budgetRemaining: 0,
      pctUsed: 0,
      pctElapsed: 0,
    };
  }, { maxAttempts, delays, delayFn });
}
