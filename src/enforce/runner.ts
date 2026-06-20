import { today, daysAgo } from '../constants.js';
import { sql } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import * as queries from '../db/queries.js';
import { dialectDb } from '../db/adapter.js';
import { ulbAuditPg, ulbAuditSq } from '../db/schema.js';
import { runEngine } from './engine.js';
import type { BudgetPolicy, EnforceOptions, EnforceResult, UserState } from './types.js';
import type { ConsumptionTier } from './types.js';

const CREDIT_TO_USD = 0.01;

function ensureTier(tier: string | null): ConsumptionTier {
  if (tier === 'extreme' || tier === 'high' || tier === 'medium' || tier === 'low') {
    return tier;
  }
  return 'medium';
}

/**
 * Run the daily enforcement pipeline.
 *
 * Reads pool usage and user consumption from the database, projects
 * end-of-month burn, calculates tier-weighted user-level budgets from
 * 30-day averages, and writes ULB audit records.
 *
 * @param db Active database client (PG or SQLite).
 * @param policy Budget enforcement policy (mode, buffer, tier weights).
 * @param options Runtime options (dry run, reason).
 * @returns The enforcement result with projection, gap, and user changes.
 *
 * @throws If pool_snapshots or daily_usage tables are empty or stale.
 *
 * Data freshness: This runner validates that the latest pool snapshot
 * is no older than yesterday (UTC). If ETL failed silently (rate limit,
 * network timeout), stale data would produce incorrect projections.
 *
 * Projection basis: `poolSnapshot.creditsUsed` is the month-to-date
 * credits consumed from the pool (not cumulative since pool creation).
 * This is the standard interpretation from the pool_snapshots schema.
 */
