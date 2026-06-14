import type { DbClient } from '../db/client.js';
import type { GitHubClient } from '../github/client.js';
import { fetchBilling, type BudgetBillingData } from '../github/budget.js';
import * as queries from '../db/queries.js';
import { sanitizeErrorMessage } from '../notifications/sanitize.js';
import { NotificationService } from '../notifications/service.js';
import type { BurnRateAlert, NotificationProviderConfig } from '../notifications/types.js';
import { computeAlertLevel, today, daysAgo, type AlertLevel } from '../constants.js';

export type BudgetReport = {
  totalBudget: number; budgetUsed: number; budgetRemaining: number;
  pctUsed: number; pctElapsed: number;
  forecast7d: number | null; forecast30d: number | null;
  alertLevel: string;
};

export type BudgetSyncConfig = {
  db: DbClient;
  github: GitHubClient;
  notificationProviders: NotificationProviderConfig[];
  renotifyHours?: number;
  escalateDays?: number;
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
  notificationsDispatched: number;
  errors: string[];
};

type PoolSnapshot = {
  forecast7d: string | number | null;
  forecast30d: string | number | null;
  totalCredits: string | number | null;
  creditsUsed: string | number | null;
};

function parseNumeric(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? parseFloat(value) : value;
}

function computePctElapsed(now: Date = new Date()): number {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round((now.getDate() / daysInMonth) * 10000) / 100;
}

function buildBudgetAlert(
  snapshotDate: string,
  alertLevel: AlertLevel,
  totalBudget: number,
  budgetUsed: number,
  pctUsed: number,
  pctElapsed: number,
  forecast7d: number | null,
  forecast30d: number | null,
): BurnRateAlert {
  const budgetRemaining = totalBudget - budgetUsed;

  const subjectMap: Record<string, string> = {
    ok: `Budget Alert: All Clear - ${snapshotDate}`,
    critical: `Budget Alert: CRITICAL - ${snapshotDate}`,
    escalation: `Budget Alert: ESCALATION - ${snapshotDate}`,
    warning: `Budget Alert: WARNING - ${snapshotDate}`,
  };

  const bodyLines = [
    `Budget status for ${snapshotDate}:`,
    `- Total Budget: $${totalBudget.toFixed(2)}`,
    `- Budget Used: $${budgetUsed.toFixed(2)}`,
    `- Budget Remaining: $${budgetRemaining.toFixed(2)}`,
    `- % Used: ${pctUsed.toFixed(1)}%`,
    `- % Elapsed: ${pctElapsed.toFixed(1)}%`,
    forecast7d !== null ? `- Forecast 7d: $${forecast7d.toFixed(2)}` : null,
    forecast30d !== null ? `- Forecast 30d: $${forecast30d.toFixed(2)}` : null,
  ].filter(Boolean).join('\n');

  return {
    id: `budget-${snapshotDate}`,
    timestamp: new Date(),
    level: alertLevel,
    persistentDays: 0,
    type: 'budget',
    subject: subjectMap[alertLevel] ?? `Budget Alert: ${alertLevel.toUpperCase()} - ${snapshotDate}`,
    body: bodyLines,
    data: {
      totalBudget,
      budgetUsed,
      budgetRemaining,
      pctUsed,
      pctElapsed,
      forecast7d,
      forecast30d,
    },
    tags: ['budget', alertLevel],
  };
}

async function dispatchNotifications(
  alert: BurnRateAlert,
  snapshotDate: string,
  alertLevel: AlertLevel,
  yesterdayAlertLevel: string,
  notificationService: NotificationService,
): Promise<{ notificationsDispatched: number; errors: string[] }> {
  const errors: string[] = [];

  const shouldNotify = alertLevel !== 'ok' && alertLevel !== yesterdayAlertLevel;
  const shouldNotifyAllClear = alertLevel === 'ok' && yesterdayAlertLevel !== 'ok' && yesterdayAlertLevel !== null;

  if (!shouldNotify && !shouldNotifyAllClear) {
    return { notificationsDispatched: 0, errors: [] };
  }

  const dispatchResult = await notificationService.dispatch(alert, snapshotDate, 'budget_alert', alertLevel === 'ok');

  for (const result of dispatchResult.results) {
    if (!result.success) {
      errors.push(`${result.channel} notification failed: ${result.errorMessage}`);
    }
  }

  return {
    notificationsDispatched: dispatchResult.results.filter((r) => r.success).length,
    errors,
  };
}

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

export async function runBudgetSync(config: BudgetSyncConfig): Promise<BudgetSyncResult> {
  const { db, github, notificationProviders, renotifyHours = 24, escalateDays = 3, dryRun = false } = config;

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

  let notificationsDispatched = 0;
  let notificationErrors: string[] = [];

  if (!dryRun && notificationProviders.length > 0) {
    const notificationService = new NotificationService(db, notificationProviders, renotifyHours, escalateDays);
    const alert = buildBudgetAlert(
      snapshotDate, stats.alertLevel, stats.totalBudget, stats.budgetUsed,
      stats.pctUsed, pctElapsed, stats.forecast7d, stats.forecast30d,
    );
    const dispatchResult = await dispatchNotifications(
      alert, snapshotDate, stats.alertLevel, yesterdayAlertLevel, notificationService,
    );
    notificationsDispatched = dispatchResult.notificationsDispatched;
    notificationErrors = dispatchResult.errors;
  }
  errors.push(...notificationErrors);

  return {
    snapshotDate,
    totalBudget: stats.totalBudget,
    budgetUsed: stats.budgetUsed,
    pctUsed: stats.pctUsed,
    pctOfBudget7d: stats.pctOfBudget7d,
    pctOfBudget30d: stats.pctOfBudget30d,
    alertLevel: stats.alertLevel,
    notificationsDispatched,
    errors,
  };
}
