import type { DbClient } from './client.js';
import { sql, gte, eq, desc } from 'drizzle-orm';
import {
  rawReportsPg, rawReportsSq,
  usersPg, usersSq,
  dailyUsagePg, dailyUsageSq,
  teamUsagePg, teamUsageSq,
  poolSnapshotsPg, poolSnapshotsSq,
  budgetSnapshotsPg, budgetSnapshotsSq,
  notificationLogPg, notificationLogSq,
} from './schema.js';
import { runner, dialectTable, dialectNow } from './adapter.js';

export type DailyUsageSummaryRow = { usage_date: string; credits: number };
export async function getDailyUsageSummary(db: DbClient, sinceDate: string): Promise<DailyUsageSummaryRow[]> {
  const r = runner(db);
  const t = dialectTable(db, dailyUsagePg, dailyUsageSq);
  return r
    .select({
      usage_date: t.usageDate,
      credits: sql<number>`SUM(${t.credits})`.mapWith(Number),
    })
    .from(t)
    .where(gte(t.usageDate, sinceDate))
    .groupBy(t.usageDate)
    .orderBy(t.usageDate) as DailyUsageSummaryRow[];
}

export async function getLatestPoolTotal(db: DbClient): Promise<number> {
  const r = runner(db);
  const t = dialectTable(db, poolSnapshotsPg, poolSnapshotsSq);
  const rows = await r
    .select({ total_credits: t.totalCredits })
    .from(t)
    .orderBy(desc(t.snapshotDate))
    .limit(1);
  return rows.length > 0 ? Number(rows[0].total_credits) : 0;
}

export type UsageByUserRow = { github_login: string | null; credits: number };
export async function getUsageByUser(db: DbClient, sinceDate: string): Promise<UsageByUserRow[]> {
  const r = runner(db);
  const t = dialectTable(db, dailyUsagePg, dailyUsageSq);
  return r
    .select({
      github_login: t.githubLogin,
      credits: sql<number>`SUM(${t.credits})`.mapWith(Number),
    })
    .from(t)
    .where(gte(t.usageDate, sinceDate))
    .groupBy(t.githubLogin) as UsageByUserRow[];
}

export async function getDistinctUsageDays(db: DbClient, sinceDate: string): Promise<number> {
  const r = runner(db);
  const t = dialectTable(db, dailyUsagePg, dailyUsageSq);
  const rows = await r
    .select({ days: sql<number>`COUNT(DISTINCT ${t.usageDate})`.mapWith(Number) })
    .from(t)
    .where(gte(t.usageDate, sinceDate));
  return rows[0]?.days ?? 0;
}

export type UserSummaryRow = {
  github_login: string;
  team: string | null;
  consumption_tier: string | null;
  value_tier: string | null;
  bucket_updated_at: string | Date | null;
};
export async function getAllUsers(db: DbClient): Promise<UserSummaryRow[]> {
  const r = runner(db);
  const t = dialectTable(db, usersPg, usersSq);
  return r
    .select({
      github_login: t.githubLogin,
      team: t.team,
      consumption_tier: t.consumptionTier,
      value_tier: t.valueTier,
      bucket_updated_at: t.bucketUpdatedAt,
    })
    .from(t) as UserSummaryRow[];
}

export type PoolSnapshotRow = {
  forecast7d: string | number | null;
  forecast30d: string | number | null;
  totalCredits: string | number | null;
  creditsUsed: string | number | null;
};
export async function getLatestPoolSnapshot(db: DbClient): Promise<PoolSnapshotRow | null> {
  const r = runner(db);
  const t = dialectTable(db, poolSnapshotsPg, poolSnapshotsSq);
  const rows = await r
    .select({
      forecast7d: t.forecast7d,
      forecast30d: t.forecast30d,
      totalCredits: t.totalCredits,
      creditsUsed: t.creditsUsed,
    })
    .from(t)
    .orderBy(desc(t.snapshotDate))
    .limit(1);
  return rows.length > 0 ? (rows[0] as PoolSnapshotRow) : null;
}

export type BudgetSnapshotRow = {
  snapshotDate: string;
  alertLevel: string | null;
};
export async function getBudgetSnapshotByDate(db: DbClient, date: string): Promise<BudgetSnapshotRow | null> {
  const r = runner(db);
  const t = dialectTable(db, budgetSnapshotsPg, budgetSnapshotsSq);
  const rows = await r
    .select({ snapshotDate: t.snapshotDate, alertLevel: t.alertLevel })
    .from(t)
    .where(eq(t.snapshotDate, date))
    .limit(1);
  return rows.length > 0 ? (rows[0] as BudgetSnapshotRow) : null;
}

export type BudgetSnapshotInsert = {
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
};

export async function upsertBudgetSnapshot(db: DbClient, snapshot: BudgetSnapshotInsert): Promise<void> {
  const r = runner(db);
  const t = dialectTable(db, budgetSnapshotsPg, budgetSnapshotsSq);
  const now = dialectNow(db);
  const updatedAt = db.isSqlite ? new Date().toISOString() : new Date();

  const row = {
    snapshotDate: snapshot.snapshotDate,
    totalBudget: snapshot.totalBudget.toString(),
    budgetUsed: snapshot.budgetUsed.toString(),
    budgetRemaining: snapshot.budgetRemaining.toString(),
    pctUsed: snapshot.pctUsed.toString(),
    pctElapsed: snapshot.pctElapsed.toString(),
    forecast7d: snapshot.forecast7d?.toString() ?? null,
    forecast30d: snapshot.forecast30d?.toString() ?? null,
    pctOfBudget7d: snapshot.pctOfBudget7d?.toString() ?? null,
    pctOfBudget30d: snapshot.pctOfBudget30d?.toString() ?? null,
    alertLevel: snapshot.alertLevel,
    source: snapshot.source,
    note: snapshot.note,
    updatedAt,
  };

  await r.insert(t).values(row)
    .onConflictDoUpdate({
      target: t.snapshotDate,
      set: {
        totalBudget: row.totalBudget,
        budgetUsed: row.budgetUsed,
        budgetRemaining: row.budgetRemaining,
        pctUsed: row.pctUsed,
        pctElapsed: row.pctElapsed,
        forecast7d: row.forecast7d,
        forecast30d: row.forecast30d,
        pctOfBudget7d: row.pctOfBudget7d,
        pctOfBudget30d: row.pctOfBudget30d,
        alertLevel: row.alertLevel,
        source: row.source,
        note: row.note,
        updatedAt: row.updatedAt,
      },
    });
}

export type NotificationLogEntry = {
  snapshotDate: string;
  channel: 'slack' | 'github_issue';
  notificationType: string;
  externalId?: string;
  payload: unknown;
  success: boolean;
  errorMessage?: string;
};

export async function insertNotificationLog(db: DbClient, entry: NotificationLogEntry): Promise<void> {
  const r = runner(db);
  const t = dialectTable(db, notificationLogPg, notificationLogSq);

  await r.insert(t).values({
    snapshotDate: entry.snapshotDate,
    channel: entry.channel,
    notificationType: entry.notificationType,
    externalId: entry.externalId || null,
    payload: entry.payload as any,
    success: db.isSqlite ? (entry.success ? 1 : 0) : entry.success,
    errorMessage: entry.errorMessage || null,
  }).onConflictDoNothing();
}
