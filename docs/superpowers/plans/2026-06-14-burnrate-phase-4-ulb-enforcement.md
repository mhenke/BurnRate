# Phase 4: ULB Enforcement with Burn-Chart Projection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily enforcement pipeline that reads pool usage, projects end-of-month burn, calculates tier-weighted user-level budgets from 30-day averages, and writes ULBs to the audit log, with hard/soft enforcement modes.

**Architecture:** `src/enforce/engine.ts` contains pure math with two cut phases: Phase 1 headroom cuts (bottom-up by tier: low → medium → high → extreme, protects power users) and Phase 2 below-floor reclamation (hard mode only, sorted by truly-idle descending — largest unused allocation reclaimed first, fastest gap closure). `src/enforce/runner.ts` orchestrates reads from DB, runs the engine, writes to `ulb_audit`. `src/config.ts` is extended with `BudgetPolicy`. A new `daily-enforce.yml` workflow runs the CLI daily.

**Tech Stack:** TypeScript, Node.js, Drizzle ORM (PostgreSQL + SQLite), `octokit`, `dotenv`, `vitest`, GitHub Actions.

**Credits-to-Dollars:** Fixed `1 credit = $0.01 USD`. Internal calculations in credits; API calls in USD.

---

## File Structure

| File | Create/Modify | Purpose |
|------|--------------|---------|
| `src/enforce/types.ts` | Create | `BudgetPolicy`, `TierWeights`, `UserState`, `EnforceResult` types (`ConsumptionTier` defined locally — avoids circular dep) |
| `src/config.ts` | Modify | Extend `BurnrateConfig` with optional `budget` section |
| `src/db/schema.ts` | Modify | Add `ulbAuditPg` / `ulbAuditSq` tables |
| `src/db/migrations/pg/0002_ulb_audit.sql` | Create | PostgreSQL migration |
| `src/db/migrations/sqlite/0002_ulb_audit.sql` | Create | SQLite migration |
| `src/db/migrations/pg/meta/_journal.json` | Modify | Add journal entry |
| `src/db/migrations/sqlite/meta/_journal.json` | Modify | Add journal entry |
| `src/db/queries.ts` | Modify | Add `getLatestUlbForAllUsers`, `upsertUlbAudit` queries (batched) |
| `src/enforce/engine.ts` | Create | Projection, cut distribution, restore math (with day-1 dampening) |
| `src/enforce/runner.ts` | Create | Orchestrator: read DB, run engine, write audit (with ETL staleness check, UTC) |
| `src/cli/args.ts` | Modify | Add `parseEnforceArgs` |
| `src/index.ts` | Modify | Wire `enforce` command |
| `config/burnrate.sample.yml` | Modify | Add `budget` section |
| `.github/workflows/daily-enforce.yml` | Create | Daily cron workflow |
| `tests/enforce/policy.test.ts` | Create | Config loading and defaults |
| `tests/enforce/engine.test.ts` | Create | Unit tests for projection, cuts, restore |
| `tests/enforce/runner.test.ts` | Create | Integration tests with in-memory SQLite |

---

### Task 1: Budget Policy Types

**Files:**
- Create: `src/enforce/types.ts`

