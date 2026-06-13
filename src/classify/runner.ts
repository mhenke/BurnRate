import { loadValueConfig, resolveValueTier as resolveValueTierFn } from './value_config.js';
import { classifyUsers } from './engine.js';
import type { DbClient } from '../db/client.js';
import { sql } from 'drizzle-orm';
import { usersPg, usersSq, classificationHistoryPg, classificationHistorySq } from '../db/schema.js';

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

  // Read phase: get 30 days of daily_usage aggregates
  const usageQuery = isSqlite
    ? `SELECT github_login, SUM(credits) as credits
       FROM daily_usage
       WHERE usage_date >= date('now', '-30 days')
       GROUP BY github_login`
    : `SELECT github_login, SUM(credits::numeric) as credits
       FROM daily_usage
       WHERE usage_date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY github_login`;

  const usageRows = await (isSqlite
    ? Promise.resolve(db.all(sql.raw(usageQuery)) as Array<{ github_login: string; credits: string }>)
    : db.execute(sql.raw(usageQuery)).then((r: any) => r.rows as Array<{ github_login: string; credits: string }>));

  if (usageRows.length === 0) {
    throw new Error('No daily_usage data found. Run `burnrate etl` first.');
  }

  // Check for 30 distinct days
  const distinctDaysQuery = isSqlite
    ? `SELECT COUNT(DISTINCT usage_date) as days FROM daily_usage WHERE usage_date >= date('now', '-30 days')`
    : `SELECT COUNT(DISTINCT usage_date) as days FROM daily_usage WHERE usage_date >= CURRENT_DATE - INTERVAL '30 days'`;

  const daysResult = await (isSqlite
    ? Promise.resolve(db.all(sql.raw(distinctDaysQuery)) as Array<{ days: number }>)
    : db.execute(sql.raw(distinctDaysQuery)).then((r: any) => r.rows as Array<{ days: number }>));

  if (daysResult[0].days < 30) {
    throw new Error(`Insufficient data: only ${daysResult[0].days} distinct days found, need 30.`);
  }

  // Read current users
  const usersQuery = `SELECT github_login, team, consumption_tier, value_tier, bucket_updated_at FROM users`;
  const usersRows = await (isSqlite
    ? Promise.resolve(db.all(sql.raw(usersQuery)) as Array<{
        github_login: string;
        team: string | null;
        consumption_tier: string | null;
        value_tier: string | null;
        bucket_updated_at: string | null;
      }>)
    : db.execute(sql.raw(usersQuery)).then((r: any) => r.rows as Array<{
        github_login: string;
        team: string | null;
        consumption_tier: string | null;
        value_tier: string | null;
        bucket_updated_at: string | null;
      }>));

  // Classify
  const userCredits = usageRows.map((r: { github_login: string; credits: string }) => ({
    githubLogin: r.github_login,
    totalCredits: Number(r.credits),
  }));

  const currentUsers = usersRows.map((r: {
    github_login: string;
    team: string | null;
    consumption_tier: string | null;
    value_tier: string | null;
    bucket_updated_at: string | null;
  }) => ({
    githubLogin: r.github_login,
    team: r.team,
    consumptionTier: r.consumption_tier,
    valueTier: r.value_tier,
    bucketUpdatedAt: r.bucket_updated_at,
  }));

  const effectiveDate = new Date().toISOString().slice(0, 10);
  const result = classifyUsers(userCredits, currentUsers, { resolveValueTier }, options.reason);

  // Write phase: use transactions for PostgreSQL, batch for SQLite
  if (result.changes.length > 0) {
    const now = new Date().toISOString();

    if (isSqlite) {
      // SQLite: batch updates (better-sqlite3 transactions require different setup)
      for (const change of result.changes) {
        await db.update(usersSq)
          .set({
            consumptionTier: change.consumptionTierNew,
            valueTier: change.valueTierNew,
            bucketUpdatedAt: now,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(sql`${usersSq.githubLogin} = ${change.githubLogin}`);

        await db.insert(classificationHistorySq)
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
