# BurnRate Phase 3 — Budget Sync + Notification Hub

> **For agentic workers:** This spec is the source of truth for Phase 3. Every implementation decision — retry policy, table shape, notification format, config schema — must trace back to a section in this document.

**Goal:** Read budget limits via the GitHub API, snapshot them daily alongside forecast projections, and deliver digest-style notifications to Slack and GitHub Issues when burn-rate thresholds are crossed. Writes are intentional here (budget_snapshots, notification log), but **no budget-limit writes** to GitHub occur — this phase builds read-side trust before any write automation in Phase 4.

**Tech Stack:** TypeScript, Node.js, Octokit, Drizzle ORM, Postgres + SQLite, `vitest`, GitHub Actions, Slack Incoming Webhooks.

---

## 1. Purpose

Phase 3 introduces a **daily budget observation loop** that closes the visibility gap between raw usage data and actionable overspend warnings:

- **Today:** Phase 1 & 2 produce forecast numbers that live in Postgres and workflow logs. An admin must open the repo, run a query, or check the latest workflow run to see them.
- **After Phase 3:** The same numbers are automatically pushed to Slack and GitHub Issues each morning. The loop is still read-only on the GitHub side — no Copilot budget limits are adjusted — but the notification channel is real, so the team builds confidence in the pipeline's numerical accuracy before we trust it to write.

### Key principles

| Principle | Rationale |
|-----------|-----------|
| **Read-only towards GitHub** | Budget snapshots are stored locally; no PATCH/PUT to any GitHub settings endpoint. |
| **Idempotent notifications** | Re-running the same day's sync should not produce duplicate Slack messages or Issues. |
| **Degraded-but-functional** | If Slack webhook fails, still write the GitHub Issue. If both fail, log locally and alert via workflow failure. |
| **Battle-test before write** | Phase 3's notification quality and retry logic prove the pipeline is production-ready. Phase 4 adds the write lever. |

---

## 2. Architecture

```
┌──────────────────────┐     ┌─────────────────────┐
│  GitHub Copilot      │     │  Slack Incoming      │
│  Billing API         │     │  Webhook             │
│  GET /copilot/billing│     │  POST /webhook       │
└──────┬───────────────┘     └──────┬──────────────┘
       │ ① GET budget               │ ⑤ POST notification
       ▼                            ▼
┌───────────────────────────────────────────────┐
│               budget-sync pipeline            │
│  src/budget/budget_sync.ts                    │
│                                                │
│  ① Fetch budget from GitHub API                │
│  ② Load latest forecast from pool_snapshots    │
│  ③ Compute burn-rate metrics + thresholds      │
│  ④ Insert budget_snapshots row                 │
│  ⑤ Determine notification level                │
│  ⑥ Dispatch notifications (Slack + Issue)      │
│  ⑦ Log notification to notification_log        │
└───────────────────────────────────────────────┘
       │                   ▲
       ▼                   │
┌───────────────────────────────────────────────┐
│  Postgres / SQLite                            │
│  ├── budget_snapshots   (new)                 │
│  ├── pool_snapshots     (existing)            │
│  ├── notification_log   (new)                 │
│  └── daily_usage        (existing)            │
└───────────────────────────────────────────────┘
```

### Module boundaries

| Layer | Module | Responsibility |
|-------|--------|----------------|
| API client | `src/github/budget.ts` | Octokit-wrapped budget fetch, typed response, response validation, retry wrapper |
| Schema | `src/db/schema.ts` | `budget_snapshots` + `notification_log` table definitions |
| Pipeline | `src/budget/budget_sync.ts` | Orchestrates fetch → compute → store → notify |
| Notifications | `src/budget/notifications.ts` | Slack webhook POST + GitHub Issue creation |
| Retry utility | `src/budget/retry.ts` | Shared `withRetry` wrapper with injectable delay for budget API and Slack webhook |
| CLI | `src/index.ts` | `burnrate budget-sync` command entrypoint |
| Cron | `.github/workflows/daily-budget-check.yml` | Runs `burnrate budget-sync` every morning |

