import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { DEFAULT_BUDGET_POLICY, DEFAULT_TIER_WEIGHTS } from '../../src/enforce/types.js';
import { resolveBudgetPolicy } from '../../src/config.js';

describe('budget policy config', () => {
  it('returns defaults when no config provided', () => {
    const policy = resolveBudgetPolicy();
    assert.equal(policy.mode, 'soft');
    assert.equal(policy.bufferPct, 0.05);
    assert.equal(policy.maxOveragePct, 0);
    assert.equal(policy.restoreRate, 0.5);
    assert.equal(policy.tierWeights.extreme, 1.5);
    assert.equal(policy.tierWeights.low, 0.75);
  });

  it('merges partial config with defaults', () => {
    const policy = resolveBudgetPolicy({ mode: 'soft', bufferPct: 0.1, maxOveragePct: 0.15 });
    assert.equal(policy.mode, 'soft');
    assert.equal(policy.bufferPct, 0.1);
    assert.equal(policy.maxOveragePct, 0.15);
    assert.equal(policy.restoreRate, 0.5);
  });

  it('merges partial tier weights', () => {
    const policy = resolveBudgetPolicy({ tierWeights: { extreme: 2.0 } });
    assert.equal(policy.tierWeights.extreme, 2.0);
    assert.equal(policy.tierWeights.high, 1.15);
    assert.equal(policy.tierWeights.medium, 1.0);
    assert.equal(policy.tierWeights.low, 0.75);
  });

  it('default tier weights cover all consumption tiers', () => {
    const tiers = ['extreme', 'high', 'medium', 'low'] as const;
    for (const tier of tiers) {
      assert.equal(typeof DEFAULT_TIER_WEIGHTS[tier], 'number');
    }
  });
});
