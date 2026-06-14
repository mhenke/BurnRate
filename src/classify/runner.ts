import { loadValueConfig, resolveValueTier as resolveValueTierFn } from './value_config.js';
import { classifyUsers } from './engine.js';
import type { DbClient } from '../db/client.js';
import { sql, gte } from 'drizzle-orm';
import { usersPg, usersSq, classificationHistoryPg, classificationHistorySq, dailyUsagePg, dailyUsageSq } from '../db/schema.js';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

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

/**
 * Run the classification pipeline: load usage data, classify users by
 * consumption and value tiers, write changes to the database.
 */
export async function runClassify(
  db: DbClient,
  options: ClassifyOptions,
): Promise<ClassifyRunnerResult> {
  const isSqlite = typeof (db as any).run === 'function';

  // Load value config
  const valueConfig = loadValueConfig(options.valueConfigPath);
  const resolveValueTier = (team: string | null) => resolveValueTierFn(team, valueConfig);

  // Calculate threshold date (30 days ago) in JS as YYYY-MM-DD
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - 30);
  const dateString = thresholdDate.toISOString().slice(0, 10);

  let usageRows: { github_login: string | null; credits: number }[] = [];
  let distinctDays = 0;
  let usersRows: {
    github_login: string;
    team: string | null;
    consumption_tier: string | null;
    value_tier: string | null;
    bucket_updated_at: string | Date | null;
  }[] = [];

  if (isSqlite) {
    const sqliteDb = db as BetterSQLite3Database<any>;
    const rawUsage = await sqliteDb
      .select({
        github_login: dailyUsageSq.githubLogin,
        credits: sql<number>`SUM(${dailyUsageSq.credits})`.mapWith(Number),
      })
      .from(dailyUsageSq)
      .where(gte(dailyUsageSq.usageDate, dateString))
      .groupBy(dailyUsageSq.githubLogin);
    usageRows = rawUsage;

    const daysResult = await sqliteDb
      .select({
        days: sql<number>`COUNT(DISTINCT ${dailyUsageSq.usageDate})`.mapWith(Number),
      })
      .from(dailyUsageSq)
      .where(gte(dailyUsageSq.usageDate, dateString));
    distinctDays = daysResult[0]?.days ?? 0;

    const rawUsers = await sqliteDb
      .select({
        github_login: usersSq.githubLogin,
        team: usersSq.team,
        consumption_tier: usersSq.consumptionTier,
        value_tier: usersSq.valueTier,
        bucket_updated_at: usersSq.bucketUpdatedAt,
      })
      .from(usersSq);
    usersRows = rawUsers;
  } else {
    const pgDb = db as NodePgDatabase<any>;
    const rawUsage = await pgDb
      .select({
        github_login: dailyUsagePg.githubLogin,
        credits: sql<number>`SUM(${dailyUsagePg.credits})`.mapWith(Number),
      })
      .from(dailyUsagePg)
      .where(gte(dailyUsagePg.usageDate, dateString))
      .groupBy(dailyUsagePg.githubLogin);
    usageRows = rawUsage as any;

    const daysResult = await pgDb
      .select({
        days: sql<number>`COUNT(DISTINCT ${dailyUsagePg.usageDate})`.mapWith(Number),
      })
      .from(dailyUsagePg)
      .where(gte(dailyUsagePg.usageDate, dateString));
    distinctDays = daysResult[0]?.days ?? 0;

    const rawUsers = await pgDb
      .select({
        github_login: usersPg.githubLogin,
        team: usersPg.team,
        consumption_tier: usersPg.consumptionTier,
        value_tier: usersPg.valueTier,
        bucket_updated_at: usersPg.bucketUpdatedAt,
      })
      .from(usersPg);
    usersRows = rawUsers as any;
  }

  if (usageRows.length === 0) {
    throw new Error('No daily_usage data found. Run `burnrate etl` first.');
  }

  if (distinctDays < 30) {
    throw new Error(`Insufficient data: only ${distinctDays} distinct days found, need 30.`);
  }

  // Classify
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
  const result = classifyUsers(userCredits, currentUsers, { resolveValueTier }, options.reason);

  // Write phase: use transaction for SQLite and PostgreSQL
  if (result.changes.length > 0) {
    const now = new Date().toISOString();

    if (isSqlite) {
      const sqliteDb = db as BetterSQLite3Database<any>;
      sqliteDb.transaction((tx) => {
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
      const pgDb = db as NodePgDatabase<any>;
      await pgDb.transaction(async (tx) => {
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
