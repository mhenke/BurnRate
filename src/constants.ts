import { DEFAULT_THRESHOLDS } from './config.js';

export type AlertLevel = 'ok' | 'warning' | 'escalation' | 'critical';

/**
 * Compute the alert level from two "percent of budget/pool" values.
 * The maximum of the two inputs is compared against the threshold ladder.
 * Thresholds default to {@link DEFAULT_THRESHOLDS.alert} so callers that do
 * not supply them always agree with the configured defaults.
 *
 * @param pctA First percentage value (e.g. 7-day forecast); null treated as 0.
 * @param pctB Second percentage value (e.g. 30-day forecast); null treated as 0.
 * @param thresholds Optional override for warning/escalation/critical cutoffs.
 * @returns 'critical' | 'escalation' | 'warning' | 'ok'
 */
export function computeAlertLevel(pctA: number | null, pctB: number | null, thresholds?: {
  warningPct?: number;
  escalationPct?: number;
  criticalPct?: number;
}): AlertLevel {
  const maxPct = Math.max(pctA ?? 0, pctB ?? 0);
  const w = thresholds?.warningPct ?? DEFAULT_THRESHOLDS.alert.warningPct;
  const e = thresholds?.escalationPct ?? DEFAULT_THRESHOLDS.alert.escalationPct;
  const c = thresholds?.criticalPct ?? DEFAULT_THRESHOLDS.alert.criticalPct;

  if (maxPct >= c) return 'critical';
  if (maxPct >= e) return 'escalation';
  if (maxPct >= w) return 'warning';
  return 'ok';
}

/**
 * Returns today's date as an ISO-8601 `YYYY-MM-DD` string in UTC.
 */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns the date `n` calendar days ago as an ISO-8601 `YYYY-MM-DD` string in UTC.
 *
 * @param n Number of days to subtract from today.
 */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
