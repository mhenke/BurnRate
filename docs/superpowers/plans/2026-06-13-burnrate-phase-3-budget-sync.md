# BurnRate Phase 3 — Budget Sync + Notification Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read budget limits via the GitHub API, snapshot them daily alongside forecast projections, and deliver digest-style notifications to Slack and GitHub Issues when burn-rate thresholds are crossed. Read-only towards GitHub — no budget-limit writes.

**Spec:** `docs/superpowers/specs/2026-06-13-burnrate-phase-3-budget-sync-notifications.md`

**Tech Stack:** TypeScript, Node.js, Octokit, Drizzle ORM, Postgres + SQLite, `vitest`, GitHub Actions, Slack Incoming Webhooks.

---

### Task 1: Add budget_snapshots and notification_log to schema + migration

**Files:**
- Modify: `src/db/schema.ts` (add `budgetSnapshotsPg/Sq`, `notificationLogPg/Sq`)
- Modify: `src/db/migrate.ts` (add DDL for both tables)
- Create: `tests/db/phase3_schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import * as schema from '../../src/db/schema.js';

describe('phase 3 schema', () => {
  it('defines budget_snapshots for both postgres and sqlite', () => {
    assert.ok(schema.budgetSnapshotsPg, 'budgetSnapshotsPg should be defined');
    assert.ok(schema.budgetSnapshotsSq, 'budgetSnapshotsSq should be defined');
  });
  it('defines notification_log for both postgres and sqlite', () => {
    assert.ok(schema.notificationLogPg, 'notificationLogPg should be defined');
    assert.ok(schema.notificationLogSq, 'notificationLogSq should be defined');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/phase3_schema.test.ts`
Expected: fail because schema tables don't exist yet.

- [ ] **Step 3: Write minimal implementation**

Add to `src/db/schema.ts`:
- `budgetSnapshotsPg` / `budgetSnapshotsSq` with columns: `snapshot_date` (PK), `total_budget`, `budget_used`, `budget_remaining`, `pct_used`, `pct_elapsed`, `forecast_7d`, `forecast_30d`, `pct_of_budget_7d`, `pct_of_budget_30d`, `alert_level`, `notified`, `source`, `note`, `created_at`, `updated_at`
- `notificationLogPg` / `notificationLogSq` with columns: `id` (PK auto), `snapshot_date`, `channel`, `notification_type`, `external_id`, `payload`, `success`, `error_message`, `created_at`
- Unique constraint on `(snapshot_date, channel, notification_type)` for notification_log

Add to `src/db/migrate.ts`:
- Corresponding `CREATE TABLE IF NOT EXISTS` statements in both `pgSchemaStatements` and `sqliteSchemaStatements`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/phase3_schema.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrate.ts tests/db/phase3_schema.test.ts
git commit -m "feat: add budget_snapshots and notification_log schema"
```

---

### Task 2: Create shared retry utility

**Files:**
- Create: `src/budget/retry.ts`
- Create: `tests/budget/retry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { withRetry } from '../../src/budget/retry.js';

