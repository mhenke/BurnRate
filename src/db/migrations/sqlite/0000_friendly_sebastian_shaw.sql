CREATE TABLE `budget_snapshots` (
	`snapshot_date` text PRIMARY KEY NOT NULL,
	`total_budget` numeric NOT NULL,
	`budget_used` numeric NOT NULL,
	`budget_remaining` numeric NOT NULL,
	`pct_used` numeric,
	`pct_elapsed` numeric,
	`forecast_7d` numeric,
	`forecast_30d` numeric,
	`pct_of_budget_7d` numeric,
	`pct_of_budget_30d` numeric,
	`alert_level` text,
	`notified` integer DEFAULT 0 NOT NULL,
	`source` text,
	`note` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `classification_history` (
	`effective_date` text NOT NULL,
	`github_login` text NOT NULL,
	`consumption_tier_old` text,
	`consumption_tier_new` text,
	`value_tier` text,
	`reason` text
);
--> statement-breakpoint
CREATE INDEX `classification_history_github_login_idx` ON `classification_history` (`github_login`);--> statement-breakpoint
CREATE UNIQUE INDEX `classification_history_date_login_pk` ON `classification_history` (`effective_date`,`github_login`);--> statement-breakpoint
CREATE TABLE `daily_usage` (
	`usage_date` text NOT NULL,
	`github_login` text NOT NULL,
	`credits` numeric DEFAULT '0' NOT NULL,
	`tokens_input` integer DEFAULT 0 NOT NULL,
	`tokens_output` integer DEFAULT 0 NOT NULL,
	`chat_requests` integer DEFAULT 0 NOT NULL,
	`agent_requests` integer DEFAULT 0 NOT NULL,
	`accepted_lines` integer DEFAULT 0 NOT NULL,
	`suggested_lines` integer DEFAULT 0 NOT NULL,
	`acceptance_rate` numeric DEFAULT '0' NOT NULL,
	`credits_per_acc_loc` numeric DEFAULT '0' NOT NULL,
	`model_breakdown` text DEFAULT '{}' NOT NULL,
	`ide_breakdown` text DEFAULT '{}' NOT NULL,
	`language_breakdown` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `daily_usage_github_login_idx` ON `daily_usage` (`github_login`);--> statement-breakpoint
CREATE INDEX `daily_usage_usage_date_idx` ON `daily_usage` (`usage_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_usage_date_login_pk` ON `daily_usage` (`usage_date`,`github_login`);--> statement-breakpoint
CREATE TABLE `notification_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_date` text NOT NULL,
	`channel` text NOT NULL,
	`notification_type` text NOT NULL,
	`external_id` text,
	`payload` text,
	`success` integer DEFAULT 1 NOT NULL,
	`error_message` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_unique` ON `notification_log` (`snapshot_date`,`channel`,`notification_type`);--> statement-breakpoint
CREATE TABLE `pool_snapshots` (
	`snapshot_date` text PRIMARY KEY NOT NULL,
	`total_credits` numeric NOT NULL,
	`credits_used` numeric NOT NULL,
	`credits_remaining` numeric NOT NULL,
	`forecast_7d` numeric,
	`forecast_30d` numeric,
	`pct_elapsed` numeric
);
--> statement-breakpoint
CREATE TABLE `raw_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_type` text NOT NULL,
	`report_day` text NOT NULL,
	`source_url` text NOT NULL,
	`payload` text NOT NULL,
	`ingested_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_reports_type_day_unique` ON `raw_reports` (`report_type`,`report_day`);--> statement-breakpoint
CREATE TABLE `team_usage` (
	`usage_date` text NOT NULL,
	`team` text NOT NULL,
	`credits` numeric DEFAULT '0' NOT NULL,
	`active_users` integer DEFAULT 0 NOT NULL,
	`avg_acceptance_rate` numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_usage_date_team_pk` ON `team_usage` (`usage_date`,`team`);--> statement-breakpoint
CREATE TABLE `users` (
	`github_login` text PRIMARY KEY NOT NULL,
	`enterprise` text NOT NULL,
	`org` text NOT NULL,
	`display_name` text,
	`email` text,
	`team` text,
	`employee_id` text,
	`manager` text,
	`seat_created_at` text,
	`last_activity_at` text,
	`consumption_tier` text,
	`value_tier` text,
	`bucket_updated_at` text,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `users_team_idx` ON `users` (`team`);