# BurnRate Phase 4 — ULB Enforcement with Burn-Chart Projection

> **For agentic workers:** This spec is the source of truth for Phase 4. Implement with a `burnrate enforce` CLI command and a daily GitHub Actions cron that runs the same command.

**Goal:** Prevent end-of-month credit exhaustion by dynamically calculating user-level budgets (ULBs) based on burn-chart projection and tier-weighted allocation, with configurable hard/soft enforcement modes. v1 calculates and audits ULBs; GitHub Budgets API writes are deferred to a future phase.

**Architecture:** A daily job reads pool usage and per-user 30-day averages, projects end-of-month burn, calculates tier-weighted allocations from historical baselines, and writes ULB audit records. Rebalancing runs daily independent of weekly classification; classification tiers only set the weighting direction.

**Tech Stack:** TypeScript, Node.js, Drizzle ORM, Postgres + SQLite, `octokit`, `dotenv`, `vitest`, GitHub Actions. GitHub Budgets REST API client deferred to future phase.

**Credits-to-Dollars:** Fixed conversion `1 credit = $0.01 USD`. All internal calculations use credits; GitHub API calls use USD.

---

## 1. Philosophy Shift from Original Spec

The original spec throttled heavy users (extreme=0.5x) to preserve the pool. This design **protects heavy users from disruption** instead:

| Tier | Weight | Rationale |
|------|--------|-----------|
| `extreme` | highest | Power user — never disrupt them |
| `high` | high | Below extreme but still significant usage |
| `medium` | baseline | Standard allocation |
| `low` | lowest | Barely uses Copilot — won't notice tighter limits |

When the pool is at risk, cuts flow in two phases:
1. **Phase 1 — headroom cuts** (bottom-up): Trim Tier 4 (low) first — they won't notice and have minimal headroom anyway. Then Tier 3 (medium), Tier 2 (high), Tier 1 (extreme). Protects power users by exhausting lower tiers first.
2. **Phase 2 — below-floor reclamation** (hard mode only): All users proportionally, largest idle pools first. A user's allocation can reach zero.

Users within a tier are cut proportionally to their headroom (current ULB − 30d average). Users far above their average take bigger cuts than users already near it.

---

## 2. Core Algorithm

### 2.1 Baseline (before tier weighting)

**Historical usage, not equal division.** Each user's baseline is their 30-day rolling average daily spend. New users with no history get the organization average as their starting point.

```typescript
const baseline = user.dailyAvg30d > 0
  ? user.dailyAvg30d * daysRemaining
  : orgDailyAvg * daysRemaining;
```

### 2.2 Tier Weights

Tier weights apply as a multiplier on the baseline. These are configurable:

```yaml
budget:
  tierWeights:
    extreme: 1.5
    high: 1.15
    medium: 1.0
    low: 0.75
```

An extreme user gets 1.5× their historical need. A low user gets 0.75×.

### 2.3 Burn-Chart Projection

```
1. Read pool state:
   - pool_total (from pool_snapshots)
   - credits_used_mtd (SUM of daily_usage for current cycle)
   - days_elapsed in billing cycle
   - days_remaining = cycle_end - today
   - buffer_target = pool_total * buffer_pct  (default 5%)

2. Project end-of-month:
   - daily_burn_rate = credits_used_mtd / days_elapsed
   - projected_eom = credits_used_mtd + (daily_burn_rate * days_remaining)

3. gap = projected_eom - pool_total + buffer_target

4. If gap > 0: need to cut (see 2.4)
   If gap <= 0: allocations fit; optionally restore previous cuts (see 2.6)
```

The buffer is a **month-end target**, not subtracted first. The projection says "we should have 5% of pool remaining on day 30." The full pool is available all month; only the projection targets the buffer.

### 2.4 Top-Down Cut Algorithm