describe('retry utility', () => {
  it('exports withRetry function', () => {
    assert.equal(typeof withRetry, 'function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/budget/retry.test.ts`
Expected: fail because module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

Implement `src/budget/retry.ts`:
```typescript
export type RetryOptions = {
  maxAttempts: number;
  delays: number[];
  onRetry?: (attempt: number, error: Error) => void;
  delayFn?: (ms: number) => Promise<void>;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: Error | undefined;
  const delay = options.delayFn ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < options.maxAttempts) {
        options.onRetry?.(attempt, lastError);
        await delay(options.delays[attempt - 1] ?? 1000);
      }
    }
  }
  throw lastError!;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/budget/retry.test.ts`
Expected: pass.

- [x] **Step 5: Commit** (skipped — will commit as part of Task 5)

---

### Task 3: Create budget API client

**Files:**
- Create: `src/github/budget.ts`
- Create: `tests/github/budget.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { fetchBilling } from '../../src/github/budget.js';

describe('budget API client', () => {
  it('exports fetchBilling function', () => {
    assert.equal(typeof fetchBilling, 'function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/github/budget.test.ts`
Expected: fail.

- [ ] **Step 3: Write minimal implementation**

Implement `src/github/budget.ts` with:
- `fetchBilling(client: GitHubClient): Promise<CopilotBillingResponse>`
- Uses Octokit to call `GET /enterprises/{enterprise}/copilot/billing`
- Returns typed response with `total_budget`, `budget_used`, `budget_remaining`, `spending_limit`, `total_seats`, etc.
- Wraps call with `withRetry` for network/5xx errors
- 401/403/404 throw immediately

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/github/budget.test.ts`
Expected: pass.

---

### Task 4: Create notification dispatch (Slack + GitHub Issue)

**Files:**
- Create: `src/budget/notifications.ts`
- Create: `tests/budget/notifications.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { sendSlackNotification } from '../../src/budget/notifications.js';

describe('notifications', () => {
  it('exports sendSlackNotification', () => {
    assert.equal(typeof sendSlackNotification, 'function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/budget/notifications.test.ts`
Expected: fail.

- [ ] **Step 3: Write minimal implementation**

Implement `src/budget/notifications.ts`:
- `sendSlackNotification(webhookUrl, payload, retryDelay?)` — POST to Slack webhook with retry via `withRetry`. Injectable `retryDelay` for testing.
- `sendGitHubIssue(client, owner, repo, payload)` — POST to Issues API. Uses `GET /repos/{owner}/{repo}/issues?labels=burnrate-budget&state=open` to find existing issue. Creates or comments. Updates title on level change.
- Both functions accept `db: DbClient` for dedup check against `notification_log`
- Dedup: skip if `notification_log` has matching `(snapshot_date, channel, notification_type)` with `success = true`
- Slack blocks vary by alert level (warning/escalation/critical/all_clear)

Tests cover:
- Slack success, 4xx, 5xx, retry with injectable delay
- Issue creation, commenting, title update
- Dedup (existing successful notification_log entry)
- Missing webhook URL skip

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/budget/notifications.test.ts`
Expected: pass.

---

### Task 5: Create budget sync pipeline

**Files:**
- Create: `src/budget/budget_sync.ts`
- Create: `tests/budget/budget_sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { runBudgetSync } from '../../src/budget/budget_sync.js';

describe('budget sync pipeline', () => {
  it('exports runBudgetSync function', () => {
    assert.equal(typeof runBudgetSync, 'function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/budget/budget_sync.test.ts`
Expected: fail.

- [ ] **Step 3: Write minimal implementation**

Implement `src/budget/budget_sync.ts` with steps:
1. Fetch billing via `fetchBilling(gh)` — fallback to `pool_snapshots` if API fields absent; reject annual budgets
2. Load latest forecast from `pool_snapshots` — handle empty table (set forecasts to null, derive alert_level from pct_used)
3. Compute derived metrics (`pct_used`, `pct_of_budget_7d`, `pct_of_budget_30d`, `alert_level`)
4. Determine alert level: `max(pct_of_budget_7d, pct_of_budget_30d)` evaluated against thresholds (90/100/110)
5. Compare against yesterday's `alert_level` for change-only notifications
6. Upsert `budget_snapshots` row with `ON CONFLICT DO UPDATE`
7. Dispatch notifications only on level change (or all-clear)
8. Log to `notification_log`
9. Return `BudgetSyncResult`

Use structured JSON logging throughout (`{"event": "...", ...}`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/budget/budget_sync.test.ts`
Expected: pass.

- [ ] **Step 5: Commit Tasks 2–5**

```bash
git add src/budget/ src/github/budget.ts tests/budget/ tests/github/budget.test.ts
git commit -m "feat: add budget sync pipeline with retry, API client, notifications"
```

---

### Task 6: Wire CLI command and add npm script

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`
- Create: `tests/budget/budget_sync.cli.test.ts` (or add to `tests/index.test.ts`)

- [ ] **Step 1: Write the failing test**

Add to `tests/index.test.ts`:
```ts
it('routes the budget-sync command', async () => {
  // Mock runBudgetSync, verify it's called with correct args
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index.test.ts`
Expected: fail (new test, not yet implemented).

- [ ] **Step 3: Write minimal implementation**

Add to `src/index.ts`:
- Import `runBudgetSync` from `./budget/budget_sync.js`
- Add `budget-sync` command handler with flag parsing (dry-run, json-logs)
- CLI follows same pattern as `classify` command

Add to `package.json`:
```json
"budget-sync": "tsx src/index.ts budget-sync"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/index.test.ts`
Expected: pass.

---

### Task 7: Add GitHub Actions workflow

**Files:**
- Create: `.github/workflows/daily-budget-check.yml`

- [ ] **Step 1: Write the failing test** (not applicable — no test for workflow files)

- [ ] **Step 2: Verify the workflow** (not applicable — GitHub Actions validates at runtime)

- [ ] **Step 3: Write minimal implementation**

Create `.github/workflows/daily-budget-check.yml`:
```yaml
name: daily-budget-check
on:
  schedule:
    - cron: '0 9 * * *'
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
          DRY_RUN: ${{ vars.DRY_RUN || 'false' }}
```

- [ ] **Step 4: Verify**

Run: `npm test` (all tests pass)
Run: `npm run build` (compiles cleanly)

- [ ] **Step 5: Commit Tasks 6–7**

```bash
git add src/index.ts package.json .github/workflows/daily-budget-check.yml tests/index.test.ts
git commit -m "feat: wire budget-sync CLI command and daily workflow"
```

---

### Verification checklist for Phase 3

- [ ] `npm run build` succeeds
- [ ] `npm test` succeeds (all existing + new tests)
- [ ] `npm run budget-sync -- --dry-run` runs without writing to DB or sending notifications
- [ ] `npm run budget-sync -- --dry-run --json-logs` outputs JSON-structured logs
- [ ] Budget API fallback path works (tested via mock)
- [ ] Notification dedup works (same snapshot_date + channel + type skipped)
- [ ] Alert level change-only notification works (same level produces no notification)
- [ ] All-clear notification fires when alert_level returns to ok
- [ ] `withRetry` exhausts retries and throws final error
- [ ] `withRetry` injectable delay works in tests
- [ ] GitHub Actions workflow exists and uses `GITHUB_PAT` secret
- [ ] SQLite `ON CONFLICT DO UPDATE` works correctly (integration test)
- [ ] Empty `pool_snapshots` table doesn't crash the pipeline
- [ ] No budget-limit writes to GitHub occur
