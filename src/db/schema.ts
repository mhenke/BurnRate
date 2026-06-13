import { pgTable, text as pgText, date as pgDate, jsonb as pgJsonb, timestamp as pgTimestamp, numeric as pgNumeric, bigint as pgBigint, integer as pgInteger, bigserial as pgBigserial, unique as pgUnique } from 'drizzle-orm/pg-core';
import { sqliteTable, text as sqText, integer as sqInteger, numeric as sqNumeric, unique as sqUnique } from 'drizzle-orm/sqlite-core';

// === PostgreSQL Schema ===

export const rawReportsPg = pgTable('raw_reports', {
  id: pgBigserial('id', { mode: 'bigint' }).primaryKey(),
  reportType: pgText('report_type').notNull(),
  reportDay: pgDate('report_day').notNull(),
  sourceUrl: pgText('source_url').notNull(),
  payload: pgJsonb('payload').notNull(),
  ingestedAt: pgTimestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  pgUnique('raw_reports_type_day_unique').on(t.reportType, t.reportDay)
]);

export const usersPg = pgTable('users', {
  githubLogin: pgText('github_login').primaryKey(),
  enterprise: pgText('enterprise').notNull(),
  org: pgText('org').notNull(),
  displayName: pgText('display_name'),
  email: pgText('email'),
  team: pgText('team'),
  employeeId: pgText('employee_id'),
  manager: pgText('manager'),
  seatCreatedAt: pgTimestamp('seat_created_at', { withTimezone: true }),
  lastActivityAt: pgTimestamp('last_activity_at', { withTimezone: true }),
  consumptionTier: pgText('consumption_tier'),
  valueTier: pgText('value_tier'),
  bucketUpdatedAt: pgTimestamp('bucket_updated_at', { withTimezone: true }),
  updatedAt: pgTimestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dailyUsagePg = pgTable('daily_usage', {
  usageDate: pgDate('usage_date').notNull(),
  githubLogin: pgText('github_login').notNull(),
  credits: pgNumeric('credits', { precision: 10, scale: 2 }).notNull().default('0'),
  tokensInput: pgBigint('tokens_input', { mode: 'bigint' }).notNull().default(0n),
  tokensOutput: pgBigint('tokens_output', { mode: 'bigint' }).notNull().default(0n),
  chatRequests: pgInteger('chat_requests').notNull().default(0),
  agentRequests: pgInteger('agent_requests').notNull().default(0),
  acceptedLines: pgInteger('accepted_lines').notNull().default(0),
  suggestedLines: pgInteger('suggested_lines').notNull().default(0),
  acceptanceRate: pgNumeric('acceptance_rate', { precision: 5, scale: 4 }).notNull().default('0'),
  creditsPerAccLoc: pgNumeric('credits_per_acc_loc', { precision: 10, scale: 4 }).notNull().default('0'),
  modelBreakdown: pgJsonb('model_breakdown').notNull().default({}),
  ideBreakdown: pgJsonb('ide_breakdown').notNull().default({}),
  languageBreakdown: pgJsonb('language_breakdown').notNull().default({}),
}, (t) => [
  pgUnique('daily_usage_date_login_pk').on(t.usageDate, t.githubLogin)
]);

export const teamUsagePg = pgTable('team_usage', {
  usageDate: pgDate('usage_date').notNull(),
  team: pgText('team').notNull(),
  credits: pgNumeric('credits', { precision: 12, scale: 2 }).notNull().default('0'),
  activeUsers: pgInteger('active_users').notNull().default(0),
  avgAcceptanceRate: pgNumeric('avg_acceptance_rate', { precision: 5, scale: 4 }).notNull().default('0'),
}, (t) => [
  pgUnique('team_usage_date_team_pk').on(t.usageDate, t.team)
]);

export const classificationHistoryPg = pgTable('classification_history', {
  effectiveDate: pgDate('effective_date').notNull(),
  githubLogin: pgText('github_login').notNull(),
  consumptionTierOld: pgText('consumption_tier_old'),
  consumptionTierNew: pgText('consumption_tier_new'),
  valueTier: pgText('value_tier'),
  reason: pgText('reason'),
}, (t) => [
  pgUnique('classification_history_date_login_pk').on(t.effectiveDate, t.githubLogin)
]);

export const poolSnapshotsPg = pgTable('pool_snapshots', {
  snapshotDate: pgDate('snapshot_date').primaryKey(),
  totalCredits: pgNumeric('total_credits', { precision: 12, scale: 2 }).notNull(),
  creditsUsed: pgNumeric('credits_used', { precision: 12, scale: 2 }).notNull(),
  creditsRemaining: pgNumeric('credits_remaining', { precision: 12, scale: 2 }).notNull(),
  forecast7d: pgNumeric('forecast_7d', { precision: 12, scale: 2 }),
  forecast30d: pgNumeric('forecast_30d', { precision: 12, scale: 2 }),
  pctElapsed: pgNumeric('pct_elapsed', { precision: 8, scale: 4 }),
});

// === SQLite Schema ===

export const rawReportsSq = sqliteTable('raw_reports', {
  id: sqInteger('id').primaryKey({ autoIncrement: true }),
  reportType: sqText('report_type').notNull(),
  reportDay: sqText('report_day').notNull(),
  sourceUrl: sqText('source_url').notNull(),
  payload: sqText('payload', { mode: 'json' }).notNull(),
  ingestedAt: sqText('ingested_at').notNull().default('CURRENT_TIMESTAMP'),
}, (t) => [
  sqUnique('raw_reports_type_day_unique').on(t.reportType, t.reportDay)
]);

export const usersSq = sqliteTable('users', {
  githubLogin: sqText('github_login').primaryKey(),
  enterprise: sqText('enterprise').notNull(),
  org: sqText('org').notNull(),
  displayName: sqText('display_name'),
  email: sqText('email'),
  team: sqText('team'),
  employeeId: sqText('employee_id'),
  manager: sqText('manager'),
  seatCreatedAt: sqText('seat_created_at'),
  lastActivityAt: sqText('last_activity_at'),
  consumptionTier: sqText('consumption_tier'),
  valueTier: sqText('value_tier'),
  bucketUpdatedAt: sqText('bucket_updated_at'),
  updatedAt: sqText('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const dailyUsageSq = sqliteTable('daily_usage', {
  usageDate: sqText('usage_date').notNull(),
  githubLogin: sqText('github_login').notNull(),
  credits: sqNumeric('credits').notNull().default('0'),
  tokensInput: sqInteger('tokens_input').notNull().default(0),
  tokensOutput: sqInteger('tokens_output').notNull().default(0),
  chatRequests: sqInteger('chat_requests').notNull().default(0),
  agentRequests: sqInteger('agent_requests').notNull().default(0),
  acceptedLines: sqInteger('accepted_lines').notNull().default(0),
  suggestedLines: sqInteger('suggested_lines').notNull().default(0),
  acceptanceRate: sqNumeric('acceptance_rate').notNull().default('0'),
  creditsPerAccLoc: sqNumeric('credits_per_acc_loc').notNull().default('0'),
  modelBreakdown: sqText('model_breakdown', { mode: 'json' }).notNull().default('{}'),
  ideBreakdown: sqText('ide_breakdown', { mode: 'json' }).notNull().default('{}'),
  languageBreakdown: sqText('language_breakdown', { mode: 'json' }).notNull().default('{}'),
}, (t) => [
  sqUnique('daily_usage_date_login_pk').on(t.usageDate, t.githubLogin)
]);

export const teamUsageSq = sqliteTable('team_usage', {
  usageDate: sqText('usage_date').notNull(),
  team: sqText('team').notNull(),
  credits: sqNumeric('credits').notNull().default('0'),
  activeUsers: sqInteger('active_users').notNull().default(0),
  avgAcceptanceRate: sqNumeric('avg_acceptance_rate').notNull().default('0'),
}, (t) => [
  sqUnique('team_usage_date_team_pk').on(t.usageDate, t.team)
]);

export const classificationHistorySq = sqliteTable('classification_history', {
  effectiveDate: sqText('effective_date').notNull(),
  githubLogin: sqText('github_login').notNull(),
  consumptionTierOld: sqText('consumption_tier_old'),
  consumptionTierNew: sqText('consumption_tier_new'),
  valueTier: sqText('value_tier'),
  reason: sqText('reason'),
}, (t) => [
  sqUnique('classification_history_date_login_pk').on(t.effectiveDate, t.githubLogin)
]);

export const poolSnapshotsSq = sqliteTable('pool_snapshots', {
  snapshotDate: sqText('snapshot_date').primaryKey(),
  totalCredits: sqNumeric('total_credits').notNull(),
  creditsUsed: sqNumeric('credits_used').notNull(),
  creditsRemaining: sqNumeric('credits_remaining').notNull(),
  forecast7d: sqNumeric('forecast_7d'),
  forecast30d: sqNumeric('forecast_30d'),
  pctElapsed: sqNumeric('pct_elapsed'),
});
