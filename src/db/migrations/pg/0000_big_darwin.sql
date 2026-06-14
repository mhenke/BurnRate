CREATE TABLE "budget_snapshots" (
	"snapshot_date" date PRIMARY KEY NOT NULL,
	"total_budget" numeric(12, 2) NOT NULL,
	"budget_used" numeric(12, 2) NOT NULL,
	"budget_remaining" numeric(12, 2) NOT NULL,
	"pct_used" numeric(8, 4),
	"pct_elapsed" numeric(8, 4),
	"forecast_7d" numeric(12, 2),
	"forecast_30d" numeric(12, 2),
	"pct_of_budget_7d" numeric(8, 4),
	"pct_of_budget_30d" numeric(8, 4),
	"alert_level" text,
	"notified" boolean DEFAULT false NOT NULL,
	"source" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classification_history" (
	"effective_date" date NOT NULL,
	"github_login" text NOT NULL,
	"consumption_tier_old" text,
	"consumption_tier_new" text,
	"value_tier" text,
	"reason" text,
	CONSTRAINT "classification_history_date_login_pk" UNIQUE("effective_date","github_login")
);
--> statement-breakpoint
CREATE TABLE "daily_usage" (
	"usage_date" date NOT NULL,
	"github_login" text NOT NULL,
	"credits" numeric(10, 2) DEFAULT '0' NOT NULL,
	"tokens_input" bigint DEFAULT 0 NOT NULL,
	"tokens_output" bigint DEFAULT 0 NOT NULL,
	"chat_requests" integer DEFAULT 0 NOT NULL,
	"agent_requests" integer DEFAULT 0 NOT NULL,
	"accepted_lines" integer DEFAULT 0 NOT NULL,
	"suggested_lines" integer DEFAULT 0 NOT NULL,
	"acceptance_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"credits_per_acc_loc" numeric(10, 4) DEFAULT '0' NOT NULL,
	"model_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ide_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"language_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "daily_usage_date_login_pk" UNIQUE("usage_date","github_login")
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"channel" text NOT NULL,
	"notification_type" text NOT NULL,
	"external_id" text,
	"payload" jsonb,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_unique" UNIQUE("snapshot_date","channel","notification_type")
);
--> statement-breakpoint
CREATE TABLE "pool_snapshots" (
	"snapshot_date" date PRIMARY KEY NOT NULL,
	"total_credits" numeric(12, 2) NOT NULL,
	"credits_used" numeric(12, 2) NOT NULL,
	"credits_remaining" numeric(12, 2) NOT NULL,
	"forecast_7d" numeric(12, 2),
	"forecast_30d" numeric(12, 2),
	"pct_elapsed" numeric(8, 4)
);
--> statement-breakpoint
CREATE TABLE "raw_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_type" text NOT NULL,
	"report_day" date NOT NULL,
	"source_url" text NOT NULL,
	"payload" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_reports_type_day_unique" UNIQUE("report_type","report_day")
);
--> statement-breakpoint
CREATE TABLE "team_usage" (
	"usage_date" date NOT NULL,
	"team" text NOT NULL,
	"credits" numeric(12, 2) DEFAULT '0' NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"avg_acceptance_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "team_usage_date_team_pk" UNIQUE("usage_date","team")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"github_login" text PRIMARY KEY NOT NULL,
	"enterprise" text NOT NULL,
	"org" text NOT NULL,
	"display_name" text,
	"email" text,
	"team" text,
	"employee_id" text,
	"manager" text,
	"seat_created_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"consumption_tier" text,
	"value_tier" text,
	"bucket_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "classification_history_github_login_idx" ON "classification_history" USING btree ("github_login");--> statement-breakpoint
CREATE INDEX "daily_usage_github_login_idx" ON "daily_usage" USING btree ("github_login");--> statement-breakpoint
CREATE INDEX "daily_usage_usage_date_idx" ON "daily_usage" USING btree ("usage_date");--> statement-breakpoint
CREATE INDEX "users_team_idx" ON "users" USING btree ("team");