export async function runEnforce(
  db: DbClient,
  policy: BudgetPolicy,
  options: EnforceOptions,
): Promise<EnforceResult> {
  const poolSnapshot = await queries.getLatestPoolSnapshot(db);
  if (!poolSnapshot || poolSnapshot.totalCredits === null) {
    throw new Error('No pool_snapshots data found. Run `burnrate etl` first.');
  }

  // Finding #1: Validate ETL freshness — reject stale pool data.
  // If the latest snapshot is older than yesterday, ETL likely failed.
  const snapshotDate = (poolSnapshot as any).snapshotDate
    ?? (poolSnapshot as any).snapshot_date;
  if (snapshotDate) {
    const yesterday = daysAgo(1);
    if (snapshotDate < yesterday) {
      throw new Error(
        `pool_snapshots data is stale: last snapshot ${snapshotDate}, expected >= ${yesterday}. ` +
        `Run \`burnrate etl\` to refresh.`
      );
    }
  }

  const poolTotal = Number(poolSnapshot.totalCredits);
  // Finding #11: creditsUsed is month-to-date credits consumed from the pool,
  // NOT cumulative since pool creation. This is the standard pool_snapshots semantics.
  const creditsUsed = Number(poolSnapshot.creditsUsed ?? 0);

  const dateString30d = new Date();
  dateString30d.setDate(dateString30d.getDate() - 30);
  const sinceDate = dateString30d.toISOString().slice(0, 10);

  const usageRows = await queries.getUsageByUser(db, sinceDate);
  const distinctDays = await queries.getDistinctUsageDays(db, sinceDate);
  if (usageRows.length === 0 || distinctDays === 0) {
    throw new Error('No daily_usage data found. Run `burnrate etl` first.');
  }

  const userRows = await queries.getAllUsers(db);
  const previousUlbs = await queries.getLatestUlbForAllUsers(db);

  const orgDailyAvg = usageRows.length > 0
    ? usageRows.reduce((sum, r) => sum + Number(r.credits), 0) / distinctDays / usageRows.length
    : 0.001; // Fallback for new orgs with zero activity — ensures new users get a small allocation

  // Finding #2: Use UTC consistently via today() which returns UTC ISO date.
  const now = new Date();
  const daysInCycle = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = now.getUTCDate();

  const users: UserState[] = [];
  const usageMap = new Map(usageRows.map(r => [r.github_login, Number(r.credits)]));

  for (const u of userRows) {
    const total30d = usageMap.get(u.github_login) ?? 0;
    const dailyAvg30d = total30d > 0 ? total30d / 30 : Math.max(orgDailyAvg, 0.001);
    const tier = ensureTier(u.consumption_tier);
    const daysRemaining = daysInCycle - daysElapsed;
    const currentUlb = previousUlbs.get(u.github_login)
      ?? Math.round(dailyAvg30d * daysRemaining * (policy.tierWeights[tier] ?? 1.0));

    users.push({
      githubLogin: u.github_login,
      consumptionTier: tier,
      dailyAvg30d,
      currentUlb,
      daysRemaining,
    });
  }

  const result = runEngine({
    poolTotal,
    creditsUsedMtd: creditsUsed,
    daysElapsed,
    daysInCycle,
    users,
    policy,
  });

  if (options.dryRun) {
    return result;
  }

  if (result.changes.length === 0) {
    return result;
  }

  const effectiveDate = today();

  // Finding #7: For users with no previous ULB, the initial allocation is
  // computed by the engine as part of restore logic. Write these with
  // reason='initial_allocation' so the audit trail distinguishes first-time
  // allocations from cuts/restores.
  const auditEntries = result.changes.map(c => {
    const isNewAllocation = c.previousUlb === 0 || !previousUlbs.has(c.githubLogin);
    return {
      effectiveDate,
      githubLogin: c.githubLogin,
      ulbUsd: Math.round(c.newUlb * CREDIT_TO_USD), // Finding #10: Math.round not Math.ceil
      ulbCredits: c.newUlb,
      tierAtTime: c.tier,
      baselineCredits: c.baseline,
      reason: isNewAllocation ? 'initial_allocation' : options.reason,
    };
  });

  // Wrap audit writes in a transaction so partial failures don't leave
  // inconsistent state. Follows the classify runner's dialect-aware pattern:
  // SQLite uses synchronous transactions (better-sqlite3), PG uses async.
  const r = dialectDb(db);
  const ulbTable = db.isSqlite ? ulbAuditSq : ulbAuditPg;
  const auditNow = db.isSqlite ? new Date().toISOString() : new Date();

  if (db.isSqlite) {
    r.transaction((tx: any) => {
      for (const entry of auditEntries) {
        tx.insert(ulbTable).values({
          effectiveDate: entry.effectiveDate,
          githubLogin: entry.githubLogin,
          ulbUsd: entry.ulbUsd.toString(),
          ulbCredits: entry.ulbCredits.toString(),
          tierAtTime: entry.tierAtTime,
          baselineCredits: entry.baselineCredits.toString(),
          reason: entry.reason,
        }).onConflictDoUpdate({
          target: [ulbTable.effectiveDate, ulbTable.githubLogin],
          set: {
            ulbUsd: sql`excluded.ulb_usd`,
            ulbCredits: sql`excluded.ulb_credits`,
            tierAtTime: sql`excluded.tier_at_time`,
            baselineCredits: sql`excluded.baseline_credits`,
            reason: sql`excluded.reason`,
            createdAt: auditNow,
          },
        }).run();
      }
    });
  } else {
    await r.transaction(async (tx: any) => {
      for (const entry of auditEntries) {
        await tx.insert(ulbTable).values({
          effectiveDate: entry.effectiveDate,
          githubLogin: entry.githubLogin,
          ulbUsd: entry.ulbUsd.toString(),
          ulbCredits: entry.ulbCredits.toString(),
          tierAtTime: entry.tierAtTime,
          baselineCredits: entry.baselineCredits.toString(),
          reason: entry.reason,
        }).onConflictDoUpdate({
          target: [ulbTable.effectiveDate, ulbTable.githubLogin],
          set: {
            ulbUsd: sql`excluded.ulb_usd`,
            ulbCredits: sql`excluded.ulb_credits`,
            tierAtTime: sql`excluded.tier_at_time`,
            baselineCredits: sql`excluded.baseline_credits`,
            reason: sql`excluded.reason`,
            createdAt: auditNow,
          },
        });
      }
    });
  }

  return result;
}
