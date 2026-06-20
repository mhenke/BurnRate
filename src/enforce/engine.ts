import type { BudgetPolicy, TierWeights, UserState, UserCut, EnforceResult } from './types.js';
import type { ConsumptionTier } from './types.js';

const CUT_ORDER: ConsumptionTier[] = ['low', 'medium', 'high', 'extreme'];

// Minimum days elapsed before throttle cuts are applied.
// On day 1-2, the projection is too volatile from a single day's data.
const MIN_DAYS_FOR_CUTS = 3;

function projectEom(creditsUsedMtd: number, daysElapsed: number, daysRemaining: number): number {
  const dailyBurnRate = creditsUsedMtd / Math.max(1, daysElapsed);
  return creditsUsedMtd + (dailyBurnRate * daysRemaining);
}

function computeGap(projectedEom: number, poolTotal: number, bufferPct: number): number {
  return projectedEom - poolTotal + (poolTotal * bufferPct);
}

function computeFloor(dailyAvg30d: number, daysRemaining: number): number {
  return Math.round(dailyAvg30d * daysRemaining);
}

function computeTargetUlb(
  dailyAvg30d: number,
  daysRemaining: number,
  tier: ConsumptionTier,
  tierWeights: TierWeights,
): number {
  const baseline = dailyAvg30d * daysRemaining;
  const weight = tierWeights[tier] ?? 1.0;
  return Math.round(baseline * weight);
}

export type EngineInput = {
  poolTotal: number;
  creditsUsedMtd: number;
  daysElapsed: number;
  daysInCycle: number;
  users: UserState[];
  policy: BudgetPolicy;
};

/**
 * Run the full enforcement calculation: projection, gap, cuts, restore.
 * Pure function — no side effects, no DB access.
 *
 * Two cut phases (hard mode):
 *   Phase 1 — Headroom cuts: bottom-up by tier (low → medium → high → extreme).
 *     Within each tier, cuts are distributed proportionally to each user's
 *     headroom (currentUlb − floor). This protects power users by cutting
 *     light users first, and only reaches extreme-tier users when lower tiers
 *     have no remaining headroom.
 *
 *   Phase 2 — Below-floor reclamation (hard mode only): when Phase 1 headroom
 *     cuts cannot close the gap, proportional reductions are applied to all
 *     users' remaining allocations. The sort order (truly-idle descending)
 *     determines which users absorb rounding remainders first — users with
 *     the largest idle pool take the rounding remainder. Distribution is
 *     proportional to each user's remaining ULB after Phase 1.
 */
export function runEngine(input: EngineInput): EnforceResult {
  const daysRemaining = input.daysInCycle - input.daysElapsed;
  const projectedEom = projectEom(input.creditsUsedMtd, input.daysElapsed, daysRemaining);
  const bufferTarget = Math.round(input.poolTotal * input.policy.bufferPct);
  const gap = computeGap(projectedEom, input.poolTotal, input.policy.bufferPct);

  const changes: UserCut[] = [];

  if (gap <= 0) {
    for (const u of input.users) {
      const targetUlb = computeTargetUlb(
        u.dailyAvg30d, daysRemaining, u.consumptionTier, input.policy.tierWeights,
      );
      const restoredUlb = computeRestore(
        u.currentUlb, targetUlb, input.policy.restoreRate,
      );
      if (restoredUlb !== u.currentUlb) {
        changes.push({
          githubLogin: u.githubLogin,
          tier: u.consumptionTier,
          baseline: computeFloor(u.dailyAvg30d, daysRemaining),
          previousUlb: u.currentUlb,
          newUlb: restoredUlb,
          cutAmount: u.currentUlb - restoredUlb,
        });
      }
    }

    return {
      mode: input.policy.mode,
      poolTotal: input.poolTotal,
      creditsUsedMtd: input.creditsUsedMtd,
      daysElapsed: input.daysElapsed,
      daysRemaining,
      projectedEom,
      bufferTarget,
      gap: 0,
      action: changes.length > 0 ? 'restore' : 'none',
      usersAdjusted: changes.length,
      uncloseableGap: 0,
      changes,
    };
  }

  // Day-1 dampening: skip throttle cuts when projection is based on
  // fewer than MIN_DAYS_FOR_CUTS days of data (finding #8).
  if (input.daysElapsed < MIN_DAYS_FOR_CUTS) {
    return {
      mode: input.policy.mode,
      poolTotal: input.poolTotal,
      creditsUsedMtd: input.creditsUsedMtd,
      daysElapsed: input.daysElapsed,
      daysRemaining,
      projectedEom,
      bufferTarget,
      gap,
      action: 'none',
      usersAdjusted: 0,
      uncloseableGap: gap,
      changes: [],
    };
  }

  // Soft mode: apply overage tolerance before computing cut gap.
  // Hard mode: gap is absolute — must close completely.
  const effectiveGap = input.policy.mode === 'soft'
    ? Math.max(0, gap - input.poolTotal * input.policy.maxOveragePct)
    : gap;

  const { cuts, remainingGap } = computeCuts(
    input.users, effectiveGap, daysRemaining, input.policy.tierWeights,
  );

  let uncloseableGap = remainingGap;

  // Hard mode only: if headroom cuts can't close the gap, apply
  // proportional below-floor cuts to guarantee pool containment.
  if (remainingGap > 0 && input.policy.mode === 'hard') {
    const belowFloorCuts = computeBelowFloorCuts(
      input.users, remainingGap, daysRemaining, cuts,
    );
    cuts.push(...belowFloorCuts);
    const belowFloorCutSum = belowFloorCuts.reduce((s, c) => s + c.cutAmount, 0);
    uncloseableGap = Math.max(0, remainingGap - belowFloorCutSum);
  }

  return {
    mode: input.policy.mode,
    poolTotal: input.poolTotal,
    creditsUsedMtd: input.creditsUsedMtd,
    daysElapsed: input.daysElapsed,
    daysRemaining,
    projectedEom,
    bufferTarget,
    gap,
    action: cuts.length > 0 ? 'throttle' : 'none',
    usersAdjusted: cuts.length,
    uncloseableGap,
    changes: cuts,
  };
}

