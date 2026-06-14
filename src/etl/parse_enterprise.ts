/**
 * @deprecated Import from './parse_daily_user_usage.js' instead.
 *
 * This file was renamed because `parse_enterprise` was a misnomer —
 * this module parses the `users-1-day` per-user daily usage report,
 * not an enterprise-level report. The accurate name is
 * `parse_daily_user_usage.ts`.
 *
 * This re-export shim is kept so external docs/scripts referencing the
 * old name continue to compile. Remove once all consumers are updated.
 */
export { parseDailyUsage, type DailyUsageRow } from './parse_daily_user_usage.js';
