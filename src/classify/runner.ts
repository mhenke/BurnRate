import { daysAgo } from '../constants.js';
import { loadValueConfig } from './value_config.js';
import { classifyUsers } from './engine.js';
import type { DbClient } from '../db/client.js';
import { sql } from 'drizzle-orm';
import { usersPg, usersSq, classificationHistoryPg, classificationHistorySq } from '../db/schema.js';
import { runner } from '../db/adapter.js';
import * as queries from '../db/queries.js';

export type ClassifyOptions = {
  valueConfigPath: string;
  reason: 'weekly_recalc' | 'manual';
  showReport: boolean;
};

export type ClassifyRunnerResult = {
  totalUsers: number;
  changedUsers: number;
  tierCounts: Record<string, number>;
  missingTeamCount: number;
};
async function writeSqliteChanges(
  db: DbClient,
  changes: Array<{
    githubLogin: string; consumptionTierNew: string; valueTierNew: string;
    consumptionTierOld: string | null; valueTierOld: string | null; reason: string;
  }>,
  effectiveDate: string,
  now: string,
) {
  const r = runner(db);
  r.transaction((tx: any) => {
    for (const change of changes) {
      tx.update(usersSq)
        .set({
          consumptionTier: change.consumptionTierNew,
          valueTier: change.valueTierNew,
          bucketUpdatedAt: now,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(sql`${usersSq.githubLogin} = ${change.githubLogin}`)
        .run();

      tx.insert(classificationHistorySq)
        .values({
          effectiveDate,
          githubLogin: change.githubLogin,
          consumptionTierOld: change.consumptionTierOld,
          consumptionTierNew: change.consumptionTierNew,
          valueTier: change.valueTierNew,
          reason: change.reason,
        })
        .onConflictDoNothing()
        .run();
    }
  });
}

async function writePgChanges(
  db: DbClient,
  changes: Array<{
    githubLogin: string; consumptionTierNew: string; valueTierNew: string;
    consumptionTierOld: string | null; valueTierOld: string | null; reason: string;
  }>,
  effectiveDate: string,
  now: Date,
) {
  const r = runner(db);
  await r.transaction(async (tx: any) => {
    for (const change of changes) {
      await tx.update(usersPg)
        .set({
          consumptionTier: change.consumptionTierNew,
          valueTier: change.valueTierNew,
          bucketUpdatedAt: now,
          updatedAt: sql`now()`,
        })
        .where(sql`${usersPg.githubLogin} = ${change.githubLogin}`);

      await tx.insert(classificationHistoryPg)
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

  const effectiveDate = new Date().toISOString().slice(0, 10);
  const result = classifyUsers(userCredits, currentUsers, valueConfig, options.reason);

  if (result.changes.length > 0) {
    if (db.isSqlite) {
      await writeSqliteChanges(db, result.changes, effectiveDate, new Date().toISOString());
    } else {
      await writePgChanges(db, result.changes, effectiveDate, new Date());
    }
  }

  return {
    totalUsers: result.stats.totalUsers,
    changedUsers: result.stats.changedUsers,
    tierCounts: result.stats.tierCounts as Record<string, number>,
    missingTeamCount: result.stats.missingTeamCount,
  };
}
