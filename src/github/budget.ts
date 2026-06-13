import type { GitHubClient } from './client.js';
import { withRetry, type RetryOptions } from '../budget/retry.js';

export type BudgetReport = {
  total_budget: number;
  budget_used: number;
  budget_remaining: number;
  pct_used: number;
  pct_elapsed: number;
  forecast_7d?: number;
  forecast_30d?: number;
  alert_level?: 'info' | 'warning' | 'critical';
};

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

    const data = response.data as {
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
    if (data.usageItems && Array.isArray(data.usageItems)) {
      for (const item of data.usageItems) {
        if (item.sku === 'Copilot AI Credits' || item.product === 'Copilot') {
          budgetUsed += Number(item.netAmount ?? item.grossAmount ?? 0);
        }
      }
    }

    return {
      total_budget: 0,
      budget_used: budgetUsed,
      budget_remaining: 0,
      pct_used: 0,
      pct_elapsed: 0,
    };
  }, { maxAttempts, delays, delayFn });
}