```typescript
function computeCuts(users: UserState[], gap: number): CutResult {
  const CUT_ORDER = ['low', 'medium', 'high', 'extreme']; // bottom-up, protects power users

  let remainingGap = gap;
  const cuts: UserCut[] = [];

  for (const tier of CUT_ORDER) {
    const tierUsers = users.filter(u => u.consumptionTier === tier);
    if (tierUsers.length === 0) continue;

    const availableHeadroom = tierUsers.reduce(
      (sum, u) => sum + Math.max(0, u.currentUlb - u.floor30dAvg),
      0
    );

    const cutFromTier = Math.min(remainingGap, availableHeadroom);
    if (cutFromTier <= 0) continue;

    // Distribute proportionally to each user's headroom
    for (const u of tierUsers) {
      const headroom = Math.max(0, u.currentUlb - u.floor30dAvg);
      const share = headroom / availableHeadroom;
      cuts.push({
        githubLogin: u.githubLogin,
        tier,
        newUlb: Math.round(u.currentUlb - (cutFromTier * share)),
        cutAmount: Math.round(cutFromTier * share),
      });
    }

    remainingGap -= cutFromTier;
    if (remainingGap <= 0) break;
  }

  return { cuts, remainingGap };
}
```

### 2.5 Floor — Baseline Only for Headroom Phase

In Phase 1 (headroom cuts), no user gets cut below their 30-day average. The floor represents their projected remaining need — cutting below it risks mid-session disruption.

In Phase 2 (hard mode only), the floor is overridden: below-floor reclamation proceeds tier-by-tier from low → extreme, reducing idle allocations to close the gap. A user's allocation can reach zero if the pool requires it.

### 2.6 Gradual Restore

If mid-month the projection improves (team goes on vacation, sprint ends), cuts are restored gradually to avoid oscillation:

```typescript
// Restore 50% of the gap between current ULB and target ULB each day
const restoreAmount = Math.round((targetUlb - currentUlb) * restoreRate);
const newUlb = currentUlb + restoreAmount;
```

`restoreRate` defaults to 0.5 (50% per day projection stays under target).

---

## 3. Enforcement Modes

```yaml
budget:
  mode: hard    # guarantee pool containment — below-floor cuts if needed
  # OR
  mode: soft    # minimize disruption — tolerate overage, alert loudly

  # Shared parameters:
  bufferPct: 5
  maxOveragePct: 0.10   # soft mode only: accept up to 10% over pool before cutting
  floorBasis: 30d_avg
  restoreRate: 0.5
  warningHours: 72      # hard mode only: advance notice before cuts land (0 = immediate)
  tierWeights:
    extreme: 1.5
    high: 1.15
    medium: 1.0
    low: 0.75
```

### hard mode

Pool total is an absolute ceiling. The algorithm cuts in two phases:

1. **Headroom cuts** (bottom-up by tier): low → medium → high → extreme, proportional to each user's headroom (current ULB − floor). Low users won't notice — they're already at 0.75x weight with near-zero headroom. Protects power users.
2. **Below-floor reclamation**: All users sorted by **truly idle allocation** descending: `trulyIdle = max(0, currentUlb − projectedUsage)`, where `projectedUsage = dailyAvg30d × daysRemaining`. Users with the largest pools of allocation they won't use by end-of-month get cut first — regardless of tier. This closes the gap in the fewest users possible, critical when high-usage users are actively burning through their allotment. Proportional to each user's remaining ULB. A user's allocation can reach zero.

`warningHours` controls advance notice (0 = cut immediately, 72 = warn 72hrs before cutting).

### soft mode

Minimizes disruption. Algorithm cuts bottom-up from headroom only, never below floor. An additional `maxOveragePct` tolerance is applied: soft mode only starts cutting when the projected overage exceeds `poolTotal * maxOveragePct`. If gap can't be closed without going below floor, the unclosed gap is reported as `uncloseableGap`. Designed for orgs where disruption cost exceeds occasional overage cost.

### What happens when gap can't be closed

- **hard**: Below-floor reclamation by truly-idle descending guarantees the gap closes by reclaiming idle allocation first. `uncloseableGap` is 0 by definition.
- **soft**: Don't cut below floor. Report `uncloseableGap` in the result. Admin decides whether to switch to hard mode.

---

## 4. Data Model

### New table: `ulb_audit`

```sql
CREATE TABLE ulb_audit (
  id BIGSERIAL PRIMARY KEY,
  effective_date DATE NOT NULL,
  github_login TEXT NOT NULL,
  ulb_usd INTEGER NOT NULL,
  ulb_credits INTEGER NOT NULL,
  tier_at_time TEXT NOT NULL,
  baseline_credits INTEGER NOT NULL,
  reason TEXT NOT NULL,
  github_budget_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ulb_audit_login_date ON ulb_audit(github_login, effective_date);
```

