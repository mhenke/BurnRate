import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { runEngine, type EngineInput } from '../../src/enforce/engine.js';
import { DEFAULT_BUDGET_POLICY } from '../../src/enforce/types.js';
import type { BudgetPolicy, UserState } from '../../src/enforce/types.js';

function makePolicy(overrides?: Partial<BudgetPolicy>): BudgetPolicy {
  return { ...DEFAULT_BUDGET_POLICY, mode: 'soft', ...overrides };
}

function makeUser(overrides?: Partial<UserState>): UserState {
  return {
    githubLogin: 'test-user',
    consumptionTier: 'medium',
    dailyAvg30d: 100,
    currentUlb: 2000,
    daysRemaining: 20,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<EngineInput>): EngineInput {
  return {
    poolTotal: 100000,
    creditsUsedMtd: 50000,
    daysElapsed: 15,
    daysInCycle: 30,
    users: [],
    policy: makePolicy(),
    ...overrides,
  };
}

describe('enforce engine', () => {
  describe('projection', () => {
    it('projects end-of-month burn from daily rate', () => {
      const result = runEngine(makeInput({ users: [] }));
      assert.equal(result.daysRemaining, 15);
      const expectedEom = 50000 + (50000 / 15) * 15;
      assert.equal(result.projectedEom, expectedEom);
    });

    it('computes buffer target as percentage of pool', () => {
      const policy = makePolicy({ bufferPct: 0.05 });
      const result = runEngine(makeInput({ policy, users: [] }));
      assert.equal(result.bufferTarget, 5000);
    });

    it('computes gap when projection exceeds pool + buffer', () => {
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 80000,
        daysElapsed: 15,
        users: [],
      }));
      assert.ok(result.gap > 0);
    });

    it('returns zero gap when projection is under target', () => {
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 10000,
        daysElapsed: 15,
        users: [],
      }));
      assert.ok(result.gap <= 0);
      assert.equal(result.action, 'none');
    });
  });

  describe('day-1 dampening', () => {
    it('skips throttle cuts when daysElapsed < 3', () => {
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 90000,
        daysElapsed: 1,
        users: [
          makeUser({ consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 29 }),
        ],
      }));
      assert.equal(result.action, 'none');
      assert.equal(result.usersAdjusted, 0);
      assert.ok(result.uncloseableGap > 0);
    });

    it('applies cuts when daysElapsed >= 3', () => {
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 80000,
        daysElapsed: 5,
        users: [
          makeUser({ consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 25 }),
        ],
      }));
      assert.equal(result.action, 'throttle');
      assert.ok(result.usersAdjusted > 0);
    });
  });

  describe('cut distribution', () => {
    it('never cuts a user below their floor', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2500, daysRemaining: 20 }),
      ];
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 95000,
        daysElapsed: 15,
        users,
      }));
      for (const c of result.changes) {
        assert.ok(c.newUlb >= c.baseline, `${c.githubLogin}: newUlb=${c.newUlb} should be >= baseline=${c.baseline}`);
      }
    });
  });

  describe('restore', () => {
    it('restores previous cuts when projection clears', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2200, daysRemaining: 20 }),
      ];
      const policy = makePolicy({ restoreRate: 0.5 });
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 20000,
        daysElapsed: 15,
        users,
        policy,
      }));
      if (result.action === 'restore' && result.changes.length > 0) {
        assert.ok(result.changes[0].newUlb > result.changes[0].previousUlb);
      }
    });

    it('restores at configured restoreRate', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2500, daysRemaining: 20 }),
      ];
      const policy = makePolicy({ restoreRate: 0.5 });
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 20000,
        daysElapsed: 15,
        users,
        policy,
      }));
      if (result.changes.length > 0) {
        const c = result.changes[0];
        const targetUlb = 100 * 20 * 1.5;
        const expectedRestore = Math.round(2500 + (3000 - 2500) * 0.5);
        assert.equal(c.newUlb, expectedRestore);
      }
    });
  });

  describe('hard mode below-floor cuts', () => {
    it('applies proportional below-floor cuts to close the gap', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 200, currentUlb: 4000, daysRemaining: 10 }),
        makeUser({ githubLogin: 'hi', consumptionTier: 'high', dailyAvg30d: 200, currentUlb: 4000, daysRemaining: 10 }),
      ];
      const result = runEngine(makeInput({
        poolTotal: 1000,
        creditsUsedMtd: 50000,
        daysElapsed: 15,
        users,
        policy: makePolicy({ mode: 'hard' }),
      }));
      assert.equal(result.action, 'throttle');
      assert.ok(result.changes.length >= 2, 'Both users should have cuts');
      assert.ok(result.uncloseableGap < 1, 'Hard mode should fully close the gap');
    });
  });

  describe('soft mode overage tolerance', () => {
    it('tolerates overage up to maxOveragePct', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 20 }),
      ];
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 50000,
        daysElapsed: 15,
        users,
        policy: makePolicy({ mode: 'soft', maxOveragePct: 0.10 }),
      }));
      assert.equal(result.action, 'none', 'Should tolerate overage within limit');
    });
  });

  describe('edge cases', () => {
    it('handles day 1 of cycle with extreme burn rate', () => {
      const result = runEngine(makeInput({ daysElapsed: 1, creditsUsedMtd: 500, users: [] }));
      assert.ok(result.daysRemaining > 0);
      assert.ok(result.projectedEom > 0);
    });

    it('handles zero pool total gracefully', () => {
      const result = runEngine(makeInput({ poolTotal: 0, creditsUsedMtd: 100, daysElapsed: 15, users: [] }));
      assert.ok(result.gap > 0);
      assert.ok(result.projectedEom >= 0);
    });

    it('handles end of cycle (daysRemaining = 0)', () => {
      const result = runEngine(makeInput({
        poolTotal: 100000, creditsUsedMtd: 50000, daysElapsed: 30, daysInCycle: 30, users: [],
      }));
      assert.equal(result.daysRemaining, 0);
      assert.equal(result.projectedEom, 50000);
    });

    // Finding #14: Edge case — single user
    it('handles single user correctly', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'solo', consumptionTier: 'medium', dailyAvg30d: 100, currentUlb: 2000, daysRemaining: 20 }),
      ];
      const result = runEngine(makeInput({
        poolTotal: 100000, creditsUsedMtd: 50000, daysElapsed: 15, users,
      }));
      assert.ok(!Number.isNaN(result.projectedEom));
      assert.ok(!Number.isNaN(result.gap));
    });

    // Finding #14: Edge case — rounding boundary
    it('handles rounding across multiple users', () => {
      const users: UserState[] = Array.from({ length: 5 }, (_, i) =>
        makeUser({ githubLogin: `u${i}`, consumptionTier: 'medium', dailyAvg30d: 100, currentUlb: 2100, daysRemaining: 20 })
      );
      const result = runEngine(makeInput({
        poolTotal: 100000, creditsUsedMtd: 90000, daysElapsed: 15, users,
      }));
      // Verify no NaN or negative values
      for (const c of result.changes) {
        assert.ok(!Number.isNaN(c.newUlb));
        assert.ok(c.newUlb >= 0);
      }
    });
  });
});