---

## 3. Components

### 3.1 `src/github/budget.ts` — Budget API client

Single-purpose module that fetches enterprise Copilot billing info.

**Endpoint:** `GET /enterprises/{enterprise}/copilot/billing`

**Response shape (typed):**

```typescript
export type CopilotBillingResponse = {
  total_seats: number;
  seats_breakdown: {
    total: number;
    filled: number;
    pending: number;
    cancelled: number;
  };
  seat_breakdown: {
    active_this_cycle: number;
    inactive_this_cycle: number;
  };
  total_assignments: number;
  // Budget fields (subject to GitHub's rollout — may be absent pre-GA)
  total_budget?: number;
  budget_used?: number;
  budget_remaining?: number;
  spending_limit?: {
    type: 'monthly'; // Phase 3: 'annual' not supported — if received, fall back to pool_snapshots and log warning
    value: number;
    used: number;
    remaining: number;
  };
};
```

**If `total_budget` / `spending_limit` is absent** (pre-GA), the client falls back to `pool_snapshots.total_credits` as the budget figure. The pipeline logs a warning so operators know the source.

**Exports:**

```typescript
export function fetchBilling(client: GitHubClient): Promise<CopilotBillingResponse>;
```

**Error behavior:**
- 401/403 → throw `BudgetAuthError` (misconfigured token)
- 404 → throw `BudgetNotFoundError` (enterprise-level billing not set up)
- Network timeout → retry via `withRetry` utility (up to 3 attempts with exponential backoff)
- Non-retryable 4xx → throw immediately

**Testing:** Mock Octokit `request` to return controlled responses. Test each error code path.

See §5 for the shared retry utility specification.

### 3.2 `src/db/schema.ts` — Budget snapshots + notification log tables

Error handling follows the existing codebase pattern: plain `Error` with descriptive messages. No custom error classes needed — `throw new Error('Budget API: 401 unauthorized')` is consistent with Phase 1/2.

**`budget_snapshots`** — Append-only daily record of budget state + computed projections.

| Column | Type (PG) | Type (SQ) | Notes |
|--------|-----------|-----------|-------|
| `snapshot_date` | `date PK` | `text PK` | Unique per day |
| `total_budget` | `numeric(12,2)` | `numeric` | From API or pool fallback |
| `budget_used` | `numeric(12,2)` | `numeric` | From API or computed MTD |
| `budget_remaining` | `numeric(12,2)` | `numeric` | Derived |
| `pct_used` | `numeric(8,4)` | `numeric` | (budget_used / total_budget) * 100 |
| `pct_elapsed` | `numeric(8,4)` | `numeric` | Days elapsed / days in month |
| `forecast_7d` | `numeric(12,2)` | `numeric` | From latest pool_snapshots or recomputed |
| `forecast_30d` | `numeric(12,2)` | `numeric` | Same |
| `pct_of_budget_7d` | `numeric(8,4)` | `numeric` | forecast_7d / total_budget * 100 |
| `pct_of_budget_30d` | `numeric(8,4)` | `numeric` | forecast_30d / total_budget * 100 |
| `alert_level` | `text` | `text` | `'ok'` / `'warning'` / `'escalation'` / `'critical'` — derived from `max(pct_of_budget_7d, pct_of_budget_30d)` using thresholds: >=110 critical, >=100 escalation, >=90 warning, else ok |
| `notified` | `boolean` | `integer (bool)` | Whether notifications were sent for this day (`true` only if ALL configured channels dispatched successfully) |
| `source` | `text` | `text` | Budget source: `'api'` (from GitHub API) or `'pool_fallback'` (from pool_snapshots.total_credits) |
| `note` | `text` | `text` | Optional details (e.g., `'fallback: pool_snapshots.total_credits'`, `'annual budget not supported'`) |
| `created_at` | `timestamptz` | `text` | Insert timestamp |
| `updated_at` | `timestamptz` | `text` | Last update timestamp (tracks re-runs that overwrite a snapshot) |

