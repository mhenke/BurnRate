import type { ValueTier } from './value_config.js';

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

function assignConsumptionTier(percentile: number): ConsumptionTier {
  if (percentile >= 0.85) return 'extreme';
  if (percentile >= 0.60) return 'high';
  if (percentile >= 0.25) return 'medium';
  return 'low';
}

export function classifyUsers(
  userCredits: UserCredits[],
  currentUsers: CurrentUser[],
  config: { resolveValueTier: (team: string | null) => string },
  reason: string,
): ClassifyResult {
  const totalUsers = userCredits.length;
  const changes: TierChange[] = [];
  const tierCounts: Record<ConsumptionTier, number> = { low: 0, medium: 0, high: 0, extreme: 0 };
  let missingTeamCount = 0;

  // Edge case: fewer than 4 users
  if (totalUsers < 4) {
    console.warn('Warning: fewer than 4 users, assigning all to medium consumption tier');
    const currentUserMap = new Map(currentUsers.map(u => [u.githubLogin, u]));

    for (const uc of userCredits) {
      const current = currentUserMap.get(uc.githubLogin);
      const team = current?.team ?? null;
      const valueTier = config.resolveValueTier(team) as ValueTier;
      const consumptionTier: ConsumptionTier = 'medium';

      if (!team) missingTeamCount++;

      tierCounts.medium++;

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

  // Compute percentiles in O(N log N) + O(N) time
  const sortedCredits = userCredits.map(u => u.totalCredits).sort((a, b) => a - b);
  const percentileMap = new Map<number, number>();
  for (let i = 0; i < totalUsers; i++) {
    const val = sortedCredits[i];
    // Since it's sorted, the count of elements <= val is the index + 1 of the last occurrence
    if (i === totalUsers - 1 || sortedCredits[i + 1] !== val) {
      percentileMap.set(val, (i + 1) / totalUsers);
    }
  }

  const currentUserMap = new Map(currentUsers.map(u => [u.githubLogin, u]));

  for (const uc of userCredits) {
    const percentile = percentileMap.get(uc.totalCredits) ?? 0;
    const consumptionTier = assignConsumptionTier(percentile);

    const current = currentUserMap.get(uc.githubLogin);
    const team = current?.team ?? null;
    const valueTier = config.resolveValueTier(team) as ValueTier;

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
