import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';

export const pgSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS raw_reports (
    id BIGSERIAL PRIMARY KEY,
    report_type TEXT NOT NULL,
    report_day DATE NOT NULL,
    source_url TEXT NOT NULL,
    payload JSONB NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (report_type, report_day)
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    github_login TEXT PRIMARY KEY,
    enterprise TEXT NOT NULL,
    org TEXT NOT NULL,
    display_name TEXT,
    email TEXT,
    team TEXT,
    employee_id TEXT,
    manager TEXT,
    seat_created_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    consumption_tier TEXT,
    value_tier TEXT,
    bucket_updated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS daily_usage (
    usage_date DATE NOT NULL,
    github_login TEXT NOT NULL,
    credits NUMERIC(10,2) NOT NULL DEFAULT 0,
    tokens_input BIGINT NOT NULL DEFAULT 0,
    tokens_output BIGINT NOT NULL DEFAULT 0,
    chat_requests INTEGER NOT NULL DEFAULT 0,
    agent_requests INTEGER NOT NULL DEFAULT 0,
    accepted_lines INTEGER NOT NULL DEFAULT 0,
    suggested_lines INTEGER NOT NULL DEFAULT 0,
    acceptance_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
    credits_per_acc_loc NUMERIC(10,4) NOT NULL DEFAULT 0,
    model_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    ide_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    language_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (usage_date, github_login)
  )`,
  `CREATE TABLE IF NOT EXISTS team_usage (
    usage_date DATE NOT NULL,
    team TEXT NOT NULL,
    credits NUMERIC(12,2) NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0,
    avg_acceptance_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
    PRIMARY KEY (usage_date, team)
  )`,
  `CREATE TABLE IF NOT EXISTS pool_snapshots (
    snapshot_date DATE PRIMARY KEY,
    total_credits NUMERIC(12,2) NOT NULL,
    credits_used NUMERIC(12,2) NOT NULL,
    credits_remaining NUMERIC(12,2) NOT NULL,
    forecast_7d NUMERIC(12,2),
    forecast_30d NUMERIC(12,2),
    pct_elapsed NUMERIC(8,4)
  )`,
  `CREATE TABLE IF NOT EXISTS classification_history (
    effective_date DATE NOT NULL,
    github_login TEXT NOT NULL,
    consumption_tier_old TEXT,
    consumption_tier_new TEXT,
    value_tier TEXT,
    reason TEXT,
    PRIMARY KEY (effective_date, github_login)
  )`,
  `CREATE TABLE IF NOT EXISTS budget_snapshots (
    snapshot_date DATE PRIMARY KEY,
    total_budget NUMERIC(12,2) NOT NULL,
    budget_used NUMERIC(12,2) NOT NULL,
    budget_remaining NUMERIC(12,2) NOT NULL,
    pct_used NUMERIC(8,4),
    pct_elapsed NUMERIC(8,4),
    forecast_7d NUMERIC(12,2),
    forecast_30d NUMERIC(12,2),
    pct_of_budget_7d NUMERIC(8,4),
    pct_of_budget_30d NUMERIC(8,4),
    alert_level TEXT,
    notified BOOLEAN NOT NULL DEFAULT false,
    source TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS notification_log (
    id BIGSERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL,
    channel TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    external_id TEXT,
    payload JSONB,
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (snapshot_date, channel, notification_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_team ON users(team)`,
  `CREATE INDEX IF NOT EXISTS idx_daily_usage_github_login ON daily_usage(github_login)`,
  `CREATE INDEX IF NOT EXISTS idx_daily_usage_usage_date ON daily_usage(usage_date)`,
  `CREATE INDEX IF NOT EXISTS idx_classification_history_github_login ON classification_history(github_login)`,
];

export const sqliteSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS raw_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL,
    report_day TEXT NOT NULL,
    source_url TEXT NOT NULL,
    payload TEXT NOT NULL,
    ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (report_type, report_day)
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    github_login TEXT PRIMARY KEY,
    enterprise TEXT NOT NULL,
    org TEXT NOT NULL,
    display_name TEXT,
    email TEXT,
    team TEXT,
    employee_id TEXT,
    manager TEXT,
    seat_created_at TEXT,
    last_activity_at TEXT,
    consumption_tier TEXT,
    value_tier TEXT,
    bucket_updated_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS daily_usage (
    usage_date TEXT NOT NULL,
    github_login TEXT NOT NULL,
    credits NUMERIC NOT NULL DEFAULT '0',
    tokens_input INTEGER NOT NULL DEFAULT 0,
    tokens_output INTEGER NOT NULL DEFAULT 0,
    chat_requests INTEGER NOT NULL DEFAULT 0,
    agent_requests INTEGER NOT NULL DEFAULT 0,
    accepted_lines INTEGER NOT NULL DEFAULT 0,
    suggested_lines INTEGER NOT NULL DEFAULT 0,
    acceptance_rate NUMERIC NOT NULL DEFAULT '0',
    credits_per_acc_loc NUMERIC NOT NULL DEFAULT '0',
    model_breakdown TEXT NOT NULL DEFAULT '{}',
    ide_breakdown TEXT NOT NULL DEFAULT '{}',
    language_breakdown TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (usage_date, github_login)
  )`,
  `CREATE TABLE IF NOT EXISTS team_usage (
    usage_date TEXT NOT NULL,
    team TEXT NOT NULL,
    credits NUMERIC NOT NULL DEFAULT '0',
    active_users INTEGER NOT NULL DEFAULT 0,
    avg_acceptance_rate NUMERIC NOT NULL DEFAULT '0',
    PRIMARY KEY (usage_date, team)
  )`,
  `CREATE TABLE IF NOT EXISTS pool_snapshots (
    snapshot_date TEXT PRIMARY KEY,
    total_credits NUMERIC NOT NULL,
    credits_used NUMERIC NOT NULL,
    credits_remaining NUMERIC NOT NULL,
    forecast_7d NUMERIC,
    forecast_30d NUMERIC,
    pct_elapsed NUMERIC
  )`,
  `CREATE TABLE IF NOT EXISTS classification_history (
    effective_date TEXT NOT NULL,
    github_login TEXT NOT NULL,
    consumption_tier_old TEXT,
    consumption_tier_new TEXT,
    value_tier TEXT,
    reason TEXT,
    PRIMARY KEY (effective_date, github_login)
  )`,
  `CREATE TABLE IF NOT EXISTS budget_snapshots (
    snapshot_date TEXT PRIMARY KEY,
    total_budget NUMERIC NOT NULL,
    budget_used NUMERIC NOT NULL,
    budget_remaining NUMERIC NOT NULL,
    pct_used NUMERIC,
    pct_elapsed NUMERIC,
    forecast_7d NUMERIC,
    forecast_30d NUMERIC,
    pct_of_budget_7d NUMERIC,
    pct_of_budget_30d NUMERIC,
    alert_level TEXT,
    notified INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,
    channel TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    external_id TEXT,
    payload TEXT,
    success INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (snapshot_date, channel, notification_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_team ON users(team)`,
  `CREATE INDEX IF NOT EXISTS idx_daily_usage_github_login ON daily_usage(github_login)`,
  `CREATE INDEX IF NOT EXISTS idx_daily_usage_usage_date ON daily_usage(usage_date)`,
  `CREATE INDEX IF NOT EXISTS idx_classification_history_github_login ON classification_history(github_login)`,
];

export async function runMigrations(db: any): Promise<void> {
  const isSqlite = typeof db.run === 'function';
  const statements = isSqlite ? sqliteSchemaStatements : pgSchemaStatements;
  
  for (const stmt of statements) {
    if (isSqlite) {
      db.run(sql.raw(stmt));
    } else {
      await db.execute(sql.raw(stmt));
    }
  }
}

import { resolve } from 'node:path';

const argv1 = process.argv[1];
const isMain = argv1 && (
  resolve(argv1) === resolve(fileURLToPath(import.meta.url)) ||
  resolve(argv1) === resolve(fileURLToPath(import.meta.url)).replace(/\.[jt]s$/, '') ||
  argv1.endsWith('/migrate') ||
  argv1.endsWith('/migrate.js') ||
  argv1.endsWith('/migrate.ts')
);

if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Error: DATABASE_URL environment variable is required.');
    process.exit(1);
  }
  const { initDb, closeDb } = await import('./client.js');
  const db = initDb(url);
  try {
    await runMigrations(db);
    console.log('Migrations completed successfully.');
  } catch (err) {
    console.error('Migrations failed:', err);
    process.exit(1);
  } finally {
    await closeDb();
  }
}
