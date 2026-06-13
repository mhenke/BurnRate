export type ForecastInput = {
  dailyCredits: number[];
  poolTotal: number;
  creditsUsedMtd: number;
  daysInMonth: number;
  daysElapsed: number;
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
};

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

/**
 * Compute budget burn forecast using moving averages.
 * Calculates both 7-day and 30-day run rates.
 * Calculates MTD (month-to-date) usage, remaining days in the month, and project total usage.
 * Compares projected usage against the total credit pool to detect threshold breaches.
 * 
 * Alert levels:
 * - >= 110% of pool: critical
 * - >= 100% and < 110% of pool: escalation
 * - >= 90% and < 100% of pool: warning
 * - < 90% of pool: ok
 * 
 * @param input The inputs including daily credits list, pool total, days elapsed, days in month, and credits used MTD.
 */
export function computeForecast(input: ForecastInput): ForecastResult {
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
  if (maxPct >= 110) alertLevel = 'critical';
  else if (maxPct >= 100) alertLevel = 'escalation';
  else if (maxPct >= 90) alertLevel = 'warning';

  return {
    rate7d,
    rate30d,
    forecast7d,
    forecast30d,
    pctOfPool7d: Math.round(pctOfPool7d * 100) / 100,
    pctOfPool30d: Math.round(pctOfPool30d * 100) / 100,
    divergencePct,
    alertLevel,
  };
}
