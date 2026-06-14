import type { DbClient } from '../db/client.js';
import type { GitHubClient } from '../github/client.js';
import { fetchBilling } from '../github/budget.js';
import * as queries from '../db/queries.js';
import { sendSlackNotification, sendGitHubIssue, sanitizeErrorMessage, type SlackConfig, type GitHubIssueConfig } from './notifications.js';
import { computeAlertLevel, daysAgo } from '../constants.js';

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
    forecast7d: snapshot.forecast7d ?? undefined,
    forecast30d: snapshot.forecast30d ?? undefined,
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
  let source: 'api' | 'pool_fallback' = 'api';
  let note: string | null = null;

  let billingReport: { totalBudget: number; budgetUsed: number; pctElapsed: number; forecast7d?: number; forecast30d?: number } | null = null;
  let poolSnapshot: queries.PoolSnapshotRow | null = null;
  
  try {
    billingReport = await fetchBilling(github, config.fetchOptions);
    
    if (billingReport.totalBudget === 0 || billingReport.totalBudget === undefined) {
      source = 'pool_fallback';
      note = 'Budget API fields absent';
    }
  } catch (error) {
    source = 'pool_fallback';
    note = `Budget API error: ${sanitizeErrorMessage(error)}`;
    errors.push(note ?? '');
  }
  
  poolSnapshot = await queries.getLatestPoolSnapshot(db);
  
  const [totalBudget, budgetUsed, forecast7d, forecast30d] = computeBudgetMetrics(
    source, billingReport, poolSnapshot,
  );
  
  const pctUsed = totalBudget > 0 ? (budgetUsed / totalBudget) * 100 : 0;
  const pctElapsed = billingReport?.pctElapsed ?? 0;
  
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
      source,
      note,
    });
  }
  
  const yesterdaySnapshot = await queries.getBudgetSnapshotByDate(db, yesterdayDate);
  const yesterdayAlertLevel = yesterdaySnapshot?.alertLevel ?? 'ok';
  
  const shouldNotify = alertLevel !== 'ok' && alertLevel !== yesterdayAlertLevel;
  const shouldNotifyAllClear = alertLevel === 'ok' && yesterdayAlertLevel !== 'ok' && yesterdayAlertLevel !== null;
  
  const shouldSendNotifications = shouldNotify || shouldNotifyAllClear;
  
  if (shouldSendNotifications && !dryRun) {
    if (slackWebhookUrl) {
      const slackConfig: SlackConfig = { webhookUrl: slackWebhookUrl };
      const report = buildBudgetReport({ totalBudget, budgetUsed, budgetRemaining: totalBudget - budgetUsed, pctUsed, pctElapsed, forecast7d, forecast30d, alertLevel });
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
    const report = buildBudgetReport({ totalBudget, budgetUsed, budgetRemaining: totalBudget - budgetUsed, pctUsed, pctElapsed, forecast7d, forecast30d, alertLevel });
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

function computeBudgetMetrics(
  source: 'api' | 'pool_fallback',
  billingReport: { totalBudget: number; budgetUsed: number; forecast7d?: number; forecast30d?: number } | null,
  poolSnapshot: queries.PoolSnapshotRow | null,
): [number, number, number | null, number | null] {
  if (source === 'api' && billingReport && billingReport.totalBudget > 0) {
    return [
      billingReport.totalBudget,
      billingReport.budgetUsed,
      billingReport.forecast7d ?? null,
      billingReport.forecast30d ?? null,
    ];
  }
  if (!poolSnapshot) {
    return [0, billingReport?.budgetUsed ?? 0, null, null];
  }
  return [
    parseNumeric(poolSnapshot.totalCredits) ?? 0,
    billingReport?.budgetUsed ?? parseNumeric(poolSnapshot.creditsUsed) ?? 0,
    parseNumeric(poolSnapshot.forecast7d),
    parseNumeric(poolSnapshot.forecast30d),
  ];
}
