import type { DbClient } from '../db/client.js';
import type { GitHubClient } from '../github/client.js';
import { fetchBilling, type BudgetBillingData } from '../github/budget.js';
import * as queries from '../db/queries.js';
import { sendSlackNotification, sendGitHubIssue, sanitizeErrorMessage, type SlackConfig, type GitHubIssueConfig } from './notifications.js';
import { computeAlertLevel, today, daysAgo } from '../constants.js';

export type BudgetReport = {
  totalBudget: number; budgetUsed: number; budgetRemaining: number;
  pctUsed: number; pctElapsed: number;
  forecast7d: number | null; forecast30d: number | null;
  alertLevel: string;
};

export type BudgetSyncConfig = {
  db: DbClient;
  github: GitHubClient;
  slackWebhookUrl?: string;
  issueRepoOwner: string;
  issueRepoName: string;
  issueRepoToken: string;
  dryRun?: boolean;
  fetchOptions?: { maxAttempts?: number; delays?: number[]; delayFn?: (ms: number) => Promise<void> };
};

export type BudgetSyncResult = {
  snapshotDate: string;
  totalBudget: number;
  budgetUsed: number;
  pctUsed: number;
  pctOfBudget7d: number | null;
  pctOfBudget30d: number | null;
  alertLevel: 'ok' | 'warning' | 'escalation' | 'critical';
  slackNotified: boolean;
  issueNotified: boolean;
  errors: string[];
};

type PoolSnapshot = {
  forecast7d: string | number | null;
  forecast30d: string | number | null;
  totalCredits: string | number | null;
  creditsUsed: string | number | null;
};

type BudgetSnapshot = {
  snapshotDate: string;
  alertLevel: string | null;
};

function parseNumeric(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? parseFloat(value) : value;
}

/**
 * Compute how much of the current calendar month has elapsed as a percentage.
 *
 * @param now Reference date; defaults to today.
 * @returns A value in [0, 100].
 */
function computePctElapsed(now: Date = new Date()): number {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round((now.getDate() / daysInMonth) * 10000) / 100;
}

/**
 * Map internal alert levels to notification-friendly levels.
 * Slack/GitHub only recognize "info", "warning", "critical", so we
 * collapse "ok" → "info" and "escalation" → "critical" for the
 * notification payload.
 */
function notificationAlertLevel(internalLevel: string): 'info' | 'warning' | 'critical' {
  if (internalLevel === 'ok') return 'info';
  if (internalLevel === 'escalation') return 'critical';
  return internalLevel as 'warning';
}

/**
 * Fetch billing data and pool snapshot in parallel.
 */
async function fetchBudgetData(
  github: GitHubClient,
  db: DbClient,
  fetchOptions?: BudgetSyncConfig['fetchOptions'],
): Promise<{ billing: BudgetBillingData | null; poolSnapshot: queries.PoolSnapshotRow | null; note: string | null }> {
  let billing: BudgetBillingData | null = null;
  let note: string | null = null;

  try {
    billing = await fetchBilling(github, fetchOptions);
  } catch (error) {
    note = `Budget API error: ${sanitizeErrorMessage(error)}`;
  }

  const poolSnapshot = await queries.getLatestPoolSnapshot(db);
  return { billing, poolSnapshot, note };
}

/**
 * Compute budget stats from raw billing and pool snapshot data.
 */
function computeBudgetStats(billing: BudgetBillingData | null, poolSnapshot: queries.PoolSnapshotRow | null) {
  const budgetUsed = billing?.budgetUsed ?? parseNumeric(poolSnapshot?.creditsUsed ?? null) ?? 0;
  const totalBudget = parseNumeric(poolSnapshot?.totalCredits ?? null) ?? 0;
  const forecast7d = parseNumeric(poolSnapshot?.forecast7d ?? null);
  const forecast30d = parseNumeric(poolSnapshot?.forecast30d ?? null);

  const pctUsed = totalBudget > 0 ? (budgetUsed / totalBudget) * 100 : 0;
  const pctOfBudget7d = forecast7d !== null && totalBudget > 0 ? (forecast7d / totalBudget) * 100 : null;
  const pctOfBudget30d = forecast30d !== null && totalBudget > 0 ? (forecast30d / totalBudget) * 100 : null;

  const alertLevel = computeAlertLevel(pctOfBudget7d, pctOfBudget30d);

  return { totalBudget, budgetUsed, forecast7d, forecast30d, pctUsed, pctOfBudget7d, pctOfBudget30d, alertLevel };
}

/**
 * Send notifications if alert level has changed from yesterday.
 */