The `snapshot_date` PK ensures idempotent re-runs (INSERT ... ON CONFLICT DO UPDATE). The `updated_at` column tracks when the row was last modified, providing an audit trail for re-runs that overwrite data.

**`notification_log`** — Audit trail for every notification dispatched.

One row per dispatch attempt (not per retry). The `success` column reflects the final outcome after any retries attempted in that dispatch cycle.

| Column | Type (PG) | Type (SQ) | Notes |
|--------|-----------|-----------|-------|
| `id` | `bigserial PK` | `integer PK auto` | |
| `snapshot_date` | `date` | `text` | Links to budget_snapshots |
| `channel` | `text` | `text` | `'slack'` / `'github_issue'` |
| `notification_type` | `text` | `text` | `'warning'` / `'escalation'` / `'critical'` / `'all_clear'` |
| `external_id` | `text` | `text` | Slack message TS or GitHub issue number |
| `payload` | `jsonb` | `text (json)` | Full notification payload for replay/debug |
| `success` | `boolean` | `integer (bool)` | Final delivery outcome (after retries, if any) |
| `error_message` | `text` | `text` | Failure reason if any (`null` on success) |
| `created_at` | `timestamptz` | `text` | Insert timestamp |

**Unique constraint:** `UNIQUE(snapshot_date, channel, notification_type)` — enforces dedup at the database level as a safety net. The pipeline also checks before dispatching, but the constraint prevents race conditions.

**Registration pattern:** Both Postgres and SQLite versions are exported as named pairs (`budgetSnapshotsPg` / `budgetSnapshotsSq`, `notificationLogPg` / `notificationLogSq`), following the existing convention.

### 3.3 `src/budget/notifications.ts` — Notification dispatch

Two dispatch targets, both invoked from the pipeline. Each function is independently testable.

**Slack dispatch:**

```typescript
export async function sendSlackNotification(
  webhookUrl: string,
  payload: BudgetNotificationPayload,
  retryDelay?: number, // injectable for testing; defaults to 250
): Promise<{ success: boolean; ts?: string; error?: string }>;
```

The `retryDelay` parameter makes retry timing injectable for tests — use `vi.useFakeTimers()` or pass `0` in test to avoid real delays.

Sends a rich JSON payload to an Incoming Webhook URL.

**Message format (Slack Blocks):**

```
┌─────────────────────────────────────────┐
│ 🚨 BurnRate Alert — Critical            │
│                                         │
│ • Budget:   $10,000 / $12,000 (83.3%)   │
│ • Days:     Day 18 of 30 (60% elapsed)  │
│ • Forecast: $11,200 (7d) / $11,800 (30d)│
│ • Over/Under: 🔴 Projected overspend    │
│                                         │
│ <Compare in BurnRate dashboard|URL>     │
└─────────────────────────────────────────┘
```

The block layout varies by alert level:
- `ok` / no notification required → not sent at all
- `warning` → yellow-themed, single section
- `escalation` → orange-themed, two sections
- `critical` → red-themed, three sections + "action required" callout

**Slack webhook URL** is read from `SLACK_WEBHOOK_URL` env var (required for Slack dispatch, skipped if absent).

**GitHub Issue dispatch:**

```typescript
export async function sendGitHubIssue(
  client: GitHubClient,
  owner: string,
  repo: string,
  payload: BudgetNotificationPayload,
): Promise<{ success: boolean; issueNumber?: number; error?: string }>;
```

Creates (or updates) an issue in `owner/repo` with a `burnrate-budget` label. Uses the Issues listing endpoint (`GET /repos/{owner}/{repo}/issues?labels=burnrate-budget&state=open`) to find an existing open issue — if one exists, comments on it AND updates the title to reflect the current alert level. New issues get a title like:

