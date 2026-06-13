# BurnRate Phase 3 — ULB Enforcement with 5% Buffer

> **For agentic workers:** This spec is the source of truth for Phase 3. Implement with a `burnrate enforce` CLI command and a daily GitHub Actions cron that runs the same command.

**Goal:** Prevent end-of-month credit exhaustion by dynamically adjusting user-level budgets (ULBs) to maintain a 5% buffer, then release limits on the last day for "use it or lose it" consumption.

**Architecture:** A daily job reads pool usage, projects end-of-month burn, calculates tier-based ULBs in credits, converts to USD, and writes via GitHub Budgets API. The same job runs both manually and from cron.

**Tech Stack:** TypeScript, Node.js, Drizzle ORM, Postgres + SQLite, `octokit`, `dotenv`, `vitest`, GitHub Actions, GitHub Budgets REST API.

**Credits-to-Dollars:** Fixed conversion `1 credit = $0.01 USD`. All internal calculations use credits; GitHub API calls use USD.

---

## 1. Scope

### In scope

- `burnrate enforce` CLI command
- Daily GitHub Actions cron (runs at 1 AM, after ETL)
- Pool usage projection with 5% buffer target
- Tier-based ULB calculation (extreme=0.5x, high=0.75x, medium=1.0x, low=1.25x)
- GitHub Budgets API integration (create/update user-level budgets)
- Audit logging of all ULB changes
- Last-day release automation ("use it or lose it")
- Optional Slack notification webhook
- Unit tests for projection math, tier multipliers, USD conversion

### Out of scope

