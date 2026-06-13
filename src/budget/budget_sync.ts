import type { DbClient } from '../db/client.js';
import type { GitHubClient } from '../github/client.js';
import { fetchBilling, type BudgetReport } from '../github/budget.js';
import { budgetSnapshotsPg, budgetSnapshotsSq, notificationLogPg, notificationLogSq, poolSnapshotsPg, poolSnapshotsSq } from '../db/schema.js';
import { sendSlackNotification, sendGitHubIssue, sanitizeErrorMessage, type SlackConfig, type GitHubIssueConfig } from './notifications.js';
import { eq, desc, sql } from 'drizzle-orm';

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
};

type BudgetSnapshot = {
  snapshotDate: string;
  alertLevel: string | null;
};

function today(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

function yesterday(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return now.toISOString().split('T')[0];
}

function parseNumeric(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? parseFloat(value) : value;
}

function computeAlertLevel(pctOfBudget7d: number | null, pctOfBudget30d: number | null): 'ok' | 'warning' | 'escalation' | 'critical' {
  const maxPct = Math.max(pctOfBudget7d ?? 0, pctOfBudget30d ?? 0);
  
  if (maxPct >= 110) return 'critical';
  if (maxPct >= 100) return 'escalation';
  if (maxPct >= 90) return 'warning';
  return 'ok';
}

async function getLatestPoolSnapshot(db: DbClient): Promise<PoolSnapshot | null> {
  const isPg = db.constructor.name.toLowerCase().includes('postgres');
  
  if (isPg) {
    const results = await db
      .select({
        forecast7d: poolSnapshotsPg.forecast7d,
        forecast30d: poolSnapshotsPg.forecast30d,
      })
      .from(poolSnapshotsPg)
      .orderBy(desc(poolSnapshotsPg.snapshotDate))
      .limit(1);
    
    return results.length > 0 ? { forecast7d: results[0].forecast7d, forecast30d: results[0].forecast30d } : null;
  } else {
    const results = await db
      .select({
        forecast7d: poolSnapshotsSq.forecast7d,
        forecast30d: poolSnapshotsSq.forecast30d,
      })
      .from(poolSnapshotsSq)
      .orderBy(desc(poolSnapshotsSq.snapshotDate))
      .limit(1);
    
    return results.length > 0 ? { forecast7d: results[0].forecast7d, forecast30d: results[0].forecast30d } : null;
  }
}

async function getYesterdaySnapshot(db: DbClient, date: string): Promise<BudgetSnapshot | null> {
  const isPg = db.constructor.name.toLowerCase().includes('postgres');
  
  if (isPg) {
    const results = await db
      .select({
        snapshotDate: budgetSnapshotsPg.snapshotDate,
        alertLevel: budgetSnapshotsPg.alertLevel,
      })
      .from(budgetSnapshotsPg)
      .where(eq(budgetSnapshotsPg.snapshotDate, date))
      .limit(1);
    
    return results.length > 0 ? { snapshotDate: results[0].snapshotDate, alertLevel: results[0].alertLevel } : null;
  } else {
    const results = await db
      .select({
        snapshotDate: budgetSnapshotsSq.snapshotDate,
        alertLevel: budgetSnapshotsSq.alertLevel,
      })
      .from(budgetSnapshotsSq)
      .where(eq(budgetSnapshotsSq.snapshotDate, date))
      .limit(1);
    
    return results.length > 0 ? { snapshotDate: results[0].snapshotDate, alertLevel: results[0].alertLevel } : null;
  }
}

async function upsertBudgetSnapshot(
  db: DbClient,
  data: {
    snapshotDate: string;
    totalBudget: number;
    budgetUsed: number;
    budgetRemaining: number;
    pctUsed: number;
    pctElapsed: number;
    forecast7d: number | null;
    forecast30d: number | null;
    pctOfBudget7d: number | null;
    pctOfBudget30d: number | null;
    alertLevel: string;
    source: string;
    note: string | null;
  },
): Promise<void> {
  const isPg = db.constructor.name.toLowerCase().includes('postgres');
  
  if (isPg) {
    await db
      .insert(budgetSnapshotsPg)
      .values({
        snapshotDate: data.snapshotDate,
        totalBudget: data.totalBudget.toString(),
        budgetUsed: data.budgetUsed.toString(),
        budgetRemaining: data.budgetRemaining.toString(),
        pctUsed: data.pctUsed.toString(),
        pctElapsed: data.pctElapsed.toString(),
        forecast7d: data.forecast7d?.toString() ?? null,
        forecast30d: data.forecast30d?.toString() ?? null,
        pctOfBudget7d: data.pctOfBudget7d?.toString() ?? null,
        pctOfBudget30d: data.pctOfBudget30d?.toString() ?? null,
        alertLevel: data.alertLevel,
        source: data.source,
        note: data.note,
      })
      .onConflictDoUpdate({
        target: budgetSnapshotsPg.snapshotDate,
        set: {
          totalBudget: data.totalBudget.toString(),
          budgetUsed: data.budgetUsed.toString(),
          budgetRemaining: data.budgetRemaining.toString(),
          pctUsed: data.pctUsed.toString(),
          pctElapsed: data.pctElapsed.toString(),
          forecast7d: data.forecast7d?.toString() ?? null,
          forecast30d: data.forecast30d?.toString() ?? null,
          pctOfBudget7d: data.pctOfBudget7d?.toString() ?? null,
          pctOfBudget30d: data.pctOfBudget30d?.toString() ?? null,
          alertLevel: data.alertLevel,
          source: data.source,
          note: data.note,
          updatedAt: new Date(),
        },
      });
  } else {
    await db
      .insert(budgetSnapshotsSq)
      .values({
        snapshotDate: data.snapshotDate,
        totalBudget: data.totalBudget.toString(),
        budgetUsed: data.budgetUsed.toString(),
        budgetRemaining: data.budgetRemaining.toString(),
        pctUsed: data.pctUsed.toString(),
        pctElapsed: data.pctElapsed.toString(),
        forecast7d: data.forecast7d?.toString() ?? null,
        forecast30d: data.forecast30d?.toString() ?? null,
        pctOfBudget7d: data.pctOfBudget7d?.toString() ?? null,
        pctOfBudget30d: data.pctOfBudget30d?.toString() ?? null,
        alertLevel: data.alertLevel,
        source: data.source,
        note: data.note,
      })
      .onConflictDoUpdate({
        target: budgetSnapshotsSq.snapshotDate,
        set: {
          totalBudget: data.totalBudget.toString(),
          budgetUsed: data.budgetUsed.toString(),
          budgetRemaining: data.budgetRemaining.toString(),
          pctUsed: data.pctUsed.toString(),
          pctElapsed: data.pctElapsed.toString(),
          forecast7d: data.forecast7d?.toString() ?? null,
          forecast30d: data.forecast30d?.toString() ?? null,
          pctOfBudget7d: data.pctOfBudget7d?.toString() ?? null,
          pctOfBudget30d: data.pctOfBudget30d?.toString() ?? null,
          alertLevel: data.alertLevel,
          source: data.source,
          note: data.note,
          updatedAt: new Date().toISOString(),
        },
      });
  }
}

export async function runBudgetSync(config: BudgetSyncConfig): Promise<BudgetSyncResult> {
  const { db, github, slackWebhookUrl, issueRepoOwner, issueRepoName, issueRepoToken, dryRun = false } = config;
  
  const errors: string[] = [];
  const snapshotDate = today();
  const yesterdayDate = yesterday();
  
  let slackNotified = false;
  let issueNotified = false;
  
  let billingReport: BudgetReport | null = null;
  let source: 'api' | 'pool_fallback' = 'api';
  let note: string | null = null;
  
  try {
    billingReport = await fetchBilling(github, config.fetchOptions);
    
    if (billingReport.total_budget === 0 || billingReport.total_budget === undefined) {
      source = 'pool_fallback';
      note = 'Budget API fields absent';
    }
  } catch (error) {
    source = 'pool_fallback';
    note = `Budget API error: ${sanitizeErrorMessage(error)}`;
    errors.push(note);
  }
  
  const poolSnapshot = await getLatestPoolSnapshot(db);
  
  let totalBudget: number;
  let budgetUsed: number;
  let forecast7d: number | null = null;
  let forecast30d: number | null = null;
  
  if (source === 'api' && billingReport) {
    totalBudget = billingReport.total_budget;
    budgetUsed = billingReport.budget_used;
    forecast7d = billingReport.forecast_7d ?? null;
    forecast30d = billingReport.forecast_30d ?? null;
  } else {
    if (!poolSnapshot) {
      totalBudget = 0;
      budgetUsed = 0;
      note = note ? `${note}; pool_snapshots empty` : 'pool_snapshots empty';
    } else {
      totalBudget = parseNumeric(poolSnapshot.forecast7d) ?? parseNumeric(poolSnapshot.forecast30d) ?? 0;
      budgetUsed = 0;
      forecast7d = parseNumeric(poolSnapshot.forecast7d);
      forecast30d = parseNumeric(poolSnapshot.forecast30d);
    }
    source = 'pool_fallback';
  }
  
  const pctUsed = totalBudget > 0 ? (budgetUsed / totalBudget) * 100 : 0;
  const pctElapsed = billingReport?.pct_elapsed ?? 0;
  
  const pctOfBudget7d = forecast7d !== null && totalBudget > 0 ? (forecast7d / totalBudget) * 100 : null;
  const pctOfBudget30d = forecast30d !== null && totalBudget > 0 ? (forecast30d / totalBudget) * 100 : null;
  
  const alertLevel = computeAlertLevel(pctOfBudget7d, pctOfBudget30d);
  
  if (!dryRun) {
    await upsertBudgetSnapshot(db, {
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
  
  const yesterdaySnapshot = await getYesterdaySnapshot(db, yesterdayDate);
  const yesterdayAlertLevel = yesterdaySnapshot?.alertLevel ?? 'ok';
  
  const shouldNotify = alertLevel !== 'ok' && alertLevel !== yesterdayAlertLevel;
  const shouldNotifyAllClear = alertLevel === 'ok' && yesterdayAlertLevel !== 'ok' && yesterdayAlertLevel !== null;
  
  const shouldSendNotifications = shouldNotify || shouldNotifyAllClear;
  
  if (shouldSendNotifications && !dryRun) {
    const notificationType = alertLevel === 'ok' ? 'all_clear' : alertLevel;
    
    if (slackWebhookUrl) {
      const slackConfig: SlackConfig = {
        webhookUrl: slackWebhookUrl,
      };
      
      const budgetReportForNotification: BudgetReport = {
        total_budget: totalBudget,
        budget_used: budgetUsed,
        budget_remaining: totalBudget - budgetUsed,
        pct_used: pctUsed,
        pct_elapsed: pctElapsed,
        forecast_7d: forecast7d ?? undefined,
        forecast_30d: forecast30d ?? undefined,
        alert_level: alertLevel === 'ok' ? 'info' : alertLevel === 'escalation' ? 'critical' : alertLevel,
      } as BudgetReport;
      
      const slackResult = await sendSlackNotification(db, slackConfig, budgetReportForNotification, snapshotDate);
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
    
    const budgetReportForNotification: BudgetReport = {
      total_budget: totalBudget,
      budget_used: budgetUsed,
      budget_remaining: totalBudget - budgetUsed,
      pct_used: pctUsed,
      pct_elapsed: pctElapsed,
      forecast_7d: forecast7d ?? undefined,
      forecast_30d: forecast30d ?? undefined,
      alert_level: alertLevel === 'ok' ? 'info' : alertLevel === 'escalation' ? 'critical' : alertLevel,
    } as BudgetReport;
    
    const githubResult = await sendGitHubIssue(db, githubConfig, budgetReportForNotification, snapshotDate);
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