> BurnRate Alert: [warning/escalation/critical] — Copilot Budget at 83.3% on 2026-06-13

When commenting on an existing issue with a different alert level, PATCH the issue title to match the current level (e.g., `warning` → `escalation`).

**Deduplication:** Before dispatching, check `notification_log` for a successful notification (`success = true`) on the same `snapshot_date` + `channel` + `notification_type`. Skip if one exists. A failed notification (`success = false`) will NOT block a retry — the pipeline will attempt dispatch again.

Both notification functions accept `db: DbClient` to perform the dedup check internally before sending. The dedup check is advisory — the `UNIQUE` constraint on `(snapshot_date, channel, notification_type)` provides DB-level protection against race conditions.

**Degradation:** If Slack is unavailable (webhook URL missing, 4xx response), log the failure but continue to Issue dispatch. If Issue creation also fails, the pipeline logs both errors and exits non-zero. The `notified` flag on `budget_snapshots` is set to `false` so a human operator can re-trigger. On re-run, the pipeline checks `notification_log` for entries with `success = true` — only successful notifications are skipped, allowing failed attempts to retry.

**All-clear notification:** If yesterday's `alert_level` was non-`ok` AND today's is `ok`, send a single `all_clear` notification to both channels. This closes the loop for operators who received critical alerts.

**Alert cooldown / change-only notifications:** To prevent alert fatigue, notifications are sent ONLY when the `alert_level` changes — NOT on every daily run at the same level. The pipeline compares today's computed `alert_level` against yesterday's (from the previous `budget_snapshots` row). If they match, no notification is dispatched. This limits alerts to at most one per level-transition per billing cycle (e.g., `ok → warning → escalation → critical → all_clear`), not 30 daily repeats.

### 3.4 `src/budget/budget_sync.ts` — Budget sync pipeline

The orchestrating function. Signature:

```typescript
export type BudgetSyncResult = {
  snapshotDate: string;
  totalBudget: number;
  budgetUsed: number;
  pctUsed: number;
  pctOfBudget7d: number;
  pctOfBudget30d: number;
  alertLevel: 'ok' | 'warning' | 'escalation' | 'critical';
  slackNotified: boolean;
  issueNotified: boolean;
  errors: string[];
};

export async function runBudgetSync(
  gh: GitHubClient,
  db: DbClient,
  config: BudgetSyncConfig,
): Promise<BudgetSyncResult>;
```

**Steps, in order:**

1. **Fetch billing** — Call `fetchBilling(gh)`. Extract `total_budget` (or `spending_limit.value`) and `budget_used`.
   - If `spending_limit.type === 'annual'`: fall back to `pool_snapshots.total_credits`, set `source: 'pool_fallback'`, log warning.
   - If `total_budget` / `spending_limit` absent: fall back to `pool_snapshots.total_credits`, set `source: 'pool_fallback'`, log warning.
2. **Load forecast** — Read latest `pool_snapshots` row for `forecast_7d` and `forecast_30d`.
   - If `pool_snapshots` table is empty (fresh database): set forecasts to `null`, log warning, derive `alert_level` from `pct_used` alone. Continue pipeline — don't abort.
3. **Compute metrics** — Derive `pct_used`, `pct_elapsed`, `pct_of_budget_7d`, `pct_of_budget_30d`.
4. **Determine alert level** — Use `max(pct_of_budget_7d, pct_of_budget_30d)` evaluated against thresholds:
   - `pct >= 110` → `critical`
   - `pct >= 100` → `escalation`
   - `pct >= 90` → `warning`
   - else `ok`
