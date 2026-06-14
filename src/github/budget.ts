import { GITHUB_API_VERSION, type GitHubClient } from './client.js';
import { withRetry, type RetryOptions } from '../budget/retry.js';

export type BudgetBillingData = {
  budgetUsed: number;
};

/**
 * Fetch Copilot AI credit billing data from the GitHub API.
 */
export async function fetchBilling(
  client: GitHubClient,
  options?: RetryOptions,
): Promise<BudgetBillingData> {
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
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
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

    if (budgetUsed === 0) {
      throw new Error('Budget billing data unavailable — usageItems empty or missing');
    }

    return {
      budgetUsed,
    };
  }, options);
}
