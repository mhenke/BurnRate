import { resolveValueTier as resolveValueTierFn, type ValueConfig, type ValueTier } from './value_config.js';
import { DEFAULT_THRESHOLDS } from '../config.js';

export type ConsumptionTier = 'low' | 'medium' | 'high' | 'extreme';

export type UserCredits = {
  githubLogin: string;
  totalCredits: number;
};

export type CurrentUser = {
  githubLogin: string;
  team: string | null;
  consumptionTier: string | null;
  valueTier: string | null;
  bucketUpdatedAt: string | null;
};

export type ClassifiedUser = {
  githubLogin: string;
  consumptionTier: ConsumptionTier;
  valueTier: ValueTier;
};

export type TierChange = {
  githubLogin: string;
  consumptionTierOld: string | null;
  consumptionTierNew: ConsumptionTier;
  valueTierOld: string | null;
  valueTierNew: ValueTier;
  reason: string;
};

export type ClassifyResult = {
  changes: TierChange[];
  stats: {
    totalUsers: number;
    changedUsers: number;
    tierCounts: Record<ConsumptionTier, number>;
    missingTeamCount: number;
  };
};

/**
 * Map a credit consumption percentile to a consumption tier using the
 * configured threshold ladder. Thresholds default to
 * {@link DEFAULT_THRESHOLDS.classify} so callers that omit them always
 * agree with the configured defaults.
 *
 * @param percentile Relative rank in [0, 1]; 1 = highest consumer.
 * @param thresholds Optional override for extreme/high/medium cutoffs.
 * @returns 'extreme' | 'high' | 'medium' | 'low'
 */
function assignConsumptionTier(
  percentile: number,
  thresholds = DEFAULT_THRESHOLDS.classify,
): ConsumptionTier {
  if (percentile >= thresholds.extremePct) return 'extreme';
  if (percentile >= thresholds.highPct) return 'high';
  if (percentile >= thresholds.mediumPct) return 'medium';
  return 'low';
}

/**
 * Classify users based on their credit usage relative to the organization.
 * Calculates credit consumption percentiles and maps them to consumption tiers.
 * Maps team assignments to business value tiers based on the config.
 *
 * If total users < 4, falls back to assigning all users to the 'medium' consumption tier.
 *
 * @param userCredits List of user GitHub logins and total credits used over 30 days
 * @param currentUsers Current users database records
 * @param valueConfig Team resolving config mapping teams to business value tiers
 * @param reason Reason for running the classification (e.g., weekly_recalc, manual)
 * @param classifyThresholds Optional threshold overrides; defaults to {@link DEFAULT_THRESHOLDS.classify}
 */
export function classifyUsers(
  userCredits: UserCredits[],
  currentUsers: CurrentUser[],
  valueConfig: ValueConfig,
  reason: string,
  classifyThresholds?: { extremePct: number; highPct: number; mediumPct: number },
): ClassifyResult {
  const totalUsers = userCredits.length;
  const changes: TierChange[] = [];
  const tierCounts: Record<ConsumptionTier, number> = { low: 0, medium: 0, high: 0, extreme: 0 };
  let missingTeamCount = 0;

  // For very small orgs ("fewer than 4 users"), statistics are unreliable.
  // Instead of duplicating the classification loop, override the tier
  // assignment function to assign everyone to "medium" uniformly.
  const getTierFn = totalUsers < 4
    ? (_credits: number) => {
        console.warn('Warning: fewer than 4 users, assigning all to medium consumption tier');
        return 'medium' as ConsumptionTier;
      }
    : (credits: number) => {
        const percentile = percentileFn(credits);
        return assignConsumptionTier(percentile, classifyThresholds);
      };

  // Build percentile lookup (unused when < 4 users, but cheap to compute)
  const percentileFn = buildPercentileMap(userCredits.map(u => u.totalCredits));
  const currentUserMap = new Map(currentUsers.map(u => [u.githubLogin, u]));

  for (const uc of userCredits) {
    const consumptionTier = getTierFn(uc.totalCredits);
    const current = currentUserMap.get(uc.githubLogin);
    const team = current?.team ?? null;
    const valueTier = resolveValueTierFn(team, valueConfig) as ValueTier;

    if (!team) missingTeamCount++;
    tierCounts[consumptionTier]++;

    const consumptionChanged = current?.consumptionTier !== consumptionTier;
    const valueChanged = current?.valueTier !== valueTier;

    if (consumptionChanged || valueChanged) {
      changes.push({
        githubLogin: uc.githubLogin,
        consumptionTierOld: current?.consumptionTier ?? null,
        consumptionTierNew: consumptionTier,
        valueTierOld: current?.valueTier ?? null,
        valueTierNew: valueTier,
        reason,
      });
    }
  }

  return { changes, stats: { totalUsers, changedUsers: changes.length, tierCounts, missingTeamCount } };
}

function buildPercentileMap(credits: number[]): (credit: number) => number {
  const n = credits.length;
  if (n < 4) return () => 0; // unused for small orgs; ensure safe no-op

  const sortedCredits = [...credits].sort((a, b) => a - b);
  const percentileMap = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const val = sortedCredits[i];
    if (i === n - 1 || sortedCredits[i + 1] !== val) {
      percentileMap.set(val, (i + 1) / n);
    }
  }

  return (credit: number) => percentileMap.get(credit) ?? 0;
}
