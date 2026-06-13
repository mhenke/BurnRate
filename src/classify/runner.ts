import { loadValueConfig, resolveValueTier as resolveValueTierFn } from './value_config.js';
import { classifyUsers } from './engine.js';
import type { DbClient } from '../db/client.js';
import { sql, gte } from 'drizzle-orm';
import { usersPg, usersSq, classificationHistoryPg, classificationHistorySq, dailyUsagePg, dailyUsageSq } from '../db/schema.js';

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

function getTables(isSqlite: boolean) {
  if (isSqlite) {
    return { users: usersSq, classificationHistory: classificationHistorySq };
  }
  return { users: usersPg, classificationHistory: classificationHistoryPg };
}

export async function runClassify(
  db: DbClient,
  options: ClassifyOptions,
): Promise<ClassifyRunnerResult> {
  const isSqlite = typeof db.run === 'function';
  const T = getTables(isSqlite);

  // Load value config
  const valueConfig = loadValueConfig(options.valueConfigPath);
  const resolveValueTier = (team: string | null) => resolveValueTierFn(team, valueConfig);

  const dailyUsageTable = isSqlite ? dailyUsageSq : dailyUsagePg;
  const usersTable = isSqlite ? usersSq : usersPg;

  // Calculate threshold date (30 days ago) in JS as YYYY-MM-DD
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - 30);
  const dateString = thresholdDate.toISOString().slice(0, 10);

  // Read phase: get 30 days of daily_usage aggregates using Drizzle
  const usageRows = await db
    .select({
      github_login: dailyUsageTable.githubLogin,
      credits: sql<number>`SUM(${dailyUsageTable.credits})`.mapWith(Number),
    })
    .from(dailyUsageTable)
    .where(gte(dailyUsageTable.usageDate, dateString))
    .groupBy(dailyUsageTable.githubLogin);

  if (usageRows.length === 0) {
    throw new Error('No daily_usage data found. Run `burnrate etl` first.');
  }

  // Check for 30 distinct days using Drizzle
  const daysResult = await db
    .select({
      days: sql<number>`COUNT(DISTINCT ${dailyUsageTable.usageDate})`.mapWith(Number),
    })
    .from(dailyUsageTable)
    .where(gte(dailyUsageTable.usageDate, dateString));

  const distinctDays = daysResult[0]?.days ?? 0;
  if (distinctDays < 30) {
    throw new Error(`Insufficient data: only ${distinctDays} distinct days found, need 30.`);
  }

  // Read current users using Drizzle
  const usersRows = await db
    .select({
      github_login: usersTable.githubLogin,
      team: usersTable.team,
      consumption_tier: usersTable.consumptionTier,
      value_tier: usersTable.valueTier,
      bucket_updated_at: usersTable.bucketUpdatedAt,
    })
    .from(usersTable);

  // Classify
  const userCredits = usageRows.map((r: any) => ({
    githubLogin: r.github_login,
    totalCredits: Number(r.credits),
  }));

  const currentUsers = usersRows.map((r: any) => ({
    githubLogin: r.github_login,
    team: r.team,
    consumptionTier: r.consumption_tier,
    valueTier: r.value_tier,
    bucketUpdatedAt: r.bucket_updated_at,
  }));

  const effectiveDate = new Date().toISOString().slice(0, 10);
  const result = classifyUsers(userCredits, currentUsers, { resolveValueTier }, options.reason);

  // Write phase: use transaction for SQLite and PostgreSQL
  if (result.changes.length > 0) {
    const now = new Date().toISOString();

    if (isSqlite) {
      db.transaction((tx: any) => {
        for (const change of result.changes) {
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
    } else {
      await db.transaction(async (tx: any) => {
        for (const change of result.changes) {
          await tx.update(usersPg)
            .set({
              consumptionTier: change.consumptionTierNew,
              valueTier: change.valueTierNew,
              bucketUpdatedAt: new Date(now),
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
  }

  return {
    totalUsers: result.stats.totalUsers,
    changedUsers: result.stats.changedUsers,
    tierCounts: result.stats.tierCounts as Record<string, number>,
    missingTeamCount: result.stats.missingTeamCount,
  };
}
