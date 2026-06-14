import { daysAgo, today } from '../constants.js';
import { loadValueConfig } from './value_config.js';
import { classifyUsers } from './engine.js';
import type { DbClient } from '../db/client.js';
import { sql } from 'drizzle-orm';
import { usersPg, usersSq, classificationHistoryPg, classificationHistorySq } from '../db/schema.js';
import { dialectDb, dialectNow } from '../db/adapter.js';
import * as queries from '../db/queries.js';

export type ClassifyOptions = {
  valueConfigPath: string;
  reason: 'weekly_recalc' | 'manual';
  showReport: boolean;
  /** Optional threshold overrides for consumption-tier classification. */
  classifyThresholds?: { extremePct: number; highPct: number; mediumPct: number };
};

export type ClassifyRunnerResult = {
  totalUsers: number;
  changedUsers: number;
  tierCounts: Record<string, number>;
  missingTeamCount: number;
};
async function writeChanges(
  db: DbClient,
  changes: Array<{
    githubLogin: string; consumptionTierNew: string; valueTierNew: string;
    consumptionTierOld: string | null; valueTierOld: string | null; reason: string;
  }>,
  effectiveDate: string,
  now: string | Date,
) {
  const r = dialectDb(db);
  const usersTable = db.isSqlite ? usersSq : usersPg;
  const historyTable = db.isSqlite ? classificationHistorySq : classificationHistoryPg;
  const nowExpr = dialectNow(db);

  const doWrite = (tx: any) => {
    for (const change of changes) {
      const usersUpdate = tx.update(usersTable)
        .set({
          consumptionTier: change.consumptionTierNew,
          valueTier: change.valueTierNew,
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
          valueTier: change.valueTierNew,
          reason: change.reason,
        })
        .onConflictDoNothing();

      if (db.isSqlite) {
        usersUpdate.run();
        historyInsert.run();
      }
    }
  };

  if (db.isSqlite) {
    r.transaction(doWrite);
  } else {
    await r.transaction(async (tx: any) => {
      for (const change of changes) {
        await tx.update(usersTable)
          .set({
            consumptionTier: change.consumptionTierNew,
            valueTier: change.valueTierNew,
            bucketUpdatedAt: now,
            updatedAt: nowExpr,
          })
          .where(sql`${usersTable.githubLogin} = ${change.githubLogin}`);

        await tx.insert(historyTable)
          .values({
            effectiveDate,
            githubLogin: change.githubLogin,
            consumptionTierOld: change.consumptionTierOld,
            consumptionTierNew: change.consumptionTierNew,
            valueTier: change.valueTierNew,
            reason: change.reason,
          })
          .onConflictDoNothing();
      }
    });
  }
}

/**
 * Run the classification pipeline: load usage data, classify users by
 * consumption and value tiers, write changes to the database.
 */
export async function runClassify(
  db: DbClient,
  options: ClassifyOptions,
): Promise<ClassifyRunnerResult> {
  const valueConfig = loadValueConfig(options.valueConfigPath);
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
    valueTier: r.value_tier,
    bucketUpdatedAt: r.bucket_updated_at instanceof Date ? r.bucket_updated_at.toISOString() : r.bucket_updated_at,
  }));

  const effectiveDate = today();
  const result = classifyUsers(
    userCredits, currentUsers, valueConfig, options.reason, options.classifyThresholds,
  );

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
