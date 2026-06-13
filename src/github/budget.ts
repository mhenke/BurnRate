import type { GitHubClient } from './client.js';
import { withRetry } from '../budget/retry.js';

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
  options?: { maxAttempts?: number; delays?: number[] },
): Promise<BudgetReport> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const delays = options?.delays ?? [1000, 2000, 4000];

  return withRetry(async () => {
    const response = await client.octokit.request(
      'GET /enterprises/{enterprise}/copilot/billing',
      {
        enterprise: client.enterprise,
        headers: {
          'X-GitHub-Api-Version': '2026-03-10',
        },
      },
    );

    const data = response.data as {
      seat_management_setting?: string;
      seat_breakdown?: {
        total: number;
        added_this_cycle: number;
        pending_cancellation: number;
        pending_invitation: number;
      };
      public_code_suggestions?: {
        policy: string;
        rollout_percentage: number;
      };
      platform?: {
        total_seats: number;
        seats_used: number;
        seats_remaining: number;
        pct_used: number;
        pct_elapsed: number;
        forecast_7d?: number;
        forecast_30d?: number;
      };
      budget?: {
        total_budget: number;
        budget_used: number;
        budget_remaining: number;
        pct_used: number;
        pct_elapsed: number;
        forecast_7d?: number;
        forecast_30d?: number;
      };
    };

    if (!data.budget) {
      throw new Error('Budget data not available from GitHub API');
    }

    const budget = data.budget;

    let alertLevel: BudgetReport['alert_level'] = 'info';
    if (budget.pct_used >= 90 || budget.pct_elapsed >= 90) {
      alertLevel = 'critical';
    } else if (budget.pct_used >= 75 || budget.pct_elapsed >= 75) {
      alertLevel = 'warning';
    }

    return {
      total_budget: budget.total_budget,
      budget_used: budget.budget_used,
      budget_remaining: budget.budget_remaining,
      pct_used: budget.pct_used,
      pct_elapsed: budget.pct_elapsed,
      forecast_7d: budget.forecast_7d,
      forecast_30d: budget.forecast_30d,
      alert_level: alertLevel,
    };
  }, { maxAttempts, delays });
}
