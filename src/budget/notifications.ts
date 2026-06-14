import type { DbClient } from '../db/client.js';
import type { BudgetReport } from './budget_sync.js';
import { sanitizeErrorMessage } from '../notifications/sanitize.js';
import { SlackProvider } from '../notifications/providers/slack.js';
import { GitHubIssuesProvider } from '../notifications/providers/github_issues.js';
import type { BurnRateAlert, NotificationResult, NotificationChannel } from '../notifications/types.js';

export { sanitizeErrorMessage };
export type { NotificationChannel, NotificationResult };

export type SlackConfig = { webhookUrl: string; channel?: string; username?: string; };
export type GitHubIssueConfig = { owner: string; repo: string; token: string; };

export async function sendSlackNotification(
  db: DbClient,
  config: SlackConfig,
  report: BudgetReport,
  snapshotDate: string,
): Promise<NotificationResult> {
  try {
    const provider = new SlackProvider({
      type: 'slack',
      webhookUrl: config.webhookUrl,
      channel: config.channel,
      username: config.username,
    });

    const alert: BurnRateAlert = {
      id: `budget-${snapshotDate}`,
      timestamp: new Date(),
      level: (report.alertLevel === 'info' ? 'ok' : report.alertLevel) as BurnRateAlert['level'],
      persistentDays: 0,
      type: 'budget',
      subject: `Budget Alert: ${report.alertLevel.toUpperCase()} - ${snapshotDate}`,
      body: '',
      data: {
        totalBudget: report.totalBudget,
        budgetUsed: report.budgetUsed,
        budgetRemaining: report.budgetRemaining,
        pctUsed: report.pctUsed,
        pctElapsed: report.pctElapsed,
        forecast7d: report.forecast7d,
        forecast30d: report.forecast30d,
      },
      tags: ['budget', report.alertLevel],
    };

    const result = await provider.send(alert);
    return { channel: 'slack', ...result, externalId: result.externalId ?? config.channel ?? 'default' };
  } catch (error) {
    return { success: false, channel: 'slack', errorMessage: sanitizeErrorMessage(error) };
  }
}

export async function sendGitHubIssue(
  db: DbClient,
  config: GitHubIssueConfig,
  report: BudgetReport,
  snapshotDate: string,
): Promise<NotificationResult> {
  try {
    const provider = new GitHubIssuesProvider({
      type: 'github_issues',
      owner: config.owner,
      repo: config.repo,
      token: config.token,
    });

    const alert: BurnRateAlert = {
      id: `budget-${snapshotDate}`,
      timestamp: new Date(),
      level: (report.alertLevel === 'info' ? 'ok' : report.alertLevel) as BurnRateAlert['level'],
      persistentDays: 0,
      type: 'budget',
      subject: `Budget Alert: ${report.alertLevel.toUpperCase()} - ${snapshotDate}`,
      body: '',
      data: {
        totalBudget: report.totalBudget,
        budgetUsed: report.budgetUsed,
        budgetRemaining: report.budgetRemaining,
        pctUsed: report.pctUsed,
        pctElapsed: report.pctElapsed,
        forecast7d: report.forecast7d,
        forecast30d: report.forecast30d,
      },
      tags: ['budget', report.alertLevel],
    };

    const result = await provider.send(alert);
    return { channel: 'github_issue', ...result };
  } catch (error) {
    return { success: false, channel: 'github_issue', errorMessage: sanitizeErrorMessage(error) };
  }
}