5. **Upsert budget snapshot** — `INSERT INTO budget_snapshots ... ON CONFLICT (snapshot_date) DO UPDATE`. Set `source` and `note` columns appropriately.
6. **Dispatch notifications** — Call `sendSlackNotification` and/or `sendGitHubIssue` only if:
   - `alert_level` is not `ok` AND `alert_level` changed from yesterday's value (compares against previous `budget_snapshots` row), OR
   - `alert_level` is `ok` AND yesterday's was non-`ok` (all-clear notification)
   - Set `notified = true` only if ALL configured channels dispatched successfully.
   - If Slack succeeds but Issue fails (or vice versa), `notified = false` and the failed channel will retry on next run.
7. **Log notifications** — Insert rows into `notification_log` for each dispatch attempt.
8. **Return result** — Aggregated summary.

**Config shape:**

```typescript
export type BudgetSyncConfig = {
  slackWebhookUrl?: string;
  issueRepoOwner: string;
  issueRepoName: string;
};
```

### 3.5 CLI `budget-sync` command

Registered in `src/index.ts`:

```
burnrate budget-sync
```

Optional flags:

| Flag | Env override | Default |
|------|-------------|---------|
| `--slack-webhook` | `SLACK_WEBHOOK_URL` | none (Slack skipped if absent) |
| `--issue-repo` | `BUDGET_ISSUE_REPO` | `owner/repo` from config |
| `--dry-run` | — | `false` |

`--dry-run` fetches and computes but skips DB writes and notification dispatch. Prints the full result JSON to stdout.

CLI wiring follows the same pattern as `classify` — parse flags in a local function, call `runBudgetSync`, log the result.

### 3.6 `daily-budget-check.yml` — GitHub Actions workflow

```yaml
name: daily-budget-check
on:
  schedule:
    - cron: '0 9 * * *'   # 09:00 UTC daily
  workflow_dispatch: {}
jobs:
  budget-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run budget-sync
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_PAT }}
          BURNRATE_CONFIG: config/burnrate.yml
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          BUDGET_ISSUE_REPO: ${{ github.repository }}
```

Runs at 09:00 UTC (after nightly ETL and morning forecast). When `workflow_dispatch` is triggered manually, respects `--dry-run` if the `DRY_RUN` env var is `true`. The workflow template passes `DRY_RUN` via `${{ vars.DRY_RUN || 'false' }}` for repo-level variable control.

---

## 4. Data Flow

### Happy path (daily)

```
09:00 UTC ──► daily-budget-check workflow starts
                 │
                 ├─► runBudgetSync()
                 │      │
                 │      ├─► GET /enterprises/{slug}/copilot/billing
                 │      │      └─► Returns { total_budget, spending_limit, ... }
                 │      │
                 │      ├─► SELECT * FROM pool_snapshots ORDER BY snapshot_date DESC LIMIT 1
                 │      │      └─► Returns { forecast_7d, forecast_30d }
                 │      │
                 │      ├─► Compute pct_used, pct_of_budget_7d/30d, alert_level
                 │      │
                 │      ├─► UPSERT INTO budget_snapshots (snapshot_date, ...)
                 │      │
                 │      ├─► IF alert_level != 'ok':
                 │      │      ├─► POST to Slack webhook
                 │      │      │     └─► INSERT INTO notification_log (channel='slack')
                 │      │      │
                 │      │      └─► POST /repos/{owner}/{repo}/issues
                 │      │            └─► INSERT INTO notification_log (channel='github_issue')
                 │      │
                 │      └─► Return BudgetSyncResult
                 │
                 └─► Workflow completes (exit 0 or non-zero on notification failure)
```

### Re-run (same day)

```
Upsert on snapshot_date PK replaces the existing row.
notification_log check prevents duplicate Slack/Issue delivery for the same date+channel+type.
```

### Dry run

```
Fetches and computes but skips all DB writes and notifications.
Prints full result JSON to stdout for manual verification.
```

---

## 5. Error Handling

### 5.1 Shared retry utility (`src/budget/retry.ts`)

