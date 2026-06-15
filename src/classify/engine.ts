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
  bucketUpdatedAt: string | null;
};

export type ClassifiedUser = {
  githubLogin: string;
  consumptionTier: ConsumptionTier;
};

export type TierChange = {
  githubLogin: string;
  consumptionTierOld: string | null;
  consumptionTierNew: ConsumptionTier;
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

function assignConsumptionTier(
  percentile: number,
  thresholds = DEFAULT_THRESHOLDS.classify,
): ConsumptionTier {
  if (percentile >= thresholds.extremePct) return 'extreme';
  if (percentile >= thresholds.highPct) return 'high';
  if (percentile >= thresholds.mediumPct) return 'medium';
  return 'low';
}

export function classifyUsers(
  userCredits: UserCredits[],
  currentUsers: CurrentUser[],
  reason: string,
  classifyThresholds?: { extremePct: number; highPct: number; mediumPct: number },
): ClassifyResult {
  const totalUsers = userCredits.length;
  const changes: TierChange[] = [];
  const tierCounts: Record<ConsumptionTier, number> = { low: 0, medium: 0, high: 0, extreme: 0 };
  let missingTeamCount = 0;

  const getTierFn = totalUsers < 4
    ? (_credits: number) => {
        console.warn('Warning: fewer than 4 users, assigning all to medium consumption tier');
        return 'medium' as ConsumptionTier;
      }
    : (credits: number) => {
        const percentile = percentileFn(credits);
        return assignConsumptionTier(percentile, classifyThresholds);
      };

  const percentileFn = buildPercentileMap(userCredits.map(u => u.totalCredits));
  const currentUserMap = new Map(currentUsers.map(u => [u.githubLogin, u]));

  for (const uc of userCredits) {
    const consumptionTier = getTierFn(uc.totalCredits);
    const current = currentUserMap.get(uc.githubLogin);

    if (!current?.team) missingTeamCount++;
    tierCounts[consumptionTier]++;

    if (current?.consumptionTier !== consumptionTier) {
      changes.push({
        githubLogin: uc.githubLogin,
        consumptionTierOld: current?.consumptionTier ?? null,
        consumptionTierNew: consumptionTier,
        reason,
      });
    }
  }

  return { changes, stats: { totalUsers, changedUsers: changes.length, tierCounts, missingTeamCount } };
}

function buildPercentileMap(credits: number[]): (credit: number) => number {
  const n = credits.length;
  if (n < 4) return () => 0;

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
