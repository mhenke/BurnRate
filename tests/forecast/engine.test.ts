import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { computeForecast } from '../../src/forecast/engine.js';

describe('forecast engine', () => {
  it('computes 7d and 30d forecasts and alert levels', () => {
    // 23 elements of 181.35 (sum = 4171.05) + 7 elements (sum = 1400) -> total sum = 5571.05.
    // 30d average = 5571.05 / 30 = 185.7016 -> 185.7
    // 7d average = 1400 / 7 = 200
    const dailyCredits = [
      ...Array(23).fill(181.35),
      100, 200, 150, 175, 225, 250, 300
    ];

    const result = computeForecast({
      dailyCredits,
      poolTotal: 10000,
      creditsUsedMtd: 5000,
      daysInMonth: 30,
      daysElapsed: 15,
    });

    assert.equal(result.rate7d, 200);
    assert.equal(result.rate30d, 185.7);
    assert.equal(result.forecast7d, 5000 + 200 * 15); // 8000
    assert.equal(result.forecast30d, 5000 + 185.7 * 15); // 7785.5
    assert.ok(result.pctOfPool7d > 50);
  });

  it('handles zero or negative poolTotal without producing Infinity/NaN', () => {
    const result = computeForecast({
      dailyCredits: [100, 100, 100],
      poolTotal: 0,
      creditsUsedMtd: 500,
      daysInMonth: 30,
      daysElapsed: 15,
    });

    assert.equal(result.pctOfPool7d, 0);
    assert.equal(result.pctOfPool30d, 0);
  });
});
