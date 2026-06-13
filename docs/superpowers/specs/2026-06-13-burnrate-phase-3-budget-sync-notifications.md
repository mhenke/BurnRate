# Phase 3 Design: Budget Sync + Notification Hub

**Date:** 2026-06-13  
**Status:** Approved  
**Approach:** A (Read-only budget automation)

---

## 1. Purpose

Build trust with users before write automation by delivering accurate, timely budget alerts. Phase 3 syncs GitHub Budget API data to local storage and dispatches notifications via Slack and GitHub Issues. No writes to GitHub — zero destructive risk.

**Success Criteria:**
- Budget data syncs daily without manual intervention
- Users receive alerts within 1 hour of threshold breaches
- False positive rate < 5%
- Zero unintended GitHub API writes

---

## 2. Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  GitHub Budget  │────▶│  BurnRate Core   │────▶│  Notifications  │
│      API        │     │  (sync + store)  │     │  (Slack + GH)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  budget_snapshots│
                        │     (SQLite)     │
                        └──────────────────┘
```

**Key Design Decisions:**
- **Read-only:** No CRUD operations against GitHub Budget API in Phase 3
- **Daily sync:** Cron-based, not real-time (cost vs. value trade-off)
- **Multi-channel:** Slack for immediate alerts, GitHub Issues for audit trail
- **Classification-aware:** Phase 2 tiers prioritize notification urgency

---

## 3. Components

### 3.1 Budget API Client (`src/github/budget.ts`)

**Purpose:** Fetch budget data from GitHub Enterprise API.

**Interfaces:**
```typescript
interface BudgetSnapshot {
  org: string;
  budgetId: string;
  amount: number;
  spent: number;
  remaining: number;
  resetDate: string;
  fetchedAt: string;
}

interface BudgetClient {
  getBudgets(org: string): Promise<BudgetSnapshot[]>;
  getBudgetUsage(org: string, budgetId: string): Promise<BudgetUsage>;
}
```

**Error Handling:**
- Retry 3 times with exponential backoff (1s, 2s, 4s)
- Log failures to `budget_sync_errors` table
- Continue processing other orgs on partial failure

---

### 3.2 Database Schema (`src/db/schema.ts`)

**Table:** `budget_snapshots`

```typescript
{
  id: integer (PK, autoincrement),
  org: text (not null),
  budgetId: text (not null),
  amount: real (not null),
  spent: real (not null),
  remaining: real (not null),
  resetDate: text (not null),
  fetchedAt: text (not null),
  createdAt: text (default current_timestamp)
}
```

**Migration:** `migrations/0003_budget_snapshots.sql`

**Index:** `(org, budgetId, fetchedAt)` for time-series queries

---

### 3.3 Notification Dispatch (`src/act/notifications.ts`)

**Purpose:** Route alerts to Slack and GitHub Issues.

**Channels:**
- **Slack:** Webhook POST for immediate team alerts
- **GitHub Issues:** Auto-create issue for audit trail and tracking

**Alert Types:**
1. **Threshold Breach:** >80% budget consumed
2. **Anomaly:** >20% spend spike in 24h
3. **Forecast Warning:** Projected overage before reset

**Payload (Slack):**
```json
{
  "text": "Budget Alert: {org}/{budgetName}",
  "blocks": [
    { "type": "header", "text": "🚨 Budget Threshold Breach" },
    { "type": "section", "fields": [
      { "type": "mrkdwn", "text": "*Org:* {org}" },
      { "type": "mrkdwn", "text": "*Budget:* {budgetName}" },
      { "type": "mrkdwn", "text": "*Spent:* {spent}/{amount} ({pct}%)" },
      { "type": "mrkdwn", "text": "*Reset:* {resetDate}" }
    ]}
  ]
}
```

---

### 3.4 Budget Sync Pipeline (`src/act/budget_sync.ts`)

**Purpose:** Orchestrate daily budget data fetch and storage.

**Steps:**
1. Fetch all configured orgs from `github_orgs` table
2. For each org, call `BudgetClient.getBudgets()`
3. Insert snapshots into `budget_snapshots` table (transaction per org)
4. Run threshold/anomaly detection on new data
5. Dispatch notifications for triggered alerts
6. Log sync completion/failure

**Schedule:** Daily at 06:00 UTC (before US business hours)

---

### 3.5 CLI Command (`src/index.ts`)

**Command:** `burnrate budget-sync [--org=<org>] [--dry-run]`

**Options:**
- `--org`: Sync single org (default: all configured orgs)
- `--dry-run`: Fetch but don't store or notify

**Usage:**
```bash
# Manual sync all orgs
burnrate budget-sync

