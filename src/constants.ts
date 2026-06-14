export const ALERT_WARNING_PCT = 90;
export const ALERT_ESCALATION_PCT = 100;
export const ALERT_CRITICAL_PCT = 110;

export type AlertLevel = 'ok' | 'warning' | 'escalation' | 'critical';

export function computeAlertLevel(pctOfBudget7d: number | null, pctOfBudget30d: number | null): AlertLevel {
  const maxPct = Math.max(pctOfBudget7d ?? 0, pctOfBudget30d ?? 0);

  if (maxPct >= ALERT_CRITICAL_PCT) return 'critical';
  if (maxPct >= ALERT_ESCALATION_PCT) return 'escalation';
  if (maxPct >= ALERT_WARNING_PCT) return 'warning';
  return 'ok';
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
