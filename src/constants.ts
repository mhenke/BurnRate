export const ALERT_WARNING_PCT = 90;
export const ALERT_ESCALATION_PCT = 100;
export const ALERT_CRITICAL_PCT = 110;

export type AlertLevel = 'ok' | 'warning' | 'escalation' | 'critical';

export function computeAlertLevel(pctA: number | null, pctB: number | null, thresholds?: {
  warningPct?: number;
  escalationPct?: number;
  criticalPct?: number;
}): AlertLevel {
  const maxPct = Math.max(pctA ?? 0, pctB ?? 0);
  const w = thresholds?.warningPct ?? ALERT_WARNING_PCT;
  const e = thresholds?.escalationPct ?? ALERT_ESCALATION_PCT;
  const c = thresholds?.criticalPct ?? ALERT_CRITICAL_PCT;

  if (maxPct >= c) return 'critical';
  if (maxPct >= e) return 'escalation';
  if (maxPct >= w) return 'warning';
  return 'ok';
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
