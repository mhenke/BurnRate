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

function d(db: DbClient): any {
  return db as any;
}

export function getTables(db: DbClient) {
  if (db.isSqlite) {
    return {
      rawReports: rawReportsSq,
      users: usersSq,
      dailyUsage: dailyUsageSq,
      teamUsage: teamUsageSq,
      poolSnapshots: poolSnapshotsSq,
      budgetSnapshots: budgetSnapshotsSq,
      notificationLog: notificationLogSq,
      now: sql`CURRENT_TIMESTAMP`,
    };
  }
  return {
    rawReports: rawReportsPg,
    users: usersPg,
    dailyUsage: dailyUsagePg,
    teamUsage: teamUsagePg,
    poolSnapshots: poolSnapshotsPg,
    budgetSnapshots: budgetSnapshotsPg,
    notificationLog: notificationLogPg,
    now: sql`now()`,
  };
}

export type DailyUsageSummaryRow = { usage_date: string; credits: number };
export async function getDailyUsageSummary(db: DbClient, sinceDate: string): Promise<DailyUsageSummaryRow[]> {
  const isSq = db.isSqlite;
  const table = isSq ? dailyUsageSq : dailyUsagePg;
  const rows = await d(db)
    .select({
      usage_date: table.usageDate,
      credits: sql<number>`SUM(${table.credits})`.mapWith(Number),
    })
    .from(table)
    .where(gte(table.usageDate, sinceDate))
    .groupBy(table.usageDate)
    .orderBy(table.usageDate);
  return rows;
}

export async function getLatestPoolTotal(db: DbClient): Promise<number> {
  const isSq = db.isSqlite;
  const table = isSq ? poolSnapshotsSq : poolSnapshotsPg;
  const rows = await d(db)
    .select({
      total_credits: table.totalCredits,
    })
    .from(table)
    .orderBy(desc(table.snapshotDate))
    .limit(1);
  return rows.length > 0 ? Number(rows[0].total_credits) : 0;
}

export type UsageByUserRow = { github_login: string | null; credits: number };
export async function getUsageByUser(db: DbClient, sinceDate: string): Promise<UsageByUserRow[]> {
  const isSq = db.isSqlite;
  const table = isSq ? dailyUsageSq : dailyUsagePg;
  const rows = await d(db)
    .select({
      github_login: table.githubLogin,
      credits: sql<number>`SUM(${table.credits})`.mapWith(Number),
    })
    .from(table)
    .where(gte(table.usageDate, sinceDate))
    .groupBy(table.githubLogin);
  return rows;
}

export async function getDistinctUsageDays(db: DbClient, sinceDate: string): Promise<number> {
  const isSq = db.isSqlite;
  const table = isSq ? dailyUsageSq : dailyUsagePg;
  const rows = await d(db)
    .select({
      days: sql<number>`COUNT(DISTINCT ${table.usageDate})`.mapWith(Number),
    })
    .from(table)
    .where(gte(table.usageDate, sinceDate));
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
  const isSq = db.isSqlite;
  const table = isSq ? usersSq : usersPg;
  const rows = await d(db)
    .select({
      github_login: table.githubLogin,
      team: table.team,
      consumption_tier: table.consumptionTier,
      value_tier: table.valueTier,
      bucket_updated_at: table.bucketUpdatedAt,
    })
    .from(table);
  return rows;
}

export type PoolSnapshotRow = {
  forecast7d: string | number | null;
  forecast30d: string | number | null;
  totalCredits: string | number | null;
  creditsUsed: string | number | null;
};
export async function getLatestPoolSnapshot(db: DbClient): Promise<PoolSnapshotRow | null> {
  const isSq = db.isSqlite;
  const table = isSq ? poolSnapshotsSq : poolSnapshotsPg;
  const rows = await d(db)
    .select({
      forecast7d: table.forecast7d,
      forecast30d: table.forecast30d,
      totalCredits: table.totalCredits,
      creditsUsed: table.creditsUsed,
    })
    .from(table)
    .orderBy(desc(table.snapshotDate))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

export type BudgetSnapshotRow = {
  snapshotDate: string;
  alertLevel: string | null;
};
export async function getBudgetSnapshotByDate(db: DbClient, date: string): Promise<BudgetSnapshotRow | null> {
  const isSq = db.isSqlite;
  const table = isSq ? budgetSnapshotsSq : budgetSnapshotsPg;
  const rows = await d(db)
    .select({
      snapshotDate: table.snapshotDate,
      alertLevel: table.alertLevel,
    })
    .from(table)
    .where(eq(table.snapshotDate, date))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
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
  const isPg = !db.isSqlite;
  if (isPg) {
    await d(db)
      .insert(budgetSnapshotsPg)
      .values({
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
      })
      .onConflictDoUpdate({
        target: budgetSnapshotsPg.snapshotDate,
        set: {
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
          updatedAt: new Date(),
        },
      });
  } else {
    await d(db)
      .insert(budgetSnapshotsSq)
      .values({
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
      })
      .onConflictDoUpdate({
        target: budgetSnapshotsSq.snapshotDate,
        set: {
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
          updatedAt: new Date().toISOString(),
        },
      });
  }
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
  const isPg = !db.isSqlite;
  if (isPg) {
    await d(db)
      .insert(notificationLogPg)
      .values({
        snapshotDate: entry.snapshotDate,
        channel: entry.channel,
        notificationType: entry.notificationType,
        externalId: entry.externalId || null,
        payload: entry.payload as any,
        success: entry.success,
        errorMessage: entry.errorMessage || null,
      })
      .onConflictDoNothing();
  } else {
    await d(db)
      .insert(notificationLogSq)
      .values({
        snapshotDate: entry.snapshotDate,
        channel: entry.channel,
        notificationType: entry.notificationType,
        externalId: entry.externalId || null,
        payload: entry.payload as any,
        success: entry.success ? 1 : 0,
        errorMessage: entry.errorMessage || null,
      })
      .onConflictDoNothing();
  }
}
