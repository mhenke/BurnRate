import type { DbClient } from '../db/client.js';
import type { GitHubClient } from '../github/client.js';
import { fetchBilling, type BudgetBillingData } from '../github/budget.js';
import * as queries from '../db/queries.js';
import { sendSlackNotification, sendGitHubIssue, sanitizeErrorMessage, type SlackConfig, type GitHubIssueConfig } from './notifications.js';
import { computeAlertLevel, daysAgo } from '../constants.js';

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

function buildBudgetReport(snapshot: {
  totalBudget: number; budgetUsed: number; budgetRemaining: number;
  pctUsed: number; pctElapsed: number;
  forecast7d: number | null; forecast30d: number | null;
  alertLevel: string;
}) {
  const level = snapshot.alertLevel === 'ok' ? 'info' : snapshot.alertLevel === 'escalation' ? 'critical' : snapshot.alertLevel;
  return {
    totalBudget: snapshot.totalBudget,
    budgetUsed: snapshot.budgetUsed,
    budgetRemaining: snapshot.budgetRemaining,
    pctUsed: snapshot.pctUsed,
    pctElapsed: snapshot.pctElapsed,
    forecast7d: snapshot.forecast7d ?? null,
    forecast30d: snapshot.forecast30d ?? null,
    alertLevel: level as 'info' | 'warning' | 'critical',
  };
}

/**
 * Run the budget sync pipeline: fetch billing data from GitHub API, load
 * the latest pool snapshot, compute alert level, store the snapshot, and
 * dispatch Slack/GitHub Issue notifications when the level changes.
 */
export async function runBudgetSync(config: BudgetSyncConfig): Promise<BudgetSyncResult> {
  const { db, github, slackWebhookUrl, issueRepoOwner, issueRepoName, issueRepoToken, dryRun = false } = config;
  
  const errors: string[] = [];
  const snapshotDate = daysAgo(0);
  const yesterdayDate = daysAgo(1);
  
  let slackNotified = false;
  let issueNotified = false;
  let note: string | null = null;

  let billingData: BudgetBillingData | null = null;
  let poolSnapshot: queries.PoolSnapshotRow | null = null;
  
  try {
    billingData = await fetchBilling(github, config.fetchOptions);
  } catch (error) {
    note = `Budget API error: ${sanitizeErrorMessage(error)}`;
    errors.push(note ?? '');
  }
  
  poolSnapshot = await queries.getLatestPoolSnapshot(db);
  
  const budgetUsed = billingData?.budgetUsed ?? parseNumeric(poolSnapshot?.creditsUsed ?? null) ?? 0;
  const totalBudget = parseNumeric(poolSnapshot?.totalCredits ?? null) ?? 0;
  const forecast7d = parseNumeric(poolSnapshot?.forecast7d ?? null);
  const forecast30d = parseNumeric(poolSnapshot?.forecast30d ?? null);
  
  const pctUsed = totalBudget > 0 ? (budgetUsed / totalBudget) * 100 : 0;
  const pctElapsed = 0;
  
  const pctOfBudget7d = forecast7d !== null && totalBudget > 0 ? (forecast7d / totalBudget) * 100 : null;
  const pctOfBudget30d = forecast30d !== null && totalBudget > 0 ? (forecast30d / totalBudget) * 100 : null;
  
  const alertLevel = computeAlertLevel(pctOfBudget7d, pctOfBudget30d);
  
  if (!dryRun) {
    await queries.upsertBudgetSnapshot(db, {
      snapshotDate,
      totalBudget,
      budgetUsed,
      budgetRemaining: totalBudget - budgetUsed,
      pctUsed,
      pctElapsed,
      forecast7d,
      forecast30d,
      pctOfBudget7d,
      pctOfBudget30d,
      alertLevel,
      source: 'api',
      note,
    });
  }
  
  const yesterdaySnapshot = await queries.getBudgetSnapshotByDate(db, yesterdayDate);
  const yesterdayAlertLevel = yesterdaySnapshot?.alertLevel ?? 'ok';
  
  const shouldNotify = alertLevel !== 'ok' && alertLevel !== yesterdayAlertLevel;
  const shouldNotifyAllClear = alertLevel === 'ok' && yesterdayAlertLevel !== 'ok' && yesterdayAlertLevel !== null;
  
  const shouldSendNotifications = shouldNotify || shouldNotifyAllClear;
  
  if (shouldSendNotifications && !dryRun) {
    const report = buildBudgetReport({ totalBudget, budgetUsed, budgetRemaining: totalBudget - budgetUsed, pctUsed, pctElapsed, forecast7d, forecast30d, alertLevel });

    if (slackWebhookUrl) {
      const slackConfig: SlackConfig = { webhookUrl: slackWebhookUrl };
      const slackResult = await sendSlackNotification(db, slackConfig, report, snapshotDate);
      slackNotified = slackResult.success;
      if (!slackResult.success) {
        errors.push(`Slack notification failed: ${slackResult.errorMessage}`);
      }
    }
    
    const githubConfig: GitHubIssueConfig = {
      owner: issueRepoOwner,
      repo: issueRepoName,
      token: issueRepoToken,
    };
    const githubResult = await sendGitHubIssue(db, githubConfig, report, snapshotDate);
    issueNotified = githubResult.success;
    if (!githubResult.success) {
      errors.push(`GitHub issue creation failed: ${githubResult.errorMessage}`);
    }
  }
  
  return {
    snapshotDate,
    totalBudget,
    budgetUsed,
    pctUsed,
    pctOfBudget7d,
    pctOfBudget30d,
    alertLevel,
    slackNotified,
    issueNotified,
    errors,
  };
}