- Copilot Skills integration
- Chat-based warnings (GitHub doesn't support this)
- Custom billing cycles (GitHub uses calendar month)
- Manager approval workflows
- Cost center budget management
- Model-level throttling

---

## 2. Design Summary

### Core Algorithm

```
1. Read pool state:
   - pool_total (from pool_snapshots or config)
   - credits_used_mtd (SUM of daily_usage for current cycle)
   - remaining_days = cycle_end - today
   - target_buffer = pool_total * 0.05

2. Project end-of-month:
   - daily_burn_rate = credits_used_mtd / days_elapsed
   - projected_eom = credits_used_mtd + (daily_burn_rate * remaining_days)

3. If projected_eom > (pool_total - target_buffer):
   # Need to throttle
   - distributable = pool_total - credits_used_mtd - target_buffer
   - For each user:
     * fair_share = distributable / active_users
     * tier_multiplier = get_multiplier(user.consumption_tier)
     * ulb_credits = fair_share * tier_multiplier
     * ulb_usd = round_up(ulb_credits * 0.01)
     * Call GitHub API: SET user-level budget = ulb_usd
   - Log all changes to ulb_audit table

4. If today == cycle_end - 1 day:
   # Release limits
   - For each user with active ULB:
     * Remove or set to $0
   - Notify: "Use remaining X credits before reset"
```

### Tier Multipliers

| Consumption Tier | Multiplier | Rationale |
|------------------|------------|-----------|
| `extreme` | 0.5x | Penalize heavy users to preserve pool |
| `high` | 0.75x | Moderate throttling |
| `medium` | 1.0x | Baseline (no adjustment) |
| `low` | 1.25x | Reward light users, allow overflow absorption |

### Credits-to-Dollars Conversion

```typescript
const CREDIT_TO_USD = 0.01; // Fixed by GitHub pricing

// Internal calculation (credits)
const ulbCredits = fairShare * tierMultiplier;

// API call (USD, rounded up to avoid premature blocking)
const ulbUSD = Math.ceil(ulbCredits * CREDIT_TO_USD);

// Audit log (both)
`Set ULB for ${login}: $${ulbUSD} USD (${ulbCredits} credits)`
```

---

## 3. Data Model

### New table: `ulb_audit`

```sql
CREATE TABLE ulb_audit (
  id BIGSERIAL PRIMARY KEY,
  effective_date DATE NOT NULL,
  github_login TEXT NOT NULL,
  ulb_usd INTEGER NOT NULL,
  ulb_credits INTEGER NOT NULL,
  tier_at_time TEXT NOT NULL,
  reason TEXT NOT NULL, -- 'daily_recalc', 'last_day_release', 'manual'
  github_budget_id TEXT, -- ID returned from API
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for lookups
CREATE INDEX ulb_audit_login_date ON ulb_audit(github_login, effective_date);
```

### Drizzle schema (src/db/schema.ts)

Add to both PostgreSQL and SQLite schemas:

```typescript
export const ulbAuditPg = pgTable('ulb_audit', {
  id: pgBigserial('id', { mode: 'bigint' }).primaryKey(),
  effectiveDate: pgDate('effective_date').notNull(),
  githubLogin: pgText('github_login').notNull(),
  ulbUsd: pgInteger('ulb_usd').notNull(),
  ulbCredits: pgInteger('ulb_credits').notNull(),
  tierAtTime: pgText('tier_at_time').notNull(),
  reason: pgText('reason').notNull(),
  githubBudgetId: pgText('github_budget_id'),
  createdAt: pgTimestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// SQLite equivalent
export const ulbAuditSq = sqliteTable('ulb_audit', {
  id: sqInteger('id').primaryKey({ autoIncrement: true }),
  effectiveDate: sqText('effective_date').notNull(),
  githubLogin: sqText('github_login').notNull(),
  ulbUsd: sqInteger('ulb_usd').notNull(),
  ulbCredits: sqInteger('ulb_credits').notNull(),
  tierAtTime: sqText('tier_at_time').notNull(),
  reason: sqText('reason').notNull(),
  githubBudgetId: sqText('github_budget_id'),
  createdAt: sqText('created_at').notNull().default('CURRENT_TIMESTAMP'),
});
```

### Migration (src/db/migrate.ts)

Add to both `pgSchemaStatements` and `sqliteSchemaStatements`:

```sql
CREATE TABLE IF NOT EXISTS ulb_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_date TEXT NOT NULL,
  github_login TEXT NOT NULL,
  ulb_usd INTEGER NOT NULL,
  ulb_credits INTEGER NOT NULL,
  tier_at_time TEXT NOT NULL,
  reason TEXT NOT NULL,
  github_budget_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. CLI Interface

```bash
# Manual run
burnrate enforce

# With custom config
burnrate enforce --value-config ./path/to/config.yml

# With report output
burnrate enforce --report

# Force last-day release (for testing)
burnrate enforce --force-release
```

### `--report` JSON output

```json
{
  "pool_total": 100000,
  "credits_used_mtd": 70000,
  "remaining_days": 10,
  "projected_eom": 105000,
  "target_buffer": 5000,
  "action": "throttle",
  "users_adjusted": 12,
  "ulb_changes": [
    {
      "login": "jdoe",
      "tier": "extreme",
      "ulb_usd": 50,
      "ulb_credits": 5000,
      "previous_ulb_usd": 100,
      "reason": "daily_recalc"
    }
  ],
  "last_day_release": false
}
```

---

## 5. GitHub Budgets API Integration

### Endpoint

```
POST /enterprises/{enterprise}/settings/billing/budgets
PATCH /enterprises/{enterprise}/settings/billing/budgets/{budget_id}
```

### Request body (user-scoped)

```json
{
  "budget_amount": 50,
  "prevent_further_usage": true,
  "budget_scope": "user",
  "budget_entity_name": "",
  "budget_type": "BundlePricing",
  "budget_product_sku": "ai_credits",
  "budget_alerting": {
    "will_alert": true,
    "alert_recipients": ["admin@example.com"]
  },
  "user": "jdoe"
}
```

### Auth requirements

- Classic PAT with `manage_billing:copilot` scope
- OR GitHub App installation token with `copilot` permission
- Header: `X-GitHub-Api-Version: 2026-03-10`

### Rate limits

- 5,000 requests/hour per token
- Batch ULB updates if >100 users

---

## 6. Error Handling

| Error | Behavior |
|-------|----------|
| GitHub API returns 403 | Log error, exit non-zero, alert admin |
| GitHub API returns 429 (rate limit) | Retry with exponential backoff (max 3 attempts) |
| Pool usage data missing (<30 days) | Fail with clear message: "Insufficient data for projection" |
| User not found in GitHub API | Log warning, skip user, continue |
| ULB set fails for single user | Log error, continue with other users |
| All ULB sets fail | Exit non-zero, alert admin |

---

## 7. Testing

### Unit tests

- Credits-to-USD conversion (rounding behavior)
- Tier multiplier application
- Projection math (various burn rates)
- Last-day detection logic
- 5% buffer threshold calculation

### Integration tests

- Mock GitHub API: verify correct request bodies
- Seed database with usage data, verify ULB calculations
- Test idempotency (re-running same day doesn't duplicate audit rows)

### Manual verification

- Run against test enterprise with known usage
- Verify GitHub UI reflects ULB changes
- Verify email alerts at 75%/90%/100% thresholds

---

## 8. Workflow

### Daily cron (1 AM, after ETL)

```yaml
# .github/workflows/daily-enforce.yml
name: daily-enforce
on:
  schedule:
    - cron: '0 1 * * *'
  workflow_dispatch: {}
jobs:
  enforce:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run enforce
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_PAT }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          BURNRATE_CONFIG: config/burnrate.yml
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }} # optional
```

### Manual run

1. Load config from `.env` and `burnrate.yml`
2. Validate DB + GitHub API connectivity
3. Run enforcement job
4. Print JSON summary if `--report` flag

### Last-day automation

1. Detect `today == cycle_end - 1` (GitHub billing cycle end)
2. For each user with active ULB:
   - `PATCH /budgets/{id}` with `budget_amount: 0` or delete
3. Log to `ulb_audit` with `reason: 'last_day_release'`
4. Notify: "X credits remaining — use before reset!"

---

## 9. Slack Notification (Optional)

If `SLACK_WEBHOOK_URL` env var is set, send:

```json
{
  "text": "🚨 BurnRate ULB Adjustment\n\n*Pool:* 70,000 / 100,000 credits (70%)\n*Projected EOM:* 105,000 (over by 5,000)\n*Action:* Throttling 12 users\n\n*Top adjustments:*\n• jdoe (extreme): $100 → $50\n• asmith (high): $100 → $75\n\nSee dashboard: <URL|BurnRate>"
}
```

---

## 10. Open Questions

1. **Billing cycle detection** — GitHub doesn't expose cycle end date via API. Should we:
   - (a) Hardcode in config (`billing_cycle_end: 3` for 3rd of month)
   - (b) Infer from `pool_snapshots` reset pattern
   - (c) Manual config only

2. **Minimum guaranteed ULB** — Should throttled users get a floor (e.g., $5/day for essential work)?

3. **Manager override API** — Should BurnRate expose an endpoint for managers to exempt users, or is GitHub UI sufficient?

---

## 11. Decision

Phase 3 will implement **automated ULB enforcement** with:
- Daily projection + throttling job
- 5% buffer target
- Tier-based multipliers
- Credits-to-USD conversion at API boundary
- Audit logging to `ulb_audit`
- Last-day release automation
- Optional Slack notifications

**Deferred:**
- Manager override UI/API
- Cost center budget management
- Model-level throttling
- Custom billing cycles