A reusable `withRetry` wrapper handles retry logic for both budget API calls and Slack webhook dispatches. Implemented as a higher-order function rather than inlined retry loops.

```typescript
export type RetryOptions = {
  maxAttempts: number;
  delays: number[]; // delays between attempts (e.g., [250, 500, 1000])
  onRetry?: (attempt: number, error: Error) => void;
  delayFn?: (ms: number) => Promise<void>; // injectable for testing (default: setTimeout)
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T>;
```

Key design decisions:
- **`delayFn` injectable:** Tests can pass `(ms) => Promise.resolve()` to skip real waits, or use `vi.useFakeTimers()` with real `setTimeout`. This removes the 1.75s minimum test time.
- **`delays` array:** Explicit delay values rather than computed backoff. Simple and testable.
- **`onRetry` callback:** Logs retry attempts (e.g., `"Budget API retry 2/4 after 500ms: 503 Service Unavailable"`)
- **Non-retryable errors** (4xx below 500) must be thrown as specific error types that `withRetry` re-throws immediately.

### 5.2 Retry configurations

| Caller | `maxAttempts` | `delays` | Non-retryable |
|--------|--------------|----------|---------------|
| Budget API fetch | 4 (initial + 3 retries) | `[250, 500, 1000]` | 401, 403, 404 |
| Slack webhook | 2 (initial + 1 retry) | `[250]` | 4xx (client error — payload issue) |

Budget API retries use 4 total attempts. Slack webhook retries use 2 total attempts (transient Slack blips are rare but well-known).

### 5.3 Notification failure

| Failure mode | Behavior |
|-------------|----------|
| Slack webhook missing | Skip Slack dispatch, continue to Issue |
| Slack webhook 4xx | Log error_message in notification_log, do not retry |
| Slack webhook 5xx/network | Log error, continue |
| GitHub Issue API 4xx | Log error, continue |
| Both fail | Pipeline sets exit code 1, errors[] includes both messages |

### 5.4 DB failure

If the UPSERT into `budget_snapshots` fails, the entire pipeline aborts immediately (no point sending notifications from a failed snapshot). The error propagates up to the CLI handler, which exits non-zero.

### 5.5 Missing budget fields in API response

If the Copilot billing response lacks `total_budget` and `spending_limit`, the pipeline falls back to `pool_snapshots.total_credits` and logs a warning to stdout. The `budget_snapshots` row records the fallback source in the `source` column (`'pool_fallback'`) and details in the `note` column (e.g., `'fallback: pool_snapshots.total_credits'`).

### 5.6 Annual budget type

If the API returns `spending_limit.type: 'annual'`, the pipeline does NOT use the annual budget fields (Phase 3 only supports monthly cycles). Fall back to `pool_snapshots.total_credits`, set `source: 'pool_fallback'`, and log: `"Annual budget cycles not yet supported — using pool fallback"`.

### 5.7 Workflow failure alerts

GitHub's built-in workflow failure notifications email the workflow creator. For broader team coverage, the pipeline emits a **JSON-structured error summary** as the final log line before exit, which can be consumed by log aggregators. Example:

```json
{
  "event": "budget_sync.failed",
  "timestamp": "2026-06-13T09:00:15Z",
  "snapshot_date": "2026-06-13",
  "errors": ["Slack webhook returned 500", "GitHub Issue API returned 403"],
  "partial_success": false
}
```

No additional pager integration (PagerDuty/Opsgenie) in Phase 3.

### 5.8 Structured logging

All pipeline output uses JSON-structured log lines for aggregation and debugging. The CLI `budget-sync` command outputs human-readable summaries by default, but adds `--json-logs` flag for JSON mode. The GitHub Actions cron always logs in JSON format.

Log line examples:

