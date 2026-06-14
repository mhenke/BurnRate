import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { computeForecast } from '../../src/forecast/engine.js';

describe('forecast engine', () => {
  it('computes 7d and 30d forecasts and alert levels', () => {
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
    assert.equal(result.forecast7d, 5000 + 200 * 15);
    assert.equal(result.forecast30d, 5000 + 185.7 * 15);
    assert.ok(result.pctOfPool7d > 50);
  });

  it('handles zero poolTotal without producing Infinity/NaN', () => {
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

  it('produces ARIMA forecast with confidence intervals', () => {
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

    assert.ok(Array.isArray(result.arimaForecast));
    assert.equal(result.arimaForecast.length, 7);
    assert.ok(result.arimaForecast.every((v) => typeof v === 'number' && !Number.isNaN(v)));

    assert.ok(Array.isArray(result.arimaConfidence));
    assert.equal(result.arimaConfidence.length, 7);
    assert.ok(result.arimaConfidence.every((v) => typeof v === 'number'));
  });

  it('detects anomalies via z-score', () => {
    const result = computeForecast({
      dailyCredits: [100, 105, 98, 102, 99, 101, 103],
      poolTotal: 10000,
      creditsUsedMtd: 708,
      daysInMonth: 30,
      daysElapsed: 7,
    });

    assert.equal(typeof result.anomalyScore, 'number');
    assert.ok(result.anomalyScore >= 0);
    assert.equal(typeof result.isAnomalous, 'boolean');
  });

  it('flags anomalous spike', () => {
    const steady = Array(14).fill(100);
    const spike = [...steady, 5000, 5200];
    const result = computeForecast({
      dailyCredits: spike,
      poolTotal: 10000,
      creditsUsedMtd: spike.reduce((a, b) => a + b, 0),
      daysInMonth: 30,
      daysElapsed: 16,
    });

    assert.ok(result.isAnomalous);
    assert.ok(result.anomalyScore > 2);
  });

  it('detects upward trend', () => {
    const climbing = [100, 110, 120, 130, 140, 150, 160];
    const result = computeForecast({
      dailyCredits: climbing,
      poolTotal: 10000,
      creditsUsedMtd: 910,
      daysInMonth: 30,
      daysElapsed: 7,
    });

    assert.equal(result.trendDirection, 'increasing');
    assert.ok(result.trendSlope > 0);
  });

  it('detects downward trend', () => {
    const declining = [160, 150, 140, 130, 120, 110, 100];
    const result = computeForecast({
      dailyCredits: declining,
      poolTotal: 10000,
      creditsUsedMtd: 910,
      daysInMonth: 30,
      daysElapsed: 7,
    });

    assert.equal(result.trendDirection, 'decreasing');
    assert.ok(result.trendSlope < 0);
  });

  it('produces forecast with anomaly score, trend, and ARIMA', () => {
    const dailyCredits = [
      181.35, 181.35, 181.35, 181.35, 181.35, 181.35, 181.35,
      181.35, 181.35, 181.35, 181.35, 181.35, 181.35, 181.35
    ];

    const result = computeForecast({
      dailyCredits,
      poolTotal: 10000,
      creditsUsedMtd: 2538.90,
      daysInMonth: 30,
      daysElapsed: 14,
    });

    assert.equal(typeof result.anomalyScore, 'number');
    assert.equal(typeof result.trendSlope, 'number');
    assert.ok(Array.isArray(result.arimaForecast));
  });
});