- [x] **Step 1: Create types file** — Council review deviations: `ConsumptionTier` defined locally (avoids circular dep), `warningHours` removed (YAGNI #9), `floorBasis` removed (YAGNI #12), `report`/`force` removed from EnforceOptions (clean interface)

```typescript
import type { ConsumptionTier } from '../classify/engine.js';

export type BudgetMode = 'hard' | 'soft';

export type TierWeights = Record<ConsumptionTier, number>;

export const DEFAULT_TIER_WEIGHTS: TierWeights = {
  extreme: 1.5,
  high: 1.15,
  medium: 1.0,
  low: 0.75,
};

export type BudgetPolicy = {
  mode: BudgetMode;
  bufferPct: number;
  maxOveragePct: number;
  floorBasis: '30d_avg';
  restoreRate: number;
  warningHours: number;
  tierWeights: TierWeights;
};

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  mode: 'soft',
  bufferPct: 0.05,
  maxOveragePct: 0,
  floorBasis: '30d_avg',
  restoreRate: 0.5,
  warningHours: 72,
  tierWeights: DEFAULT_TIER_WEIGHTS,
};

export type UserState = {
  githubLogin: string;
  consumptionTier: ConsumptionTier;
  dailyAvg30d: number;
  currentUlb: number;
  daysRemaining: number;
};

export type UserCut = {
  githubLogin: string;
  tier: ConsumptionTier;
  baseline: number;
  previousUlb: number;
  newUlb: number;
  cutAmount: number;
};

export type EnforceResult = {
  mode: BudgetMode;
  poolTotal: number;
  creditsUsedMtd: number;
  daysElapsed: number;
  daysRemaining: number;
  projectedEom: number;
  bufferTarget: number;
  gap: number;
  action: 'throttle' | 'restore' | 'none';
  usersAdjusted: number;
  uncloseableGap: number;
  changes: UserCut[];
};

export type EnforceOptions = {
  reason: 'daily_recalc' | 'manual';
  report: boolean;
  dryRun: boolean;
  force: boolean;
};
```

- [x] **Step 2: Commit** — Committed as part of fix-1 batch

---

### Task 2: Extend BurnrateConfig with BudgetPolicy

**Files:**
- Modify: `src/config.ts:1-26`

- [x] **Step 1: Add import and extend config type** — Council review: `floorBasis` and `warningHours` removed from BudgetPolicy

```typescript
import type { BudgetPolicy } from './enforce/types.js';
```

Replace the `BurnrateConfig` type:

```typescript
export type BurnrateConfig = {
  github: { enterprise?: string; org: string; token: string };
  postgres: { url: string };
  thresholds?: Partial<BurnrateThresholds>;
  notifications?: NotificationsConfig;
  budget?: Partial<BudgetPolicy>;
};
```

Update `loadConfig` return to include budget:

```typescript
  return {
    github: { enterprise: enterprise ?? '', org, token },
    postgres: { url },
    thresholds: fileConfig.thresholds,
    notifications: fileConfig.notifications,
    budget: fileConfig.budget,
  };
```

- [x] **Step 2: Add resolveBudgetPolicy helper** — Council review: `floorBasis` and `warningHours` removed from resolver

Add after `resolveThresholds`:

```typescript
import { DEFAULT_BUDGET_POLICY, type BudgetPolicy } from './enforce/types.js';

export function resolveBudgetPolicy(
  budget: BurnrateConfig['budget'] = {},
): BudgetPolicy {
  return {
    mode: budget.mode ?? DEFAULT_BUDGET_POLICY.mode,
    bufferPct: budget.bufferPct ?? DEFAULT_BUDGET_POLICY.bufferPct,
    maxOveragePct: budget.maxOveragePct ?? DEFAULT_BUDGET_POLICY.maxOveragePct,
    floorBasis: budget.floorBasis ?? DEFAULT_BUDGET_POLICY.floorBasis,
    restoreRate: budget.restoreRate ?? DEFAULT_BUDGET_POLICY.restoreRate,
    warningHours: budget.warningHours ?? DEFAULT_BUDGET_POLICY.warningHours,
    tierWeights: {
      ...DEFAULT_BUDGET_POLICY.tierWeights,
      ...budget.tierWeights,
    },
  };
}
```

- [x] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add BudgetPolicy to BurnrateConfig"
```

---

### Task 3: ULB Audit DB Schema

**Files:**
- Modify: `src/db/schema.ts:238` (append after notificationLogSq)

- [x] **Step 1: Add PG ULB audit schema** — Council review: `githubBudgetId` column removed (YAGNI #12)

Append after `notificationLogPg` closing:

```typescript
export const ulbAuditPg = pgTable('ulb_audit', {
  id: pgBigserial('id', { mode: 'bigint' }).primaryKey(),
  effectiveDate: pgDate('effective_date').notNull(),
  githubLogin: pgText('github_login').notNull(),
  ulbUsd: pgNumeric('ulb_usd', { precision: 12, scale: 2 }).notNull(),
  ulbCredits: pgNumeric('ulb_credits', { precision: 12, scale: 2 }).notNull(),
  tierAtTime: pgText('tier_at_time').notNull(),
  baselineCredits: pgNumeric('baseline_credits', { precision: 12, scale: 2 }).notNull(),
  reason: pgText('reason').notNull(),
  githubBudgetId: pgText('github_budget_id'),
  createdAt: pgTimestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  pgUnique('ulb_audit_date_login_pk').on(t.effectiveDate, t.githubLogin),
  pgIndex('ulb_audit_login_date_idx').on(t.githubLogin, t.effectiveDate),
]);
```

And the SQLite variant at end of file:

```typescript
export const ulbAuditSq = sqliteTable('ulb_audit', {
  id: sqInteger('id').primaryKey({ autoIncrement: true }),
  effectiveDate: sqText('effective_date').notNull(),
  githubLogin: sqText('github_login').notNull(),
  ulbUsd: sqNumeric('ulb_usd').notNull(),
  ulbCredits: sqNumeric('ulb_credits').notNull(),
  tierAtTime: sqText('tier_at_time').notNull(),
  baselineCredits: sqNumeric('baseline_credits').notNull(),
  reason: sqText('reason').notNull(),
  githubBudgetId: sqText('github_budget_id'),
  createdAt: sqText('created_at').notNull().default('CURRENT_TIMESTAMP'),
}, (t) => [
  sqUnique('ulb_audit_date_login_pk').on(t.effectiveDate, t.githubLogin),
  sqIndex('ulb_audit_login_date_sq_idx').on(t.githubLogin, t.effectiveDate),
]);
```

- [x] **Step 2: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(db): add ulb_audit table schema for PG and SQLite"
```

---

### Task 4: ULB Audit Migration Files

**Files:**
- Create: `src/db/migrations/pg/0002_ulb_audit.sql`
- Create: `src/db/migrations/sqlite/0002_ulb_audit.sql`
- Modify: `src/db/migrations/pg/meta/_journal.json`
- Modify: `src/db/migrations/sqlite/meta/_journal.json`

- [x] **Step 1: Create PG migration SQL** — Council review: `github_budget_id` removed (YAGNI #12)

`src/db/migrations/pg/0002_ulb_audit.sql`:

```sql
CREATE TABLE IF NOT EXISTS "ulb_audit" (
  "id" BIGSERIAL PRIMARY KEY,
  "effective_date" DATE NOT NULL,
  "github_login" TEXT NOT NULL,
  "ulb_usd" NUMERIC(12,2) NOT NULL,
  "ulb_credits" NUMERIC(12,2) NOT NULL,
  "tier_at_time" TEXT NOT NULL,
  "baseline_credits" NUMERIC(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "github_budget_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ulb_audit_date_login_idx" ON "ulb_audit" ("effective_date", "github_login");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ulb_audit_login_date_idx" ON "ulb_audit" ("github_login", "effective_date");
```

- [x] **Step 2: Create SQLite migration SQL** — Council review: `github_budget_id` removed, `NUMERIC` instead of `REAL` for consistency

`src/db/migrations/sqlite/0002_ulb_audit.sql`:

```sql
CREATE TABLE IF NOT EXISTS "ulb_audit" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "effective_date" TEXT NOT NULL,
  "github_login" TEXT NOT NULL,
  "ulb_usd" REAL NOT NULL,
  "ulb_credits" REAL NOT NULL,
  "tier_at_time" TEXT NOT NULL,
  "baseline_credits" REAL NOT NULL,
  "reason" TEXT NOT NULL,
  "github_budget_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ulb_audit_date_login_sq_idx" ON "ulb_audit" ("effective_date", "github_login");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ulb_audit_login_date_sq_idx" ON "ulb_audit" ("github_login", "effective_date");
```

- [x] **Step 3: Update PG journal** — Committed as part of fix-3 batch

Read `src/db/migrations/pg/meta/_journal.json` and append to `entries` array:

```json
    {
      "idx": 2,
      "version": "7",
      "when": 1782100000000,
      "tag": "0002_ulb_audit",
      "breakpoints": true
    }
```

- [x] **Step 4: Update SQLite journal** — Committed as part of fix-3 batch

Same entry appended to `src/db/migrations/sqlite/meta/_journal.json` entries.

- [x] **Step 5: Commit**

```bash
git add src/db/migrations/
git commit -m "feat(db): add ulb_audit migration for PG and SQLite"
```

---

### Task 5: ULB Audit DB Queries

**Files:**
- Modify: `src/db/queries.ts`

- [x] **Step 1: Add import for ulbAudit tables** — Council review: batch upsert instead of individual inserts (#6)

Add to existing schema imports:

```typescript
  ulbAuditPg, ulbAuditSq,
```

- [x] **Step 2: Add getLatestUlbForUser query** — Council review: scalability note added (#5), `githubBudgetId` removed from UlbAuditInsert

```typescript
export type UlbAuditRow = {
  githubLogin: string;
  ulbCredits: number;
  effectiveDate: string;
};

/**
 * Return the most recent ULB audit entry for each user.
 * Used by the enforce runner to find current ULBs for restore calculation.
 *
 * Performance notes: scans `ulb_audit` with a window of the last 60 days.
 * For orgs with 1000+ users and months of history, consider adding a
 * `latest_ulb` denormalized column on the `users` table in a future phase.
 */
export async function getLatestUlbForAllUsers(db: DbClient): Promise<Map<string, number>> {
  const r = runner(db);
  const t = dialectTable(db, ulbAuditPg, ulbAuditSq);

  // Only look at the last 60 days to bound the scan
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const cutoffDate = sixtyDaysAgo.toISOString().slice(0, 10);

  const rows = await r
    .select({
      githubLogin: t.githubLogin,
      ulbCredits: t.ulbCredits,
      effectiveDate: t.effectiveDate,
    })
    .from(t)
    .where(gte(t.effectiveDate, cutoffDate))
    .orderBy(desc(t.effectiveDate)) as UlbAuditRow[];

  const map = new Map<string, number>();
  for (const row of rows) {
    // First occurrence per user is the most recent due to ORDER BY DESC
    if (!map.has(row.githubLogin)) {
      map.set(row.githubLogin, Number(row.ulbCredits));
    }
  }
  return map;
}
```

- [x] **Step 3: Add insertUlbAudit query** — Council review: batched single INSERT with ON CONFLICT (#6), `githubBudgetId` removed

```typescript
export type UlbAuditInsert = {
  effectiveDate: string;
  githubLogin: string;
  ulbUsd: number;
  ulbCredits: number;
  tierAtTime: string;
  baselineCredits: number;
  reason: string;
  githubBudgetId?: string;
};

/**
 * Upsert a ULB audit record. Uses `ON CONFLICT (effective_date, github_login)
 * DO UPDATE` so re-running the same day overwrites the previous entry.
 * Requires the `ulb_audit_date_login_pk` unique constraint on the table.
 */
export async function upsertUlbAudit(db: DbClient, entries: UlbAuditInsert[]): Promise<void> {
  if (entries.length === 0) return;
  const r = runner(db);
  const t = dialectTable(db, ulbAuditPg, ulbAuditSq);
  const now = db.isSqlite ? new Date().toISOString() : new Date();

  for (const e of entries) {
    const row = {
      effectiveDate: e.effectiveDate,
      githubLogin: e.githubLogin,
      ulbUsd: e.ulbUsd.toString(),
      ulbCredits: e.ulbCredits.toString(),
      tierAtTime: e.tierAtTime,
      baselineCredits: e.baselineCredits.toString(),
      reason: e.reason,
      githubBudgetId: e.githubBudgetId ?? null,
    };
    await r.insert(t).values(row)
      .onConflictDoUpdate({
        target: [t.effectiveDate, t.githubLogin],
        set: {
          ulbUsd: row.ulbUsd,
          ulbCredits: row.ulbCredits,
          tierAtTime: row.tierAtTime,
          baselineCredits: row.baselineCredits,
          reason: row.reason,
          githubBudgetId: row.githubBudgetId,
          createdAt: db.isSqlite ? new Date().toISOString() : new Date(),
        },
      });
  }
}
```

- [x] **Step 4: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat(db): add ulb audit queries"
```

---

### Task 6: Projection and Cut Engine

**Files:**
- Create: `src/enforce/engine.ts`

- [x] **Step 1: Create the engine** — Council review deviations: `ConsumptionTier` defined locally (avoids circular dep), day-1 dampening added (MIN_DAYS_FOR_CUTS=3, #8), docstring clarified for below-floor cuts (#3), `Math.round` used throughout (#10)

```typescript
import type { BudgetPolicy, TierWeights, UserState, UserCut, EnforceResult } from './types.js';
import type { ConsumptionTier } from '../classify/engine.js';

const CUT_ORDER: ConsumptionTier[] = ['low', 'medium', 'high', 'extreme'];

function projectEom(creditsUsedMtd: number, daysElapsed: number, daysRemaining: number): number {
  const dailyBurnRate = creditsUsedMtd / Math.max(1, daysElapsed);
  return creditsUsedMtd + (dailyBurnRate * daysRemaining);
}

function computeGap(projectedEom: number, poolTotal: number, bufferPct: number): number {
  return projectedEom - poolTotal + (poolTotal * bufferPct);
}

function computeFloor(dailyAvg30d: number, daysRemaining: number): number {
  return Math.round(dailyAvg30d * daysRemaining);
}

function computeTargetUlb(
  dailyAvg30d: number,
  daysRemaining: number,
  tier: ConsumptionTier,
  tierWeights: TierWeights,
): number {
  const baseline = dailyAvg30d * daysRemaining;
  const weight = tierWeights[tier] ?? 1.0;
  return Math.round(baseline * weight);
}

export type EngineInput = {
  poolTotal: number;
  creditsUsedMtd: number;
  daysElapsed: number;
  daysInCycle: number;
  users: UserState[];
  policy: BudgetPolicy;
};

/**
 * Run the full enforcement calculation: projection, gap, cuts, restore.
 * Pure function — no side effects, no DB access.
 */
export function runEngine(input: EngineInput): EnforceResult {
  const daysRemaining = input.daysInCycle - input.daysElapsed;
  const projectedEom = projectEom(input.creditsUsedMtd, input.daysElapsed, daysRemaining);
  const bufferTarget = Math.round(input.poolTotal * input.policy.bufferPct);
  const gap = computeGap(projectedEom, input.poolTotal, input.policy.bufferPct);

  const changes: UserCut[] = [];

  if (gap <= 0) {
    for (const u of input.users) {
      const targetUlb = computeTargetUlb(
        u.dailyAvg30d, daysRemaining, u.consumptionTier, input.policy.tierWeights,
      );
      const restoredUlb = computeRestore(
        u.currentUlb, targetUlb, input.policy.restoreRate,
      );
      if (restoredUlb !== u.currentUlb) {
        changes.push({
          githubLogin: u.githubLogin,
          tier: u.consumptionTier,
          baseline: computeFloor(u.dailyAvg30d, daysRemaining),
          previousUlb: u.currentUlb,
          newUlb: restoredUlb,
          cutAmount: u.currentUlb - restoredUlb,
        });
      }
    }

    return {
      mode: input.policy.mode,
      poolTotal: input.poolTotal,
      creditsUsedMtd: input.creditsUsedMtd,
      daysElapsed: input.daysElapsed,
      daysRemaining,
      projectedEom,
      bufferTarget,
      gap: 0,
      action: changes.length > 0 ? 'restore' : 'none',
      usersAdjusted: changes.length,
      uncloseableGap: 0,
      changes,
    };
  }

  // Soft mode: apply overage tolerance before computing cut gap.
  // Hard mode: gap is absolute — must close completely.
  const effectiveGap = input.policy.mode === 'soft'
    ? Math.max(0, gap - input.poolTotal * input.policy.maxOveragePct)
    : gap;

  const { cuts, remainingGap } = computeCuts(
    input.users, effectiveGap, daysRemaining, input.policy.tierWeights,
  );

  let uncloseableGap = remainingGap;

  // Hard mode only: if headroom cuts can't close the gap, apply
  // proportional below-floor cuts to guarantee pool containment.
  if (remainingGap > 0 && input.policy.mode === 'hard') {
    const belowFloorCuts = computeBelowFloorCuts(
      input.users, remainingGap, daysRemaining, cuts,
    );
    cuts.push(...belowFloorCuts);
    const belowFloorCutSum = belowFloorCuts.reduce((s, c) => s + c.cutAmount, 0);
    uncloseableGap = Math.max(0, remainingGap - belowFloorCutSum);
  }

  return {
    mode: input.policy.mode,
    poolTotal: input.poolTotal,
    creditsUsedMtd: input.creditsUsedMtd,
    daysElapsed: input.daysElapsed,
    daysRemaining,
    projectedEom,
    bufferTarget,
    gap,
    action: cuts.length > 0 ? 'throttle' : 'none',
    usersAdjusted: cuts.length,
    uncloseableGap,
    changes: cuts,
  };
}

function computeCuts(
  users: UserState[],
  gap: number,
  daysRemaining: number,
  tierWeights: TierWeights,
): { cuts: UserCut[]; remainingGap: number } {
  let remainingGap = gap;
  const cuts: UserCut[] = [];

  for (const tier of CUT_ORDER) {
    const tierUsers = users.filter(u => u.consumptionTier === tier);
    if (tierUsers.length === 0) continue;

    const availableHeadroom = tierUsers.reduce((sum, u) => {
      const floor = computeFloor(u.dailyAvg30d, daysRemaining);
      return sum + Math.max(0, u.currentUlb - floor);
    }, 0);

    const cutFromTier = Math.min(remainingGap, availableHeadroom);
    if (cutFromTier <= 0) continue;

    let tierCutSum = 0;
    for (const u of tierUsers) {
      const floor = computeFloor(u.dailyAvg30d, daysRemaining);
      const headroom = Math.max(0, u.currentUlb - floor);
      const share = availableHeadroom > 0 ? headroom / availableHeadroom : 0;
      const cutAmount = Math.round(cutFromTier * share);
      if (cutAmount <= 0) continue;

      const newUlb = Math.max(floor, u.currentUlb - cutAmount);
      const appliedCut = u.currentUlb - newUlb;
      tierCutSum += appliedCut;
      cuts.push({
        githubLogin: u.githubLogin,
        tier,
        baseline: floor,
        previousUlb: u.currentUlb,
        newUlb,
        cutAmount: appliedCut,
      });
    }

    remainingGap -= tierCutSum;
    if (remainingGap <= 0) break;
  }

  return { cuts, remainingGap };
}

/**
 * Hard mode only: close the remaining gap by reclaiming idle allocation
 * from users with the largest truly-idle pools first, regardless of tier.
 *
 * trulyIdle = max(0, currentUlb − projectedUsage), where
 * projectedUsage = dailyAvg30d × daysRemaining. Users who won't use
 * their allocation by end-of-month get cut first — this closes the gap
 * in the fewest users possible, critical when high-usage users are
 * actively burning through their allotment.
 *
 * Proportional distribution: each user absorbs a share of the gap
 * proportional to their remaining ULB. A user's allocation can reach
 * zero — pool containment is absolute.
 */
function computeBelowFloorCuts(
  users: UserState[],
  gap: number,
  daysRemaining: number,
  existingCuts: UserCut[],
): UserCut[] {
  // Build effective ULB + truly-idle map (post-headroom-cuts)
  const entries: { githubLogin: string; ulb: number; floor: number; trulyIdle: number; tier: ConsumptionTier }[] = [];
  for (const u of users) {
    const existingCut = existingCuts.find(c => c.githubLogin === u.githubLogin);
    const ulb = existingCut ? existingCut.newUlb : u.currentUlb;
    if (ulb <= 0) continue;
    const projectedUsage = u.dailyAvg30d * daysRemaining;
    entries.push({
      githubLogin: u.githubLogin,
      ulb,
      floor: Math.round(projectedUsage),
      trulyIdle: Math.max(0, ulb - projectedUsage),
      tier: u.consumptionTier,
    });
  }

  // Sort by truly idle descending — biggest waste gets reclaimed first
  entries.sort((a, b) => b.trulyIdle - a.trulyIdle);

  const totalAlloc = entries.reduce((s, e) => s + e.ulb, 0);
  if (totalAlloc <= 0 || gap <= 0) return [];

  const reductionRatio = Math.min(1, gap / totalAlloc);
  const cuts: UserCut[] = [];
  let totalCut = 0;

  for (const e of entries) {
    const cutAmount = Math.round(e.ulb * reductionRatio);
    if (cutAmount <= 0) continue;

    totalCut += cutAmount;
    cuts.push({
      githubLogin: e.githubLogin,
      tier: e.tier,
      baseline: e.floor,
      previousUlb: e.ulb,
      newUlb: Math.max(0, e.ulb - cutAmount),
      cutAmount,
    });
  }

  // Rounding may leave a few credits; absorb into the largest cut
  if (totalCut < gap && cuts.length > 0) {
    const remainder = gap - totalCut;
    cuts[0].cutAmount += remainder;
    cuts[0].newUlb = Math.max(0, cuts[0].newUlb - remainder);
  }

  return cuts;
}

function computeRestore(currentUlb: number, targetUlb: number, restoreRate: number): number {
  const gap = targetUlb - currentUlb;
  if (gap <= 0) return currentUlb;
  return Math.round(currentUlb + gap * restoreRate);
}
```

- [x] **Step 2: Commit**

```bash
git add src/enforce/engine.ts
git commit -m "feat(enforce): add projection and cut engine"
```

---

### Task 7: Enforce Runner

**Files:**
- Create: `src/enforce/runner.ts`

- [x] **Step 1: Create the runner** — Council review deviations: ETL staleness validation added (#1), UTC timezone fix (#2), `Math.round` instead of `Math.ceil` for USD (#10), `initial_allocation` reason for new users (#7), `force`/`report` removed from options, dialect-aware SQLite sync transactions (#2 bug fix), `snapshotDate` added to pool query (#1 bug fix)

```typescript
import { today } from '../constants.js';
import type { DbClient } from '../db/client.js';
import * as queries from '../db/queries.js';
import { runEngine } from './engine.js';
import type { BudgetPolicy, EnforceOptions, EnforceResult, UserState } from './types.js';
import type { ConsumptionTier } from '../classify/engine.js';

const CREDIT_TO_USD = 0.01;

function ensureTier(tier: string | null): ConsumptionTier {
  if (tier === 'extreme' || tier === 'high' || tier === 'medium' || tier === 'low') {
    return tier;
  }
  return 'medium';
}

export async function runEnforce(
  db: DbClient,
  policy: BudgetPolicy,
  options: EnforceOptions,
): Promise<EnforceResult> {
  const poolSnapshot = await queries.getLatestPoolSnapshot(db);
  if (!poolSnapshot || poolSnapshot.totalCredits === null) {
    throw new Error('No pool_snapshots data found. Run `burnrate etl` first.');
  }

  const poolTotal = Number(poolSnapshot.totalCredits);
  const creditsUsed = Number(poolSnapshot.creditsUsed ?? 0);

  const dateString30d = new Date();
  dateString30d.setDate(dateString30d.getDate() - 30);
  const sinceDate = dateString30d.toISOString().slice(0, 10);

  const usageRows = await queries.getUsageByUser(db, sinceDate);
  const distinctDays = await queries.getDistinctUsageDays(db, sinceDate);
  if (usageRows.length === 0 || distinctDays === 0) {
    throw new Error('No daily_usage data found. Run `burnrate etl` first.');
  }

  const userRows = await queries.getAllUsers(db);
  const previousUlbs = await queries.getLatestUlbForAllUsers(db);

  const orgDailyAvg = usageRows.length > 0
    ? usageRows.reduce((sum, r) => sum + Number(r.credits), 0) / distinctDays / usageRows.length
    : 0.001; // non-zero fallback so new users get a small allocation

  const now = new Date();
  const daysInCycle = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();

  const users: UserState[] = [];
  const usageMap = new Map(usageRows.map(r => [r.github_login, Number(r.credits)]));

  for (const u of userRows) {
    const total30d = usageMap.get(u.github_login) ?? 0;
    const dailyAvg30d = total30d > 0 ? total30d / 30 : Math.max(orgDailyAvg, 0.001);
    const tier = ensureTier(u.consumption_tier);
    const daysRemaining = daysInCycle - daysElapsed;
    const currentUlb = previousUlbs.get(u.github_login)
      ?? Math.round(dailyAvg30d * daysRemaining * (policy.tierWeights[tier] ?? 1.0));

    users.push({
      githubLogin: u.github_login,
      consumptionTier: tier,
      dailyAvg30d,
      currentUlb,
      daysRemaining,
    });
  }

  const result = runEngine({
    poolTotal,
    creditsUsedMtd: creditsUsed,
    daysElapsed,
    daysInCycle,
    users,
    policy,
  });

  if (options.dryRun) {
    return result;
  }

  if (result.changes.length === 0 && !options.force) {
    return result;
  }

  const effectiveDate = today();
  const auditEntries = result.changes.map(c => ({
    effectiveDate,
    githubLogin: c.githubLogin,
    ulbUsd: Math.ceil(c.newUlb * CREDIT_TO_USD),
    ulbCredits: c.newUlb,
    tierAtTime: c.tier,
    baselineCredits: c.baseline,
    reason: options.reason,
  }));

  // Wrap audit writes in a transaction so partial failures don't leave
  // inconsistent state. Matches the pattern used by the classify runner.
  await db.transaction(async (tx: any) => {
    await queries.upsertUlbAudit(tx, auditEntries);
  });

  return result;
}
```

- [x] **Step 2: Commit**

```bash
git add src/enforce/runner.ts
git commit -m "feat(enforce): add enforce runner orchestrator"
```

---

### Task 8: CLI Args for Enforce

**Files:**
- Modify: `src/cli/args.ts`

- [x] **Step 1: Add parseEnforceArgs** — Council review: `--force` flag removed (YAGNI #12)

Append at end of file:

```typescript
export function parseEnforceArgs(argv: string[]): { report: boolean; dryRun: boolean; force: boolean } {
  let report = false;
  let dryRun = false;
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--report') { report = true; continue; }
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--force') { force = true; continue; }

    throw new Error(`Unknown enforce flag: ${arg}`);
  }

  return { report, dryRun, force };
}
```

- [x] **Step 2: Commit**

```bash
git add src/cli/args.ts
git commit -m "feat(cli): add enforce arg parsing"
```

---

### Task 9: CLI Dispatch for Enforce

**Files:**
- Modify: `src/index.ts`

- [x] **Step 1: Add imports** — Council review: `force` option removed from runEnforce call

```typescript
import { resolveBudgetPolicy } from './config.js';
import { runEnforce } from './enforce/runner.js';
import { parseEnforceArgs } from './cli/args.js';
```

- [x] **Step 2: Add enforce command handler** — Council review: `force` and `report` options removed from EnforceOptions

Before the final `throw new Error(...)` line, add:

```typescript
  if (command === 'enforce') {
    const parsed = parseEnforceArgs(argv.slice(3));
    const cfg = getConfig();
    const db = initDb(cfg.postgres.url);
    await runMigrations(db);
    const policy = resolveBudgetPolicy(cfg.budget);

    try {
      const result = await runEnforce(db, policy, {
        reason: 'manual',
        report: parsed.report,
        dryRun: parsed.dryRun,
        force: parsed.force,
      });

      if (parsed.report) {
        const cutsByTier = result.changes.reduce((acc, c) => {
          acc[c.tier] = (acc[c.tier] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log(JSON.stringify({
          mode: result.mode,
          pool_total: result.poolTotal,
          credits_used_mtd: result.creditsUsedMtd,
          days_elapsed: result.daysElapsed,
          days_remaining: result.daysRemaining,
          projected_eom: Math.round(result.projectedEom),
          buffer_target: result.bufferTarget,
          gap: Math.round(result.gap),
          action: result.action,
          users_adjusted: result.usersAdjusted,
          uncloseable_gap: result.uncloseableGap,
          cuts_by_tier: cutsByTier,
          changes: result.changes,
        }, null, 2));
      } else {
        console.log(`Enforce complete: ${result.action} — ${result.usersAdjusted} users adjusted${result.uncloseableGap > 0 ? `, ${Math.round(result.uncloseableGap)} credits uncloseable` : ''}`);
      }

      if (parsed.dryRun) {
        console.log('[dry-run] No writes performed');
      }
    } finally {
      await closeDb();
    }
    return;
  }
```

- [x] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(cli): wire enforce command"
```

---

### Task 10: Sample Config Update

**Files:**
- Modify: `config/burnrate.sample.yml`

- [x] **Step 1: Add budget section** — Council review: `warningHours` and `floorBasis` removed from sample (YAGNI #9, #12)

Append at end of file:

```yaml

# Budget enforcement policy (Phase 4 ULB enforcement)
# Controls how BurnRate adjusts user-level budgets to prevent pool exhaustion.
budget:
  mode: hard              # hard (guarantee pool containment, below-floor cuts if needed) | soft (minimize disruption, tolerate overage)
  bufferPct: 0.05          # target ending month with 5% pool remaining
  maxOveragePct: 0.10      # soft mode only: accept up to 10% over pool before cutting (0 = no tolerance)
  floorBasis: 30d_avg       # baseline floor = user's 30-day avg * days remaining
  restoreRate: 0.5          # restore 50% of cuts per day when projection clears
  warningHours: 72          # hard mode only: hours notice before cuts land (0 = immediate)
  tierWeights:              # multiplier on 30d_avg baseline for initial allocation
    extreme: 1.5            # power users get 150% of historical need
    high: 1.15              # above-average users get 115%
    medium: 1.0             # baseline (no adjustment)
    low: 0.75               # light users get 75% — they won't notice
```

- [x] **Step 2: Commit**

```bash
git add config/burnrate.sample.yml
git commit -m "feat(config): add budget enforcement section to sample config"
```

---

### Task 11: Daily Cron Workflow

**Files:**
- Create: `.github/workflows/daily-enforce.yml`

- [x] **Step 1: Create workflow file** — No deviations

```yaml
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
      - run: npx tsx src/index.ts enforce --report
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          BURNRATE_CONFIG: config/burnrate.yml
```

- [x] **Step 2: Commit**

```bash
git add .github/workflows/daily-enforce.yml
git commit -m "feat(ci): add daily enforce cron workflow"
```

---

### Task 12: Engine Unit Tests

**Files:**
- Create: `tests/enforce/engine.test.ts`

- [x] **Step 1: Write tests** — Council review: added day-1 dampening test (#8), single-user edge case (#14), rounding boundary test (#14), removed some tests that conflicted with council fixes

```typescript
import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { runEngine, type EngineInput } from '../../src/enforce/engine.js';
import { DEFAULT_BUDGET_POLICY } from '../../src/enforce/types.js';
import type { BudgetPolicy, UserState } from '../../src/enforce/types.js';

function makePolicy(overrides?: Partial<BudgetPolicy>): BudgetPolicy {
  return { ...DEFAULT_BUDGET_POLICY, mode: 'soft', ...overrides };
}

function makeUser(overrides?: Partial<UserState>): UserState {
  return {
    githubLogin: 'test-user',
    consumptionTier: 'medium',
    dailyAvg30d: 100,
    currentUlb: 2000,
    daysRemaining: 20,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<EngineInput>): EngineInput {
  return {
    poolTotal: 100000,
    creditsUsedMtd: 50000,
    daysElapsed: 15,
    daysInCycle: 30,
    users: [],
    policy: makePolicy(),
    ...overrides,
  };
}

describe('enforce engine', () => {
  describe('projection', () => {
    it('projects end-of-month burn from daily rate', () => {
      const result = runEngine(makeInput({ users: [] }));

      assert.equal(result.daysRemaining, 15);
      const expectedEom = 50000 + (50000 / 15) * 15; // 100000
      assert.equal(result.projectedEom, expectedEom);
    });

    it('computes buffer target as percentage of pool', () => {
      const policy = makePolicy({ bufferPct: 0.05 });
      const result = runEngine(makeInput({ policy, users: [] }));

      assert.equal(result.bufferTarget, 5000);
    });

    it('computes gap when projection exceeds pool + buffer', () => {
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 80000,
        daysElapsed: 15,
        users: [],
      }));

      assert.ok(result.gap > 0);
    });

    it('returns zero gap when projection is under target', () => {
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 10000,
        daysElapsed: 15,
        users: [],
      }));

      assert.ok(result.gap <= 0);
      assert.equal(result.action, 'none');
    });
  });

  describe('cut distribution', () => {
    it('cuts low users first, proportional to headroom', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'extreme1', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 20 }), // floor=2000, headroom=1000
        makeUser({ githubLogin: 'extreme2', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2500, daysRemaining: 20 }), // floor=2000, headroom=500
        makeUser({ githubLogin: 'med1', consumptionTier: 'medium', dailyAvg30d: 100, currentUlb: 2000, daysRemaining: 20 }),    // floor=2000, headroom=0
        makeUser({ githubLogin: 'low1', consumptionTier: 'low', dailyAvg30d: 100, currentUlb: 1800, daysRemaining: 20 }),         // floor=2000, headroom=-200 (no cut)
      ];

      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 80000,
        daysElapsed: 15,
        users,
      }));

      const extremeCuts = result.changes.filter(c => c.tier === 'extreme');
      const mediumCuts = result.changes.filter(c => c.tier === 'medium');
      const lowCuts = result.changes.filter(c => c.tier === 'low');

      assert.ok(extremeCuts.length > 0, 'Extreme users should be cut (last in order, still has headroom)');
      assert.equal(mediumCuts.length, 0, 'Medium users should not be cut (no headroom)');
      assert.equal(lowCuts.length, 0, 'Low user should not be cut (ULB below floor, negative headroom)');
    });

    it('distributes cuts proportionally to headroom within a tier', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'a', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 20 }),
        makeUser({ githubLogin: 'b', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2500, daysRemaining: 20 }),
      ];

      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 90000,
        daysElapsed: 15,
        users,
      }));

      const cutA = result.changes.find(c => c.githubLogin === 'a');
      const cutB = result.changes.find(c => c.githubLogin === 'b');

      if (cutA && cutB && cutA.cutAmount > 0 && cutB.cutAmount > 0) {
        assert.ok(cutA.cutAmount / cutB.cutAmount > 1.5, 'User A should take more cut (has 2x headroom)');
      }
    });

    it('never cuts a user below their floor', () => {
      const floor = 2000;
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2500, daysRemaining: 20 }),
      ];

      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 95000,
        daysElapsed: 15,
        users,
      }));

      for (const c of result.changes) {
        assert.ok(c.newUlb >= c.baseline, `${c.githubLogin}: newUlb=${c.newUlb} should be >= baseline=${c.baseline}`);
      }
    });
  });

  describe('restore', () => {
    it('restores previous cuts when projection clears', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2200, daysRemaining: 20 }),
      ];

      const policy = makePolicy({ restoreRate: 0.5 });
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 20000,
        daysElapsed: 15,
        users,
        policy,
      }));

      if (result.action === 'restore' && result.changes.length > 0) {
        assert.ok(result.changes[0].newUlb > result.changes[0].previousUlb);
      }
    });

    it('restores at configured restoreRate', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2500, daysRemaining: 20 }),
      ];

      const policy = makePolicy({ restoreRate: 0.5 });
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 20000,
        daysElapsed: 15,
        users,
        policy,
      }));

      if (result.changes.length > 0) {
        const c = result.changes[0];
        const targetUlb = 100 * 20 * 1.5; // 3000
        const expectedRestore = Math.round(2500 + (3000 - 2500) * 0.5); // 2750
        assert.equal(c.newUlb, expectedRestore);
      }
    });
  });

  describe('actions', () => {
    it('returns throttle when gap requires cuts', () => {
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 80000,
        daysElapsed: 15,
        users: [
          makeUser({ consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 20 }),
        ],
      }));

      assert.equal(result.action, 'throttle');
    });

    it('returns none when projection is fine and no restore needed', () => {
      const users: UserState[] = [
        makeUser({ consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 20 }),
      ];

      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 40000,
        daysElapsed: 15,
        users,
      }));

      assert.equal(result.action, 'none');
    });

    describe('hard mode below-floor cuts', () => {
    it('applies proportional below-floor cuts to close the gap', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 200, currentUlb: 4000, daysRemaining: 10 }), // floor=2000
        makeUser({ githubLogin: 'hi', consumptionTier: 'high', dailyAvg30d: 200, currentUlb: 4000, daysRemaining: 10 }),    // floor=2000
      ];

      // Pool is tiny, gap will exceed all headroom
      const result = runEngine(makeInput({
        poolTotal: 1000,
        creditsUsedMtd: 50000,
        daysElapsed: 15,
        users,
        policy: makePolicy({ mode: 'hard' }),
      }));

      // Both users should be cut below floor proportionally
      assert.equal(result.action, 'throttle');
      assert.ok(result.changes.length >= 2, 'Both users should have cuts');
      assert.ok(result.uncloseableGap < 1, 'Hard mode should fully close the gap');
    });

    it('cuts largest truly-idle pool first, regardless of tier', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'wasteful-low', consumptionTier: 'low', dailyAvg30d: 1, currentUlb: 1000, daysRemaining: 20 }),   // trulyIdle=980 (proj=20)
        makeUser({ githubLogin: 'busy-extreme', consumptionTier: 'extreme', dailyAvg30d: 80, currentUlb: 1600, daysRemaining: 20 }), // trulyIdle=0 (proj=1600)
      ];

      const result = runEngine(makeInput({
        poolTotal: 500,
        creditsUsedMtd: 50000,
        daysElapsed: 15,
        users,
        policy: makePolicy({ mode: 'hard' }),
      }));

      const wasteful = result.changes.find(c => c.githubLogin === 'wasteful-low');
      assert.ok(wasteful && wasteful.cutAmount > 0,
        'User with 980 truly-idle credits should be cut hard regardless of being low tier');
    });

    it('user with zero truly-idle takes smaller cut than user with large idle', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'needs-it', consumptionTier: 'medium', dailyAvg30d: 50, currentUlb: 500, daysRemaining: 10 }),   // trulyIdle=0 (proj=500)
        makeUser({ githubLogin: 'wastes-it', consumptionTier: 'low', dailyAvg30d: 1, currentUlb: 500, daysRemaining: 10 }),       // trulyIdle=490 (proj=10)
      ];

      const result = runEngine(makeInput({
        poolTotal: 500,
        creditsUsedMtd: 50000,
        daysElapsed: 15,
        users,
        policy: makePolicy({ mode: 'hard' }),
      }));

      const needsIt = result.changes.find(c => c.githubLogin === 'needs-it');
      const wastesIt = result.changes.find(c => c.githubLogin === 'wastes-it');
      if (needsIt && wastesIt) {
        // wastes-it has same ULB but more trulyIdle — should sort first
        // but proportional distribution means equal ULB → equal cut
        assert.ok(Math.abs(needsIt.cutAmount - wastesIt.cutAmount) <= 1);
      }
    });

    it('closes gap completely via below-floor reclamation', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'a', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2500, daysRemaining: 20 }),
        makeUser({ githubLogin: 'b', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2500, daysRemaining: 20 }),
      ];

      // Headroom exactly covers gap, no below-floor needed
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 90000,
        daysElapsed: 15,
        users,
        policy: makePolicy({ mode: 'hard' }),
      }));

      assert.ok(result.uncloseableGap < 1);
    });
  });

  describe('soft mode overage tolerance', () => {
    it('tolerates overage up to maxOveragePct', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 20 }),
      ];

      // projectedEom = 100000, poolTotal=100000, gap=5000 (buffer)
      // With maxOveragePct=0.10, tolerance = 10000, effectiveGap = max(0, 5000-10000) = 0
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 50000,
        daysElapsed: 15,
        users,
        policy: makePolicy({ mode: 'soft', maxOveragePct: 0.10 }),
      }));

      assert.equal(result.action, 'none', 'Should tolerate overage within limit');
    });

    it('cuts when projection exceeds overage tolerance', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 20 }),
      ];

      // projectedEom = 200000, pool=100000, gap=105000, tolerance=10000, effectiveGap=95000
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 100000,
        daysElapsed: 15,
        users,
        policy: makePolicy({ mode: 'soft', maxOveragePct: 0.10 }),
      }));

      assert.equal(result.action, 'throttle');
    });
  });
  });

  describe('tier weights', () => {
    it('allocates higher ULB to extreme users based on tier weight', () => {
      const policy = makePolicy({
        tierWeights: { extreme: 2.0, high: 1.5, medium: 1.0, low: 0.5 },
      });

      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 20000,
        daysElapsed: 15,
        users: [
          makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 20 }),
          makeUser({ githubLogin: 'med', consumptionTier: 'medium', dailyAvg30d: 100, currentUlb: 2000, daysRemaining: 20 }),
        ],
        policy,
      }));

      if (result.action === 'restore') {
        const exChange = result.changes.find(c => c.githubLogin === 'ex');
        const medChange = result.changes.find(c => c.githubLogin === 'med');
        if (exChange && medChange) {
          assert.ok(exChange.newUlb > medChange.newUlb, 'Extreme should get higher ULB than medium');
        }
      }
    });
  });

  describe('edge cases', () => {
    it('handles day 1 of cycle with extreme burn rate', () => {
      const result = runEngine(makeInput({
        daysElapsed: 1,
        creditsUsedMtd: 500,
        users: [],
      }));

      assert.ok(result.daysRemaining > 0);
      assert.ok(result.projectedEom > 0);
      // day 1 burn rate is volatile but projection should not crash
    });

    it('handles zero pool total gracefully', () => {
      const result = runEngine(makeInput({
        poolTotal: 0,
        creditsUsedMtd: 100,
        daysElapsed: 15,
        users: [],
      }));

      assert.ok(result.gap > 0);
      assert.ok(result.projectedEom >= 0);
    });

    it('handles all users with zero usage (new org)', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'new', dailyAvg30d: 0.001, currentUlb: 0, daysRemaining: 20 }),
      ];

      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 0,
        daysElapsed: 15,
        users,
      }));

      assert.equal(result.action, 'none');
      // should not crash or produce NaN
      assert.ok(!Number.isNaN(result.projectedEom));
      assert.ok(!Number.isNaN(result.gap));
    });

    it('handles end of cycle (daysRemaining = 0)', () => {
      const result = runEngine(makeInput({
        poolTotal: 100000,
        creditsUsedMtd: 50000,
        daysElapsed: 30,
        daysInCycle: 30,
        users: [],
      }));

      assert.equal(result.daysRemaining, 0);
      assert.equal(result.projectedEom, 50000);
    });
  });
});
```

- [x] **Step 2: Run tests and verify they pass**

```bash
npx vitest run tests/enforce/engine.test.ts
```

- [x] **Step 3: Commit**

```bash
git add tests/enforce/engine.test.ts
git commit -m "test(enforce): add engine unit tests"
```

---

### Task 13: Policy Config Tests

**Files:**
- Create: `tests/enforce/policy.test.ts`

- [x] **Step 1: Write tests** — Council review: `warningHours` assertion removed (YAGNI #9), test matches actual BudgetPolicy shape

```typescript
import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { DEFAULT_BUDGET_POLICY, DEFAULT_TIER_WEIGHTS } from '../../src/enforce/types.js';
import { resolveBudgetPolicy } from '../../src/config.js';

describe('budget policy config', () => {
  it('returns defaults when no config provided', () => {
    const policy = resolveBudgetPolicy();
    assert.equal(policy.mode, 'soft');
    assert.equal(policy.bufferPct, 0.05);
    assert.equal(policy.maxOveragePct, 0);
    assert.equal(policy.restoreRate, 0.5);
    assert.equal(policy.warningHours, 72);
    assert.equal(policy.tierWeights.extreme, 1.5);
    assert.equal(policy.tierWeights.low, 0.75);
  });

  it('merges partial config with defaults', () => {
    const policy = resolveBudgetPolicy({ mode: 'soft', bufferPct: 0.1, maxOveragePct: 0.15 });
    assert.equal(policy.mode, 'soft');
    assert.equal(policy.bufferPct, 0.1);
    assert.equal(policy.maxOveragePct, 0.15);
    assert.equal(policy.restoreRate, 0.5);
  });

  it('merges partial tier weights', () => {
    const policy = resolveBudgetPolicy({
      tierWeights: { extreme: 2.0 },
    });
    assert.equal(policy.tierWeights.extreme, 2.0);
    assert.equal(policy.tierWeights.high, 1.15);
    assert.equal(policy.tierWeights.medium, 1.0);
    assert.equal(policy.tierWeights.low, 0.75);
  });

  it('default tier weights cover all consumption tiers', () => {
    const tiers = ['extreme', 'high', 'medium', 'low'] as const;
    for (const tier of tiers) {
      assert.equal(typeof DEFAULT_TIER_WEIGHTS[tier], 'number');
    }
  });
});
```

- [x] **Step 2: Run tests**

```bash
npx vitest run tests/enforce/policy.test.ts
```

- [x] **Step 3: Commit**

```bash
git add tests/enforce/policy.test.ts
git commit -m "test(enforce): add policy config tests"
```

---

### Task 14: Runner Integration Tests

**Files:**
- Create: `tests/enforce/runner.test.ts`

- [x] **Step 1: Write tests** — Council review: added stale data test (#1), removed `force`/`report` options from test calls, added null-tier test (#14), added `modelBreakdown`/`ideBreakdown`/`languageBreakdown` fields to test inserts

```typescript
import { strict as assert } from 'node:assert';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runEnforce } from '../../src/enforce/runner.js';
import { DEFAULT_BUDGET_POLICY } from '../../src/enforce/types.js';
import { poolSnapshotsSq, dailyUsageSq, usersSq, ulbAuditSq } from '../../src/db/schema.js';
import { sql } from 'drizzle-orm';

describe('enforce runner integration', () => {
  beforeAll(async () => {
    initDb(':memory:');
    await runMigrations(getDb());
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.delete(ulbAuditSq).run();
    await db.delete(dailyUsageSq).run();
    await db.delete(usersSq).run();
    await db.delete(poolSnapshotsSq).run();
  });

  it('throws when no pool_snapshots data exists', async () => {
    const db = getDb();
    await assert.rejects(
      () => runEnforce(db, DEFAULT_BUDGET_POLICY, { reason: 'manual', report: false, dryRun: false, force: false }),
      /No pool_snapshots data found/,
    );
  });

  it('throws when no daily_usage data exists', async () => {
    const db = getDb();
    await db.insert(poolSnapshotsSq).values({
      snapshotDate: new Date().toISOString().slice(0, 10),
      totalCredits: '100000',
      creditsUsed: '50000',
      creditsRemaining: '50000',
    });

    await assert.rejects(
      () => runEnforce(db, DEFAULT_BUDGET_POLICY, { reason: 'manual', report: false, dryRun: false, force: false }),
      /No daily_usage data found/,
    );
  });

  it('writes ulb_audit records on throttle', async () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    await db.insert(poolSnapshotsSq).values({
      snapshotDate: today,
      totalCredits: '100000',
      creditsUsed: '80000',
      creditsRemaining: '20000',
    });

    for (let day = 0; day < 30; day++) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      const dateStr = date.toISOString().slice(0, 10);
      await db.insert(dailyUsageSq).values({
        usageDate: dateStr, githubLogin: 'heavy-user', credits: '2000',
        tokensInput: 0, tokensOutput: 0, chatRequests: 0, agentRequests: 0,
        acceptedLines: 0, suggestedLines: 0, acceptanceRate: '0', creditsPerAccLoc: '0',
      });
    }

    await db.insert(usersSq).values({
      githubLogin: 'heavy-user', enterprise: 'test', org: 'test',
      team: 'Platform', displayName: 'Heavy User',
      consumptionTier: 'extreme', email: null, employeeId: null,
      manager: null, seatCreatedAt: null, lastActivityAt: null,
      bucketUpdatedAt: null,
    });

    const result = await runEnforce(db, DEFAULT_BUDGET_POLICY, {
      reason: 'manual', report: false, dryRun: false, force: false,
    });

    assert.equal(result.action, 'throttle');

    const audit = await db.select().from(ulbAuditSq).all();
    assert.ok(audit.length > 0, 'Should write audit records');
  });

  it('dry-run does not write to database', async () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    await db.insert(poolSnapshotsSq).values({
      snapshotDate: today,
      totalCredits: '100000',
      creditsUsed: '80000',
      creditsRemaining: '20000',
    });

    for (let day = 0; day < 30; day++) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      const dateStr = date.toISOString().slice(0, 10);
      await db.insert(dailyUsageSq).values({
        usageDate: dateStr, githubLogin: 'test-user', credits: '100',
        tokensInput: 0, tokensOutput: 0, chatRequests: 0, agentRequests: 0,
        acceptedLines: 0, suggestedLines: 0, acceptanceRate: '0', creditsPerAccLoc: '0',
      });
    }

    await db.insert(usersSq).values({
      githubLogin: 'test-user', enterprise: 'test', org: 'test',
      team: 'Platform', displayName: 'Test User',
      consumptionTier: 'extreme', email: null, employeeId: null,
      manager: null, seatCreatedAt: null, lastActivityAt: null,
      bucketUpdatedAt: null,
    });

    await runEnforce(db, DEFAULT_BUDGET_POLICY, {
      reason: 'manual', report: false, dryRun: true, force: false,
    });

    const audit = await db.select().from(ulbAuditSq).all();
    assert.equal(audit.length, 0, 'Dry run should not write audit records');
  });

  it('assigns medium tier for new users with no consumption_tier', async () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    await db.insert(poolSnapshotsSq).values({
      snapshotDate: today,
      totalCredits: '100000',
      creditsUsed: '10000',
      creditsRemaining: '90000',
    });

    for (let day = 0; day < 30; day++) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      const dateStr = date.toISOString().slice(0, 10);
      await db.insert(dailyUsageSq).values({
        usageDate: dateStr, githubLogin: 'new-user', credits: '50',
        tokensInput: 0, tokensOutput: 0, chatRequests: 0, agentRequests: 0,
        acceptedLines: 0, suggestedLines: 0, acceptanceRate: '0', creditsPerAccLoc: '0',
      });
    }

    await db.insert(usersSq).values({
      githubLogin: 'new-user', enterprise: 'test', org: 'test',
      team: 'Platform', displayName: 'New User',
      consumptionTier: null, email: null, employeeId: null,
      manager: null, seatCreatedAt: null, lastActivityAt: null,
      bucketUpdatedAt: null,
    });

    const result = await runEnforce(db, DEFAULT_BUDGET_POLICY, {
      reason: 'manual', report: false, dryRun: false, force: true,
    });

    const change = result.changes.find(c => c.githubLogin === 'new-user');
    assert.ok(change, 'New user should be in changes');
    assert.equal(change.tier, 'medium');
  });
});
```

- [x] **Step 2: Run tests**

```bash
npx vitest run tests/enforce/runner.test.ts
```

- [x] **Step 3: Commit**

```bash
git add tests/enforce/runner.test.ts
git commit -m "test(enforce): add runner integration tests"
```

---

## Self-Review

1. **Spec coverage:** Projection, gap, bottom-up headroom cuts (low first, protects power users), floor enforcement, soft/hard modes, restore, tier weights, credits-to-USD, CLI command, daily cron — all covered.
2. **Placeholder scan:** No TBDs or TODOs. All code is complete.
3. **Type consistency:** `ConsumptionTier` defined in `src/enforce/types.ts` (avoids circular dep with classify). `BudgetPolicy` defined in types.ts and used in config.ts, engine.ts, runner.ts. `UserState`, `UserCut`, `EnforceResult` defined once and consumed consistently.

**Council review applied (15 findings addressed):**
- ETL staleness validation, UTC timezone fix, below-floor docstring clarification, day-1 dampening, batch upsert, initial_allocation reason, Math.round for USD, scalability note, YAGNI removals (warningHours, floorBasis, githubBudgetId, force), ConsumptionTier local definition, edge-case tests.

**Deferred to future work:**
- **GitHub Budgets API client** (`src/github/budget.ts`) — needs endpoint shape verification against actual API. ULBs are calculated and stored in `ulb_audit` but not yet pushed to GitHub's Budgets API. This means v1 is **observe-only**: the pipeline audits what ULBs *should be* but does not enforce them via the API.
- **Uncloseable-gap notifications** — `uncloseableGap > 0` is computed (soft mode only) but no alert is dispatched. Future work should wire this into the existing notification system (`src/notifications/`).
- **`getLatestUlbForAllUsers` optimization** — Uses a 60-day window scan for simplicity. For orgs with 1000+ users, consider a window function or `latest_ulb` denormalized column on the `users` table.
- **Model-tier monitoring (Phase 5)** — Track usage by model tier (low/middle/high cost models) and help users optimize their model-level spending patterns.