```
// Info: normal operation
{"event":"budget_sync.completed","ts":"2026-06-13T09:00:10Z","snapshot_date":"2026-06-13","alert_level":"warning","notified":true}

// Warning: fallback used
{"event":"budget_sync.fallback","ts":"2026-06-13T09:00:12Z","reason":"pool_snapshots.total_credits","note":"Budget API fields absent"}

// Error: retry exhausted
{"event":"budget_sync.retry_exhausted","ts":"2026-06-13T09:00:15Z","caller":"fetchBilling","attempts":4,"error":"503 Service Unavailable"}
```

---

## 6. Testing Strategy

### Unit tests

| File | Coverage target |
|------|----------------|
| `tests/github/budget.test.ts` | Mock Octokit `request` for: success, 401, 403, 404, 5xx, network timeout, missing budget fields, annual budget fallback |
| `tests/budget/budget_sync.test.ts` | Full pipeline with mocked GitHub API + DB. Test: normal run, dry run, missing forecast (empty pool_snapshots), all alert levels, all-clear notification, partial notification failure, SQLite ON CONFLICT upsert |
| `tests/budget/notifications.test.ts` | Mock `fetch` for Slack webhook. Mock Octokit Issue creation + Issues listing. Test: success, 4xx, 5xx, retry (injectable delay), dedup (existing successful notification_log entry), issue title update on level change |
| `tests/budget/retry.test.ts` | Unit test `withRetry` with injectable `delayFn`. Test: success on retry, exhausts retries, immediate rejection on 4xx, correct delay sequence |

### Integration-style tests

- `runBudgetSync` with SQLite in-memory DB and fixture data covering each alert level
- Verify `budget_snapshots` row shape, `updated_at` changes on re-run, constraint enforcement
- Verify `notification_log` rows match dispatch attempts
- Verify `UNIQUE(snapshot_date, channel, notification_type)` constraint prevents duplicate notification_log entries
- Verify SQLite `ON CONFLICT DO UPDATE` works correctly (Drizzle ORM compatibility — verify immediately after creating schema)
- Verify `pct_of_budget_7d` and `pct_of_budget_30d` with boundary threshold values (89.99, 90.00, 99.99, 100.00, 109.99, 110.00)

### Verification goal

- All API error code paths are exercised at least once
- Notification deduplication is tested (same snapshot_date + channel duplicates are skipped)
- Dry-run mode modifies no state
- Each alert level produces the expected Slack block structure

---

## 7. Config & Environment

### New env vars

| Variable | Required | Default | Used by |
|----------|----------|---------|---------|
| `SLACK_WEBHOOK_URL` | No | (none) | Slack dispatch |
| `BUDGET_ISSUE_REPO` | Yes (CLI) | — | Issue dispatch, format `owner/repo` |

### Package.json scripts

```json
{
  "budget-sync": "tsx src/index.ts budget-sync"
}
```

---

## 8. Phase 4 Handoff Notes

Phase 3 builds the read-side foundation for Phase 4's ULB write automation:

- **Join path:** Phase 4 will correlate `budget_snapshots.alert_level` with `ulb_audit` via `snapshot_date` ↔ `effective_date`.
- **Budget ID:** Phase 4 will need to query the GitHub Budgets API separately to retrieve `budget_id` for PATCH operations (not stored in Phase 3).
- **Useful columns:** `pct_of_budget_7d` and `pct_of_budget_30d` are directly used by Phase 4's ULB calculation (end-of-month projection).
- **No foreign keys:** Date-based joins are sufficient and avoid tight coupling between phases.

These items are intentionally out of scope for Phase 3:

| Item | Rationale |
|------|-----------|
| PATCH budget limits on GitHub | Write automation requires team trust in numbers first |
| Auto-resolve Issues when alert clears | Manual resolution builds awareness; automate in Phase 4 |
| Custom Slack channel per alert level | Simple single-webhook model is sufficient for Phase 3 |
| PagerDuty / Opsgenie integration | Slack + Issues cover the day team; escalation can be added later |
| Budget history dashboard UI | Data exists in Postgres; frontend is a separate phase |