function computeCuts(
  users: UserState[],
  gap: number,
  daysRemaining: number,
  tierWeights: TierWeights,
): { cuts: UserCut[]; remainingGap: number } {
  let remainingGap = gap;
  const cuts: UserCut[] = [];

  for (const tier of CUT_ORDER) {
    const tierUsers = users.filter(u => u.consumptionTier === tier);
    if (tierUsers.length === 0) continue;

    const availableHeadroom = tierUsers.reduce((sum, u) => {
      const floor = computeFloor(u.dailyAvg30d, daysRemaining);
      return sum + Math.max(0, u.currentUlb - floor);
    }, 0);

    const cutFromTier = Math.min(remainingGap, availableHeadroom);
    if (cutFromTier <= 0) continue;

    let tierCutSum = 0;
    for (const u of tierUsers) {
      const floor = computeFloor(u.dailyAvg30d, daysRemaining);
      const headroom = Math.max(0, u.currentUlb - floor);
      const share = availableHeadroom > 0 ? headroom / availableHeadroom : 0;
      const cutAmount = Math.round(cutFromTier * share);
      if (cutAmount <= 0) continue;

      const newUlb = Math.max(floor, u.currentUlb - cutAmount);
      const appliedCut = u.currentUlb - newUlb;
      tierCutSum += appliedCut;
      cuts.push({
        githubLogin: u.githubLogin,
        tier,
        baseline: floor,
        previousUlb: u.currentUlb,
        newUlb,
        cutAmount: appliedCut,
      });
    }

    remainingGap -= tierCutSum;
    if (remainingGap <= 0) break;
  }

  return { cuts, remainingGap };
}

/**
 * Hard mode only: close the remaining gap by applying proportional reductions
 * to all users' remaining allocations after Phase 1 headroom cuts.
 *
 * Distribution is proportional to each user's remaining ULB (after Phase 1),
 * which ensures the burden scales with allocation size. Users with larger
 * allocations absorb proportionally more of the gap.
 *
 * The sort order (truly-idle descending) determines which users absorb
 * rounding remainders first — users with the largest idle pool take the
 * remainder, since they are least impacted by a 1-2 credit adjustment.
 *
 * A user's allocation can reach zero — pool containment is absolute in
 * hard mode.
 */
function computeBelowFloorCuts(
  users: UserState[],
  gap: number,
  daysRemaining: number,
  existingCuts: UserCut[],
): UserCut[] {
  // Build effective ULB + truly-idle map (post-headroom-cuts)
  const entries: { githubLogin: string; ulb: number; floor: number; trulyIdle: number; tier: ConsumptionTier }[] = [];
  for (const u of users) {
    const existingCut = existingCuts.find(c => c.githubLogin === u.githubLogin);
    const ulb = existingCut ? existingCut.newUlb : u.currentUlb;
    if (ulb <= 0) continue;
    const projectedUsage = u.dailyAvg30d * daysRemaining;
    entries.push({
      githubLogin: u.githubLogin,
      ulb,
      floor: Math.round(projectedUsage),
      trulyIdle: Math.max(0, ulb - projectedUsage),
      tier: u.consumptionTier,
    });
  }

  // Sort by truly idle descending — users with largest idle pool absorb
  // rounding remainders first (least impact).
  entries.sort((a, b) => b.trulyIdle - a.trulyIdle);

  const totalAlloc = entries.reduce((s, e) => s + e.ulb, 0);
  if (totalAlloc <= 0 || gap <= 0) return [];

  const reductionRatio = Math.min(1, gap / totalAlloc);
  const cuts: UserCut[] = [];
  let totalCut = 0;

  for (const e of entries) {
    const cutAmount = Math.round(e.ulb * reductionRatio);
    if (cutAmount <= 0) continue;

    totalCut += cutAmount;
    cuts.push({
      githubLogin: e.githubLogin,
      tier: e.tier,
      baseline: e.floor,
      previousUlb: e.ulb,
      newUlb: Math.max(0, e.ulb - cutAmount),
      cutAmount,
    });
  }

  // Rounding may leave a few credits; absorb into the largest idle user
  // (first in sort order — least impacted).
  if (totalCut < gap && cuts.length > 0) {
    const remainder = gap - totalCut;
    cuts[0].cutAmount += remainder;
    cuts[0].newUlb = Math.max(0, cuts[0].newUlb - remainder);
  }

  return cuts;
}

function computeRestore(currentUlb: number, targetUlb: number, restoreRate: number): number {
  const gap = targetUlb - currentUlb;
  if (gap <= 0) return currentUlb;
  return Math.round(currentUlb + gap * restoreRate);
}
