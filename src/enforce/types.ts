// NOTE: Re-export from classify would create a circular dependency
// (enforce -> classify -> config -> enforce), so ConsumptionTier is
// defined here directly. Finding #13 suggests moving this to a shared
// types module when the coupling concern outweighs the duplication.
export type ConsumptionTier = 'low' | 'medium' | 'high' | 'extreme';

export type BudgetMode = 'hard' | 'soft';

export type TierWeights = Record<ConsumptionTier, number>;

export const DEFAULT_TIER_WEIGHTS: TierWeights = {
  extreme: 1.5,
  high: 1.15,
  medium: 1.0,
  low: 0.75,
};

// NOTE: warningHours removed — was YAGNI (finding #9). Implement when
// the notification delay feature is actually built.
export type BudgetPolicy = {
  mode: BudgetMode;
  bufferPct: number;
  maxOveragePct: number;
  restoreRate: number;
  tierWeights: TierWeights;
};

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  mode: 'soft',
  bufferPct: 0.05,
  maxOveragePct: 0,
  restoreRate: 0.5,
  tierWeights: DEFAULT_TIER_WEIGHTS,
};

export type UserState = {
  githubLogin: string;
  consumptionTier: ConsumptionTier;
  dailyAvg30d: number;
  currentUlb: number;
  daysRemaining: number;
};

export type UserCut = {
  githubLogin: string;
  tier: ConsumptionTier;
  baseline: number;
  previousUlb: number;
  newUlb: number;
  cutAmount: number;
};

export type EnforceResult = {
  mode: BudgetMode;
  poolTotal: number;
  creditsUsedMtd: number;
  daysElapsed: number;
  daysRemaining: number;
  projectedEom: number;
  bufferTarget: number;
  gap: number;
  action: 'throttle' | 'restore' | 'none';
  usersAdjusted: number;
  uncloseableGap: number;
  changes: UserCut[];
};

// NOTE: report removed from EnforceOptions — it's a CLI concern,
// not an engine concern (clean interface per architecture review).
export type EnforceOptions = {
  reason: 'daily_recalc' | 'manual' | 'initial_allocation';
  dryRun: boolean;
};