Drizzle schema (both PG and SQLite variants, following existing dual-schema pattern):

```typescript
export const ulbAuditPg = pgTable('ulb_audit', {
  id: pgBigserial('id', { mode: 'bigint' }).primaryKey(),
  effectiveDate: pgDate('effective_date').notNull(),
  githubLogin: pgText('github_login').notNull(),
  ulbUsd: pgInteger('ulb_usd').notNull(),
  ulbCredits: pgInteger('ulb_credits').notNull(),
  tierAtTime: pgText('tier_at_time').notNull(),
  baselineCredits: pgInteger('baseline_credits').notNull(),
  reason: pgText('reason').notNull(),
  githubBudgetId: pgText('github_budget_id'),
  createdAt: pgTimestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ulbAuditSq = sqliteTable('ulb_audit', {
  id: sqInteger('id').primaryKey({ autoIncrement: true }),
  effectiveDate: sqText('effective_date').notNull(),
  githubLogin: sqText('github_login').notNull(),
  ulbUsd: sqInteger('ulb_usd').notNull(),
  ulbCredits: sqInteger('ulb_credits').notNull(),
  tierAtTime: sqText('tier_at_time').notNull(),
  baselineCredits: sqInteger('baseline_credits').notNull(),
  reason: sqText('reason').notNull(),
  githubBudgetId: sqText('github_budget_id'),
  createdAt: sqText('created_at').notNull().default('CURRENT_TIMESTAMP'),
});
```

### Migration

Add migration `0002_ulb_audit` for both PG and SQLite (following existing migration file pattern from `0001_drop_value_tier`).

---

## 5. Budget Policy Config Types

```typescript
export type BudgetMode = 'hard' | 'soft';

export type TierWeights = Record<ConsumptionTier, number>;

export type BudgetPolicy = {
  mode: BudgetMode;
  bufferPct: number;
  maxOveragePct: number;
  floorBasis: '30d_avg';
  restoreRate: number;
  warningHours: number;
  tierWeights: TierWeights;
};

export const DEFAULT_TIER_WEIGHTS: TierWeights = {
  extreme: 1.5,
  high: 1.15,
  medium: 1.0,
  low: 0.75,
};
```

Extend `BurnrateConfig`:

```typescript
export type BurnrateConfig = {
  // ... existing fields ...
  budget?: Partial<BudgetPolicy>;
};
```

---

## 6. CLI Interface

```bash
# Manual run
burnrate enforce

# With report output (JSON)
burnrate enforce --report

# Force immediate rebalance even if no gap
burnrate enforce --force

# Dry run (calculate but don't write)
burnrate enforce --dry-run
```

### `--report` JSON output

```json
{
  "mode": "hard",
  "pool_total": 100000,
  "credits_used_mtd": 70000,
  "days_elapsed": 10,
  "days_remaining": 20,
  "projected_eom": 105000,
  "buffer_target": 5000,
  "gap": 5000,
  "action": "throttle",
  "users_adjusted": 12,
  "uncloseable_gap": 0,
  "cuts_by_tier": {
    "extreme": 8,
    "high": 4,
    "medium": 0,
    "low": 0
  },
  "changes": [
    {
      "githubLogin": "jdoe",
      "tier": "extreme",
      "baseline": 2000,
      "previousUlb": 4000,
      "newUlb": 3000,
      "cutAmount": 1000
    }
  ]
}
```

---

## 7. File Structure

| File | Purpose |
|------|---------|
| `src/enforce/types.ts` | BudgetPolicy type, defaults, shared types |
| `src/enforce/engine.ts` | Core algorithm: projection, cut calculation, restore |
| `src/enforce/runner.ts` | Orchestrator: read DB, run engine, write audit log |
| `src/github/budget.ts` | *(deferred)* GitHub Budgets API client |
| `src/cli/args.ts` | Add `enforce` command parsing |
| `src/index.ts` | Wire `enforce` command |
| `src/db/schema.ts` | Add `ulbAuditPg` / `ulbAuditSq` tables |
| `src/db/queries.ts` | Add ULB audit queries |
| `src/db/migrate.ts` | Add migration for ulb_audit table |
| `src/config.ts` | Extend BurnrateConfig with BudgetPolicy |
| `config/burnrate.sample.yml` | Add budget section |
| `.github/workflows/daily-enforce.yml` | Daily cron workflow |
| `tests/enforce/engine.test.ts` | Unit tests for projection, cuts, restore |
| `tests/enforce/runner.test.ts` | Integration tests with DB |
| `tests/enforce/policy.test.ts` | Config loading and defaults |
| `tests/github/budget.test.ts` | *(deferred)* GitHub Budgets API tests |