async function dispatchNotifications(
  db: DbClient,
  snapshotDate: string,
  alertLevel: string,
  yesterdayAlertLevel: string,
  totalBudget: number,
  budgetUsed: number,
  pctUsed: number,
  pctElapsed: number,
  forecast7d: number | null,
  forecast30d: number | null,
  slackWebhookUrl: string | undefined,
  issueRepoOwner: string,
  issueRepoName: string,
  issueRepoToken: string,
): Promise<{ slackNotified: boolean; issueNotified: boolean; errors: string[] }> {
  let slackNotified = false;
  let issueNotified = false;
  const errors: string[] = [];

  const shouldNotify = alertLevel !== 'ok' && alertLevel !== yesterdayAlertLevel;
  const shouldNotifyAllClear = alertLevel === 'ok' && yesterdayAlertLevel !== 'ok' && yesterdayAlertLevel !== null;

  if (!shouldNotify && !shouldNotifyAllClear) {
    return { slackNotified, issueNotified, errors };
  }

  const budgetRemaining = totalBudget - budgetUsed;
  const notifyLevel = notificationAlertLevel(alertLevel);

  if (slackWebhookUrl) {
    const slackConfig: SlackConfig = { webhookUrl: slackWebhookUrl };
    const slackResult = await sendSlackNotification(db, slackConfig, {
      totalBudget, budgetUsed, budgetRemaining, pctUsed,
      pctElapsed, forecast7d, forecast30d, alertLevel: notifyLevel,
    }, snapshotDate);
    slackNotified = slackResult.success;
    if (!slackResult.success) {
      errors.push(`Slack notification failed: ${slackResult.errorMessage}`);
    }
  }

  const githubConfig: GitHubIssueConfig = { owner: issueRepoOwner, repo: issueRepoName, token: issueRepoToken };
  const githubResult = await sendGitHubIssue(db, githubConfig, {
    totalBudget, budgetUsed, budgetRemaining, pctUsed,
    pctElapsed, forecast7d, forecast30d, alertLevel: notifyLevel,
  }, snapshotDate);
  issueNotified = githubResult.success;
  if (!githubResult.success) {
    errors.push(`GitHub issue creation failed: ${githubResult.errorMessage}`);
  }

  return { slackNotified, issueNotified, errors };
}

/**
 * Run the budget sync pipeline: fetch billing data, load pool snapshot,
 * compute alert level, store snapshot, and dispatch notifications when
 * the level changes from the previous day.
 */
export async function runBudgetSync(config: BudgetSyncConfig): Promise<BudgetSyncResult> {
  const { db, github, slackWebhookUrl, issueRepoOwner, issueRepoName, issueRepoToken, dryRun = false } = config;

  const errors: string[] = [];
  const snapshotDate = today();
  const yesterdayDate = daysAgo(1);
  const pctElapsed = computePctElapsed();

  const { billing, poolSnapshot, note } = await fetchBudgetData(github, db, config.fetchOptions);
  if (note) errors.push(note);

  const stats = computeBudgetStats(billing, poolSnapshot);

  if (!dryRun) {
    await queries.upsertBudgetSnapshot(db, {
      snapshotDate,
      totalBudget: stats.totalBudget,
      budgetUsed: stats.budgetUsed,
      budgetRemaining: stats.totalBudget - stats.budgetUsed,
      pctUsed: stats.pctUsed,
      pctElapsed,
      forecast7d: stats.forecast7d,
      forecast30d: stats.forecast30d,
      pctOfBudget7d: stats.pctOfBudget7d,
      pctOfBudget30d: stats.pctOfBudget30d,
      alertLevel: stats.alertLevel,
      source: 'api',
      note,
    });
  }

  const yesterdaySnapshot = await queries.getBudgetSnapshotByDate(db, yesterdayDate);
  const yesterdayAlertLevel = yesterdaySnapshot?.alertLevel ?? 'ok';

  const { slackNotified, issueNotified, errors: notificationErrors } = dryRun
    ? { slackNotified: false, issueNotified: false, errors: [] }
    : await dispatchNotifications(
        db, snapshotDate, stats.alertLevel, yesterdayAlertLevel,
        stats.totalBudget, stats.budgetUsed, stats.pctUsed,
        pctElapsed, stats.forecast7d, stats.forecast30d,
        slackWebhookUrl, issueRepoOwner, issueRepoName, issueRepoToken,
      );
  errors.push(...notificationErrors);

  return {
    snapshotDate,
    totalBudget: stats.totalBudget,
    budgetUsed: stats.budgetUsed,
    pctUsed: stats.pctUsed,
    pctOfBudget7d: stats.pctOfBudget7d,
    pctOfBudget30d: stats.pctOfBudget30d,
    alertLevel: stats.alertLevel,
    slackNotified,
    issueNotified,
    errors,
  };
}