# Manual sync single org
burnrate budget-sync --org=acme-corp

# Test fetch without side effects
burnrate budget-sync --dry-run
```

---

### 3.6 GitHub Actions Workflow (`.github/workflows/daily-budget-check.yml`)

**Schedule:** `cron: '0 6 * * *'` (daily 06:00 UTC)

**Jobs:**
1. **sync:** Run `burnrate budget-sync`
2. **alert:** Notify on failure (Slack webhook)

**Secrets Required:**
- `GITHUB_TOKEN` (for API access)
- `SLACK_WEBHOOK_URL` (for notifications)
- `DATABASE_URL` (for SQLite/Postgres)

---

## 4. Data Flow

1. **Fetch:** `BudgetClient` calls GitHub API → returns `BudgetSnapshot[]`
2. **Store:** Insert to `budget_snapshots` table (transactional per org)
3. **Analyze:** Compare new snapshot vs. prior 7-day average
4. **Alert:** If threshold/anomaly detected → `NotificationDispatch.send()`
5. **Log:** Record sync completion in `sync_log` table

---

## 5. Error Handling

**Retry Policy:**
- GitHub API failures: 3 retries, exponential backoff
- Slack webhook failures: 1 retry, then log and continue
- Database failures: Fail fast, alert immediately

**Failure Modes:**
- **Partial sync:** Some orgs succeed, others fail → continue, log failures
- **Notification failure:** Log to `notification_errors` table, alert via alternate channel
- **Schema drift:** Version-check raw JSON storage before parsing

**Alerting on Failures:**
- Sync failure > 2 consecutive days → GitHub Issue auto-created
- Critical errors (DB corruption, auth failure) → Slack + email

---

## 6. Testing Strategy

**Unit Tests:**
- `tests/github/budget.test.ts` — Mock GitHub API responses, test retry logic
- `tests/act/notifications.test.ts` — Mock Slack webhook, test payload formatting
- `tests/act/budget_sync.test.ts` — Mock client + DB, test orchestration

**Integration Tests:**
- `tests/integration/budget_sync_e2e.test.ts` — Real DB, mocked API, verify end-to-end

**Test Data:**
- Fixture: `tests/fixtures/budget_snapshots.json` (sample API responses)
- Migration test: Verify `budget_snapshots` table creates correctly

**Coverage Target:** 80% for new code (consistent with Phase 1/2)

---

## 7. Dependencies

**Phase 2:** Classification system (for notification prioritization — optional for initial Phase 3, required for full value)

**External:**
- GitHub Enterprise API with `manage_billing:copilot` scope
- Slack incoming webhook URL
- GitHub Actions runner with DB access

---

## 8. Out of Scope (Phase 4+)

- Automated budget CRUD operations (writes)
- Copilot Skill integration for human approval
- Email notifications (Slack + Issues only in Phase 3)
- Real-time streaming (daily batch only)
- Multi-org budget aggregation/rollup

---

## 9. Open Questions

1. **Slack channel routing:** Single channel for all alerts, or per-org channels?
2. **GitHub Issue template:** Custom template or default?
3. **Threshold defaults:** 80% breach, 20% anomaly — configurable per org?
4. **Timezone for daily sync:** UTC 06:00 works for US, adjust for EU/APAC orgs?

---

**Next Step:** Invoke `writing-plans` skill to create implementation plan with TDD tasks.