---

## 8. Error Handling

| Error | Behavior |
|-------|----------|
| GitHub API returns 403 | Log error, exit non-zero, dispatch notification via existing notification service |
| GitHub API returns 429 (rate limit) | Retry with exponential backoff (max 3 attempts) |
| Pool usage data missing (<7 days) | Fail with clear message: "Insufficient data for projection" |
| User not found in GitHub API | Log warning, skip user, continue |
| ULB set fails for single user | Log error, continue with other users |
| All ULB sets fail | Exit non-zero, dispatch critical notification |
| Gap uncloseable (hard mode) | Cut to floor, then alert admin via notification service |
| Gap uncloseable (soft mode) | Don't cut below floor, alert admin with overage projection |

---

## 9. Testing Strategy

### Unit tests (`tests/enforce/engine.test.ts`)
- Projection math (various burn rates, various days remaining)
- Gap calculation with and without buffer
- Top-down cut distribution (proportional to headroom)
- Tier 4 (low) cut first in Phase 1 (bottom-up order), reclaimed in Phase 2 (hard mode)
- Floor enforcement in Phase 1, below-floor reclamation by truly-idle descending in Phase 2 (hard mode)
- Below-floor proportional cut distribution (largest idle pools first)
- Soft mode overage tolerance (maxOveragePct)
- Gradual restore (50% rate)
- Credits-to-USD conversion (rounding behavior)
- Tier weight application

### Integration tests (`tests/enforce/runner.test.ts`)
- End-to-end: seed DB → run runner → verify ulb_audit rows
- Idempotency: re-running same day doesn't duplicate audit rows
- Mock GitHub Budgets API: verify correct request bodies
- Dry-run mode: calculates but doesn't write
- Force mode: rebalances even with no gap

### Policy tests (`tests/enforce/policy.test.ts`)
- Default tier weights
- Config merging (sample.yml defaults + env overrides)
- Mode validation
- Missing config sections (graceful defaults)

---

## 10. Daily Cron Workflow

```yaml
# .github/workflows/daily-enforce.yml
name: daily-enforce
on:
  schedule:
    - cron: '0 1 * * *'   # 1 AM UTC, after ETL
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
      - run: npx tsx src/index.ts enforce --report
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          BURNRATE_CONFIG: config/burnrate.yml
```

---

## 11. What We Deferred from the Original Spec

- **Last-day release**: Dropped. Daily projection with restore handles end-of-month naturally — allocations progressively expand as remaining days approach zero. An explicit last-day lump release is a patch for fixed-allocation systems.
- **Equal fair-share baseline**: Replaced with 30-day rolling average. Equal split ignores that power users legitimately need 10x what light users need.
- **Fixed tier multipliers**: Replaced with configurable tier weights + burn-chart projection. The original 0.5x/0.75x/1.0x/1.25x multipliers pointed in the wrong direction (tightened heavy users).
- **Managed mode**: Collapsed into hard mode with `warningHours` parameter. Same guarantee, configurable advance notice.

## 12. Open Questions

1. **Billing cycle detection** — GitHub doesn't expose cycle end date via API. For v1, hardcode in config (`billing_cycle_start_day: 1`). Can infer from pool_snapshots reset pattern in a future iteration.

2. **GitHub Budgets API endpoint shape** — The Budgets API is new. Exact request/response schema will need to be verified against actual API. Mock based on what we know from the existing GitHub API patterns.

3. **Notification for advance warnings** — The `warningHours: 72` parameter means we need a deferred notification system. For v1, use a `pending_actions` table or check on each enforce run whether the warning deadline has passed. Decisions pending implementation.
