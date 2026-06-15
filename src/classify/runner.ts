import { daysAgo, today } from '../constants.js';
import { classifyUsers } from './engine.js';
import type { DbClient } from '../db/client.js';
import { sql } from 'drizzle-orm';
import { usersPg, usersSq, classificationHistoryPg, classificationHistorySq } from '../db/schema.js';
import { dialectDb, dialectTable, dialectNow } from '../db/adapter.js';
import * as queries from '../db/queries.js';

export type ClassifyOptions = {
  reason: 'weekly_recalc' | 'manual';
  showReport: boolean;
  classifyThresholds?: { extremePct: number; highPct: number; mediumPct: number };
};

export type ClassifyRunnerResult = {
  totalUsers: number;
  changedUsers: number;
  tierCounts: Record<string, number>;
  missingTeamCount: number;
};

type TierChangeRow = {
  githubLogin: string;
  consumptionTierNew: string;
  consumptionTierOld: string | null;
  reason: string;
};

function buildWriteOps(
  tx: any,
  change: TierChangeRow,
  usersTable: typeof usersPg | typeof usersSq,
  historyTable: typeof classificationHistoryPg | typeof classificationHistorySq,
  effectiveDate: string,
  now: string | Date,
  nowExpr: ReturnType<typeof dialectNow>,
) {
  const usersUpdate = tx.update(usersTable)
    .set({
      consumptionTier: change.consumptionTierNew,
      bucketUpdatedAt: now,
      updatedAt: nowExpr,
    })
    .where(sql`${usersTable.githubLogin} = ${change.githubLogin}`);

  const historyInsert = tx.insert(historyTable)
    .values({
      effectiveDate,
      githubLogin: change.githubLogin,
      consumptionTierOld: change.consumptionTierOld,
      consumptionTierNew: change.consumptionTierNew,
      reason: change.reason,
    })
    .onConflictDoNothing();

  return { usersUpdate, historyInsert };
}

async function writeChanges(
  db: DbClient,
  changes: TierChangeRow[],
  effectiveDate: string,
  now: string | Date,
) {
  const r = dialectDb(db);
  const usersTable = dialectTable(db, usersPg, usersSq);
  const historyTable = dialectTable(db, classificationHistoryPg, classificationHistorySq);
  const nowExpr = dialectNow(db);

  if (db.isSqlite) {
    r.transaction((tx: any) => {
      for (const change of changes) {
        const { usersUpdate, historyInsert } = buildWriteOps(
          tx, change, usersTable, historyTable, effectiveDate, now, nowExpr,
        );
        usersUpdate.run();
        historyInsert.run();
      }
    });
  } else {
    await r.transaction(async (tx: any) => {
      for (const change of changes) {
        const { usersUpdate, historyInsert } = buildWriteOps(
          tx, change, usersTable, historyTable, effectiveDate, now, nowExpr,
        );
        await usersUpdate;
        await historyInsert;
      }
    });
  }
}

export async function runClassify(
  db: DbClient,
  options: ClassifyOptions,
): Promise<ClassifyRunnerResult> {
  const dateString = daysAgo(30);

  const usageRows = await queries.getUsageByUser(db, dateString);
  const distinctDays = await queries.getDistinctUsageDays(db, dateString);
  const usersRows = await queries.getAllUsers(db);

  if (usageRows.length === 0) {
    throw new Error('No daily_usage data found. Run `burnrate etl` first.');
  }

  if (distinctDays < 30) {
    throw new Error(`Insufficient data: only ${distinctDays} distinct days found, need 30.`);
  }

  const userCredits = usageRows.map((r) => ({
    githubLogin: r.github_login || '',
    totalCredits: Number(r.credits),
  }));

  const currentUsers = usersRows.map((r) => ({
    githubLogin: r.github_login,
    team: r.team,
    consumptionTier: r.consumption_tier,
    bucketUpdatedAt: r.bucket_updated_at instanceof Date ? r.bucket_updated_at.toISOString() : r.bucket_updated_at,
  }));

  const effectiveDate = today();
  const result = classifyUsers(userCredits, currentUsers, options.reason, options.classifyThresholds);

  if (result.changes.length > 0) {
    await writeChanges(db, result.changes, effectiveDate,
      db.isSqlite ? new Date().toISOString() : new Date());
  }

  return {
    totalUsers: result.stats.totalUsers,
    changedUsers: result.stats.changedUsers,
    tierCounts: result.stats.tierCounts as Record<string, number>,
    missingTeamCount: result.stats.missingTeamCount,
  };
}
