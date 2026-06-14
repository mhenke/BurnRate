import ARIMA from 'arima';
import * as ss from 'simple-statistics';
import { type BurnrateThresholds, DEFAULT_THRESHOLDS } from '../config.js';

export type ForecastInput = {
  dailyCredits: number[];
  poolTotal: number;
  creditsUsedMtd: number;
  daysInMonth: number;
  daysElapsed: number;
  thresholds?: Pick<BurnrateThresholds['forecast'], 'trendSlope' | 'anomalyZscore'> & { alert: BurnrateThresholds['alert'] };
};

export type ForecastResult = {
  rate7d: number;
  rate30d: number;
  forecast7d: number;
  forecast30d: number;
  pctOfPool7d: number;
  pctOfPool30d: number;
  divergencePct: number;
  alertLevel: 'ok' | 'warning' | 'escalation' | 'critical';
  arimaForecast: number[];
  arimaConfidence: number[];
  anomalyScore: number;
  isAnomalous: boolean;
  trendSlope: number;
  trendDirection: 'increasing' | 'decreasing' | 'stable';
};

/**
 * Compute mean of an array, rounded to 2 decimal places.
 */
function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

/**
 * Run a SARIMA model on the daily credit series to produce a 7-day forecast
 * with confidence intervals. Uses order (2,1,1) with weekly seasonality (1,0,1,7).
 * Falls back to zeros if data is too sparse or the model fails to converge.
 */
function computeARIMA(data: number[]): { forecast: number[]; confidence: number[] } {
  if (data.length < 14) {
    return { forecast: Array(7).fill(0), confidence: Array(7).fill(0) };
  }

  try {
    // ARIMA(2,1,1) × (1,0,1)[7] SARIMA: accounts for trend (d=1),
    // short-term dependence (p=2, q=1), and weekly seasonality (s=7).
    const model = new ARIMA({
      p: 2, d: 1, q: 1,
      P: 1, D: 0, Q: 1, s: 7,
      verbose: false,
    }).train(data);

    const [forecast, confidence] = model.predict(7);
    model.destroy();

    return { forecast, confidence };
  } catch {
    return { forecast: Array(7).fill(0), confidence: Array(7).fill(0) };
  }
}

/**
 * Detect whether the latest data point is a statistical outlier using z-score.
 * Flags as anomalous when |z| > 2.5 (approx 1.2% false positive rate under normality).
 */
function computeAnomalyScore(data: number[], zscoreThreshold = 2.5): { score: number; isAnomalous: boolean } {
  if (data.length < 3) return { score: 0, isAnomalous: false };

  const mean = ss.mean(data);
  const stddev = ss.standardDeviation(data);
  if (stddev === 0) return { score: 0, isAnomalous: false };

  const lastValue = data[data.length - 1];
  const score = Math.abs((lastValue - mean) / stddev);

  return { score: Math.round(score * 100) / 100, isAnomalous: score > zscoreThreshold };
}

/**
 * Fit a linear regression to index vs credit count and classify the direction.
 * Slope threshold of 0.1 credits/day distinguishes noise from genuine trend.
 */
function computeTrend(data: number[], slopeThreshold = 0.1): { slope: number; direction: 'increasing' | 'decreasing' | 'stable' } {
  if (data.length < 2) return { slope: 0, direction: 'stable' };

  const indexed: Array<[number, number]> = data.map((v, i) => [i, v]);
  const regression = ss.linearRegression(indexed);
  const slope = Math.round(regression.m * 100) / 100;

  let direction: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (slope > slopeThreshold) direction = 'increasing';
  else if (slope < -slopeThreshold) direction = 'decreasing';

  return { slope, direction };
}

/**
 * Compute burn forecast from daily credit data using three methods:
 * 1. 7-day moving average extrapolation (captures recent spikes)
 * 2. 30-day moving average extrapolation (captures broader trend)
 * 3. SARIMA model with weekly seasonality (accounts for day-of-week patterns)
 *
 * Also computes z-score anomaly detection and linear regression trend direction.
 * Alert levels: >=110% critical, >=100% escalation, >=90% warning, else ok.
 */
export function computeForecast(input: ForecastInput): ForecastResult {
  const alertThresholds = input.thresholds?.alert ?? DEFAULT_THRESHOLDS.alert;
  const forecastThresholds = input.thresholds ?? DEFAULT_THRESHOLDS.forecast;
  const remainingDays = input.daysInMonth - input.daysElapsed;
  const last7 = input.dailyCredits.slice(-7);
  const last30 = input.dailyCredits.slice(-30);

  const rate7d = average(last7);
  const rate30d = average(last30);

  const forecast7d = Math.round((input.creditsUsedMtd + rate7d * remainingDays) * 100) / 100;
  const forecast30d = Math.round((input.creditsUsedMtd + rate30d * remainingDays) * 100) / 100;

  const pctOfPool7d = input.poolTotal > 0 ? (forecast7d / input.poolTotal) * 100 : 0;
  const pctOfPool30d = input.poolTotal > 0 ? (forecast30d / input.poolTotal) * 100 : 0;

  const divergencePct =
    rate7d > 0 && rate30d > 0
      ? Math.round((Math.abs(rate7d - rate30d) / Math.max(rate7d, rate30d)) * 10000) / 100
      : 0;

  let alertLevel: ForecastResult['alertLevel'] = 'ok';
  const maxPct = Math.max(pctOfPool7d, pctOfPool30d);
  if (maxPct >= alertThresholds.criticalPct) alertLevel = 'critical';
  else if (maxPct >= alertThresholds.escalationPct) alertLevel = 'escalation';
  else if (maxPct >= alertThresholds.warningPct) alertLevel = 'warning';

  const arima = computeARIMA(input.dailyCredits);
  const anomaly = computeAnomalyScore(input.dailyCredits, forecastThresholds.anomalyZscore);
  const trend = computeTrend(input.dailyCredits, forecastThresholds.trendSlope);

  return {
    rate7d,
    rate30d,
    forecast7d,
    forecast30d,
    pctOfPool7d: Math.round(pctOfPool7d * 100) / 100,
    pctOfPool30d: Math.round(pctOfPool30d * 100) / 100,
    divergencePct,
    alertLevel,
    arimaForecast: arima.forecast,
    arimaConfidence: arima.confidence,
    anomalyScore: anomaly.score,
    isAnomalous: anomaly.isAnomalous,
    trendSlope: trend.slope,
    trendDirection: trend.direction,
  };
}
