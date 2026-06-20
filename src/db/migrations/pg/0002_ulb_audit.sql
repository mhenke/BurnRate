CREATE TABLE IF NOT EXISTS "ulb_audit" (
  "id" BIGSERIAL PRIMARY KEY,
  "effective_date" DATE NOT NULL,
  "github_login" TEXT NOT NULL,
  "ulb_usd" NUMERIC(12,2) NOT NULL,
  "ulb_credits" NUMERIC(12,2) NOT NULL,
  "tier_at_time" TEXT NOT NULL,
  "baseline_credits" NUMERIC(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ulb_audit_date_login_idx" ON "ulb_audit" ("effective_date", "github_login");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ulb_audit_login_date_idx" ON "ulb_audit" ("github_login", "effective_date");
