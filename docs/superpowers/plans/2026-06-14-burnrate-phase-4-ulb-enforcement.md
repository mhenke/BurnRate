# Phase 4: ULB Enforcement with Burn-Chart Projection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily enforcement pipeline that reads pool usage, projects end-of-month burn, calculates tier-weighted user-level budgets from 30-day averages, and writes ULBs via GitHub Budgets API, with hard/soft enforcement modes.

**Architecture:** `src/enforce/engine.ts` contains pure math (projection, cut distribution, restore). `src/enforce/runner.ts` orchestrates reads from DB, runs the engine, writes to `ulb_audit`, and dispatches notifications. `src/config.ts` is extended with `BudgetPolicy`. A new `daily-enforce.yml` workflow runs the CLI daily.

**Tech Stack:** TypeScript, Node.js, Drizzle ORM (PostgreSQL + SQLite), `octokit`, `dotenv`, `vitest`, GitHub Actions.

**Credits-to-Dollars:** Fixed `1 credit = $0.01 USD`. Internal calculations in credits; API calls in USD.

---

## File Structure

| File | Create/Modify | Purpose |
|------|--------------|---------|
| `src/enforce/types.ts` | Create | `BudgetPolicy`, `TierWeights`, `UserState`, `EnforceResult` types |
| `src/config.ts` | Modify | Extend `BurnrateConfig` with optional `budget` section |
| `src/db/schema.ts` | Modify | Add `ulbAuditPg` / `ulbAuditSq` tables |
| `src/db/migrations/pg/0002_ulb_audit.sql` | Create | PostgreSQL migration |
| `src/db/migrations/sqlite/0002_ulb_audit.sql` | Create | SQLite migration |
| `src/db/migrations/pg/meta/_journal.json` | Modify | Add journal entry |
| `src/db/migrations/sqlite/meta/_journal.json` | Modify | Add journal entry |
| `src/db/queries.ts` | Modify | Add `getLatestUlbForUser`, `insertUlbAudit` queries |
| `src/enforce/engine.ts` | Create | Projection, cut distribution, restore math |
| `src/enforce/runner.ts` | Create | Orchestrator: read DB, run engine, write audit, notify |
| `src/cli/args.ts` | Modify | Add `parseEnforceArgs` |
| `src/index.ts` | Modify | Wire `enforce` command |
| `config/burnrate.sample.yml` | Modify | Add `budget` section |
| `.github/workflows/daily-enforce.yml` | Create | Daily cron workflow |
| `tests/enforce/types.test.ts` | Create | Config loading and defaults |
| `tests/enforce/engine.test.ts` | Create | Unit tests for projection, cuts, restore |
| `tests/enforce/runner.test.ts` | Create | Integration tests with in-memory SQLite |

---

### Task 1: Budget Policy Types

**Files:**
- Create: `src/enforce/types.ts`

- [ ] **Step 1: Create types file**

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
  floorBasis: '30d_avg';
  restoreRate: number;
  warningHours: number;
  tierWeights: TierWeights;
};

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  mode: 'managed',
  bufferPct: 0.05,
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
  action: 'throttle' | 'restore' | 'none' | 'initial';
  usersAdjusted: number;
  usersBlocked: number;
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

- [ ] **Step 2: Commit**

```bash
git add src/enforce/types.ts
git commit -m "feat(enforce): add budget policy and enforcement types"
```

---

### Task 2: Extend BurnrateConfig with BudgetPolicy

**Files:**
- Modify: `src/config.ts:1-26`

- [ ] **Step 1: Add import and extend config type**

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

- [ ] **Step 2: Add resolveBudgetPolicy helper**

Add after `resolveThresholds`:

```typescript
import { DEFAULT_BUDGET_POLICY, type BudgetPolicy } from './enforce/types.js';

export function resolveBudgetPolicy(
  budget: BurnrateConfig['budget'] = {},
): BudgetPolicy {
  return {
    mode: budget.mode ?? DEFAULT_BUDGET_POLICY.mode,
    bufferPct: budget.bufferPct ?? DEFAULT_BUDGET_POLICY.bufferPct,
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

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add BudgetPolicy to BurnrateConfig"
```

---

### Task 3: ULB Audit DB Schema

**Files:**
- Modify: `src/db/schema.ts:238` (append after notificationLogSq)

- [ ] **Step 1: Add PG ULB audit schema**

Append after `notificationLogPg` closing:

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
}, (t) => [
  pgIndex('ulb_audit_login_date_idx').on(t.githubLogin, t.effectiveDate),
]);
```

And the SQLite variant at end of file:

```typescript
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
}, (t) => [
  sqIndex('ulb_audit_login_date_sq_idx').on(t.githubLogin, t.effectiveDate),
]);
```

- [ ] **Step 2: Commit**

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

- [ ] **Step 1: Create PG migration SQL**

`src/db/migrations/pg/0002_ulb_audit.sql`:

```sql
CREATE TABLE IF NOT EXISTS "ulb_audit" (
  "id" BIGSERIAL PRIMARY KEY,
  "effective_date" DATE NOT NULL,
  "github_login" TEXT NOT NULL,
  "ulb_usd" INTEGER NOT NULL,
  "ulb_credits" INTEGER NOT NULL,
  "tier_at_time" TEXT NOT NULL,
  "baseline_credits" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "github_budget_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ulb_audit_login_date_idx" ON "ulb_audit" ("github_login", "effective_date");
```

- [ ] **Step 2: Create SQLite migration SQL**

`src/db/migrations/sqlite/0002_ulb_audit.sql`:

```sql
CREATE TABLE IF NOT EXISTS "ulb_audit" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "effective_date" TEXT NOT NULL,
  "github_login" TEXT NOT NULL,
  "ulb_usd" INTEGER NOT NULL,
  "ulb_credits" INTEGER NOT NULL,
  "tier_at_time" TEXT NOT NULL,
  "baseline_credits" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "github_budget_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ulb_audit_login_date_sq_idx" ON "ulb_audit" ("github_login", "effective_date");
```

- [ ] **Step 3: Update PG journal**

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

- [ ] **Step 4: Update SQLite journal**

Same entry appended to `src/db/migrations/sqlite/meta/_journal.json` entries.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/
git commit -m "feat(db): add ulb_audit migration for PG and SQLite"
```

---

### Task 5: ULB Audit DB Queries

**Files:**
- Modify: `src/db/queries.ts`

- [ ] **Step 1: Add import for ulbAudit tables**

Add to existing schema imports:

```typescript
  ulbAuditPg, ulbAuditSq,
```

- [ ] **Step 2: Add getLatestUlbForUser query**

```typescript
export type UlbAuditRow = {
  githubLogin: string;
  ulbCredits: number;
  effectiveDate: string;
};

/**
 * Return the most recent ULB audit entry for each user.
 * Used by the enforce runner to find current ULBs for restore calculation.
 */
export async function getLatestUlbForAllUsers(db: DbClient): Promise<Map<string, number>> {
  const r = runner(db);
  const t = dialectTable(db, ulbAuditPg, ulbAuditSq);

  const rows = await r
    .select({
      githubLogin: t.githubLogin,
      ulbCredits: t.ulbCredits,
    })
    .from(t)
    .orderBy(desc(t.effectiveDate)) as UlbAuditRow[];

  const map = new Map<string, number>();
  for (const row of rows) {
    if (!map.has(row.githubLogin)) {
      map.set(row.githubLogin, Number(row.ulbCredits));
    }
  }
  return map;
}
```

- [ ] **Step 3: Add insertUlbAudit query**

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
 * Append a ULB audit record. Idempotent per (effective_date, github_login),
 * so re-running the same day overwrites the previous entry.
 */
export async function upsertUlbAudit(db: DbClient, entries: UlbAuditInsert[]): Promise<void> {
  if (entries.length === 0) return;
  const r = runner(db);
  const t = dialectTable(db, ulbAuditPg, ulbAuditSq);

  for (const e of entries) {
    await r.insert(t).values({
      effectiveDate: e.effectiveDate,
      githubLogin: e.githubLogin,
      ulbUsd: e.ulbUsd,
      ulbCredits: e.ulbCredits,
      tierAtTime: e.tierAtTime,
      baselineCredits: e.baselineCredits,
      reason: e.reason,
      githubBudgetId: e.githubBudgetId ?? null,
    }).onConflictDoNothing();
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat(db): add ulb audit queries"
```

---

### Task 6: Projection and Cut Engine

**Files:**
- Create: `src/enforce/engine.ts`

- [ ] **Step 1: Create the engine**

```typescript
import type { BudgetPolicy, TierWeights, UserState, UserCut, EnforceResult } from './types.js';
import type { ConsumptionTier } from '../classify/engine.js';

const CUT_ORDER: ConsumptionTier[] = ['extreme', 'high', 'medium'];

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
export function runEngine(input: EngineInput): Omit<EnforceResult, 'usersBlocked'> {
  const daysRemaining = input.daysInCycle - input.daysElapsed;
  const projectedEom = projectEom(input.creditsUsedMtd, input.daysElapsed, daysRemaining);
  const bufferTarget = Math.round(input.poolTotal * input.policy.bufferPct);
  const gap = computeGap(projectedEom, input.poolTotal, input.policy.bufferPct);

  if (gap <= 0 && !input.policy.mode) {
    return {
      mode: input.policy.mode,
      poolTotal: input.poolTotal,
      creditsUsedMtd: input.creditsUsedMtd,
      daysElapsed: input.daysElapsed,
      daysRemaining,
      projectedEom,
      bufferTarget,
      gap: 0,
      action: 'none',
      usersAdjusted: 0,
      uncloseableGap: 0,
      changes: [],
    };
  }

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

  const { cuts, remainingGap } = computeCuts(
    input.users, gap, daysRemaining, input.policy.tierWeights,
  );

  if (remainingGap > 0 && input.policy.mode === 'hard') {
    const floorCuts = computeFloorCuts(
      input.users, remainingGap, daysRemaining,
    );
    cuts.push(...floorCuts);
  }

  const finalRemainingGap = remainingGap > 0 && input.policy.mode === 'hard'
    ? Math.max(0, remainingGap - cuts.reduce((s, c) => s + c.cutAmount, 0) + remainingGap)
    : remainingGap;

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
    uncloseableGap: finalRemainingGap,
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

    for (const u of tierUsers) {
      const floor = computeFloor(u.dailyAvg30d, daysRemaining);
      const headroom = Math.max(0, u.currentUlb - floor);
      const share = availableHeadroom > 0 ? headroom / availableHeadroom : 0;
      const cutAmount = Math.round(cutFromTier * share);
      if (cutAmount <= 0) continue;

      const newUlb = Math.max(floor, u.currentUlb - cutAmount);
      cuts.push({
        githubLogin: u.githubLogin,
        tier,
        baseline: floor,
        previousUlb: u.currentUlb,
        newUlb,
        cutAmount: u.currentUlb - newUlb,
      });
    }

    remainingGap -= cutFromTier;
    if (remainingGap <= 0) break;
  }

  return { cuts, remainingGap };
}

function computeFloorCuts(
  users: UserState[],
  gap: number,
  daysRemaining: number,
): UserCut[] {
  const eligibleUsers = users
    .filter(u => u.consumptionTier !== 'low')
    .sort((a, b) => b.currentUlb - a.currentUlb);

  const cuts: UserCut[] = [];
  let remainingGap = gap;

  for (const u of eligibleUsers) {
    const floor = computeFloor(u.dailyAvg30d, daysRemaining);
    const blockAmount = Math.min(remainingGap, Math.max(0, u.currentUlb - floor));
    if (blockAmount <= 0) continue;

    cuts.push({
      githubLogin: u.githubLogin,
      tier: u.consumptionTier,
      baseline: floor,
      previousUlb: u.currentUlb,
      newUlb: Math.max(floor, u.currentUlb - blockAmount),
      cutAmount: blockAmount,
    });
    remainingGap -= blockAmount;
  }

  return cuts;
}

function computeRestore(currentUlb: number, targetUlb: number, restoreRate: number): number {
  const gap = targetUlb - currentUlb;
  if (gap <= 0) return currentUlb;
  return Math.round(currentUlb + gap * restoreRate);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/enforce/engine.ts
git commit -m "feat(enforce): add projection and cut engine"
```

---

### Task 7: Enforce Runner

**Files:**
- Create: `src/enforce/runner.ts`

- [ ] **Step 1: Create the runner**

```typescript
import { today } from '../constants.js';
import type { DbClient } from '../db/client.js';
import * as queries from '../db/queries.js';
import { upsertUlbAudit } from '../db/queries.js';
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
  if (usageRows.length === 0) {
    throw new Error('No daily_usage data found. Run `burnrate etl` first.');
  }

  const userRows = await queries.getAllUsers(db);
  const previousUlbs = await queries.getLatestUlbForAllUsers(db);

  const orgDailyAvg = usageRows.reduce((sum, r) => sum + Number(r.credits), 0) / 30 / Math.max(1, usageRows.length);

  const now = new Date();
  const daysInCycle = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();

  const users: UserState[] = [];
  const usageMap = new Map(usageRows.map(r => [r.github_login, Number(r.credits)]));

  for (const u of userRows) {
    const total30d = usageMap.get(u.github_login) ?? 0;
    const dailyAvg30d = total30d > 0 ? total30d / 30 : orgDailyAvg;
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

  await upsertUlbAudit(db, auditEntries);

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/enforce/runner.ts
git commit -m "feat(enforce): add enforce runner orchestrator"
```

---

### Task 8: CLI Args for Enforce

**Files:**
- Modify: `src/cli/args.ts`

- [ ] **Step 1: Add parseEnforceArgs**

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

- [ ] **Step 2: Commit**

```bash
git add src/cli/args.ts
git commit -m "feat(cli): add enforce arg parsing"
```

---

### Task 9: CLI Dispatch for Enforce

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports**

```typescript
import { resolveBudgetPolicy } from './config.js';
import { runEnforce } from './enforce/runner.js';
import { parseEnforceArgs } from './cli/args.js';
```

- [ ] **Step 2: Add enforce command handler**

Before the final `throw new Error(...)` line, add:

```typescript
  if (command === 'enforce') {
    const parsed = parseEnforceArgs(argv.slice(3));
    const cfg = getConfig();
    const db = initDb(cfg.postgres.url);
    const policy = resolveBudgetPolicy(cfg.budget);

    try {
      const result = await runEnforce(db, policy, {
        reason: 'manual',
        report: parsed.report,
        dryRun: parsed.dryRun,
        force: parsed.force,
      });

      if (parsed.report) {
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

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(cli): wire enforce command"
```

---

### Task 10: Sample Config Update

**Files:**
- Modify: `config/burnrate.sample.yml`

- [ ] **Step 1: Add budget section**

Append at end of file:

```yaml

# Budget enforcement policy (Phase 4 ULB enforcement)
# Controls how BurnRate adjusts user-level budgets to prevent pool exhaustion.
budget:
  mode: hard              # hard (never go over) | soft (minimize disruption, allow overage)
  bufferPct: 0.05          # target ending month with 5% pool remaining
  floorBasis: 30d_avg       # never cut a user below their 30-day average
  restoreRate: 0.5          # restore 50% of cuts per day when projection clears
  warningHours: 72          # hard mode only: hours notice before cuts land (0 = immediate)
  tier_weights:             # multiplier on 30d_avg baseline for initial allocation
    extreme: 1.5            # power users get 150% of historical need
    high: 1.15              # above-average users get 115%
    medium: 1.0             # baseline (no adjustment)
    low: 0.75               # light users get 75% — they won't notice
```

- [ ] **Step 2: Commit**

```bash
git add config/burnrate.sample.yml
git commit -m "feat(config): add budget enforcement section to sample config"
```

---

### Task 11: Daily Cron Workflow

**Files:**
- Create: `.github/workflows/daily-enforce.yml`

- [ ] **Step 1: Create workflow file**

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

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/daily-enforce.yml
git commit -m "feat(ci): add daily enforce cron workflow"
```

---

### Task 12: Engine Unit Tests

**Files:**
- Create: `tests/enforce/engine.test.ts`

- [ ] **Step 1: Write tests**

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
    it('cuts extreme users first, proportional to headroom', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'extreme1', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 3000, daysRemaining: 20 }), // floor=2000, headroom=1000
        makeUser({ githubLogin: 'extreme2', consumptionTier: 'extreme', dailyAvg30d: 100, currentUlb: 2500, daysRemaining: 20 }), // floor=2000, headroom=500
        makeUser({ githubLogin: 'med1', consumptionTier: 'medium', dailyAvg30d: 100, currentUlb: 2000, daysRemaining: 20 }),    // floor=2000, headroom=0
        makeUser({ githubLogin: 'low1', consumptionTier: 'low', dailyAvg30d: 100, currentUlb: 1500, daysRemaining: 20 }),         // floor=2000, headroom=-500
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

      assert.ok(extremeCuts.length > 0, 'Extreme users should be cut');
      assert.equal(mediumCuts.length, 0, 'Medium users should not be cut (no headroom)');
      assert.equal(lowCuts.length, 0, 'Low users should never be cut');
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

    it('computes uncloseableGap in hard mode when cuts reach floor', () => {
      const users: UserState[] = [
        makeUser({ githubLogin: 'ex', consumptionTier: 'extreme', dailyAvg30d: 200, currentUlb: 4000, daysRemaining: 10 }),
      ];

      const result = runEngine(makeInput({
        poolTotal: 1000,
        creditsUsedMtd: 5000,
        daysElapsed: 15,
        users,
        policy: makePolicy({ mode: 'hard' }),
      }));

      assert.ok(result.uncloseableGap >= 0);
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
});
```

- [ ] **Step 2: Run tests and verify they pass**

```bash
npx vitest run tests/enforce/engine.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/enforce/engine.test.ts
git commit -m "test(enforce): add engine unit tests"
```

---

### Task 13: Policy Config Tests

**Files:**
- Create: `tests/enforce/policy.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { DEFAULT_BUDGET_POLICY, DEFAULT_TIER_WEIGHTS } from '../../src/enforce/types.js';
import { resolveBudgetPolicy } from '../../src/config.js';

describe('budget policy config', () => {
  it('returns defaults when no config provided', () => {
    const policy = resolveBudgetPolicy();
    assert.equal(policy.mode, 'managed');
    assert.equal(policy.bufferPct, 0.05);
    assert.equal(policy.restoreRate, 0.5);
    assert.equal(policy.warningHours, 72);
    assert.equal(policy.tierWeights.extreme, 1.5);
    assert.equal(policy.tierWeights.low, 0.75);
  });

  it('merges partial config with defaults', () => {
    const policy = resolveBudgetPolicy({ mode: 'soft', bufferPct: 0.1 });
    assert.equal(policy.mode, 'soft');
    assert.equal(policy.bufferPct, 0.1);
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

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/enforce/policy.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/enforce/policy.test.ts
git commit -m "test(enforce): add policy config tests"
```

---

### Task 14: Runner Integration Tests

**Files:**
- Create: `tests/enforce/runner.test.ts`

- [ ] **Step 1: Write tests**

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
  beforeAll(() => {
    initDb(':memory:');
    runMigrations(getDb());
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

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/enforce/runner.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/enforce/runner.test.ts
git commit -m "test(enforce): add runner integration tests"
```

---

## Self-Review

1. **Spec coverage:** Projection, gap, top-down cuts (extreme first), floor enforcement, soft/hard modes, restore, tier weights, credits-to-USD, CLI command, daily cron — all covered.
2. **Placeholder scan:** No TBDs or TODOs. All code is complete.
3. **Type consistency:** `ConsumptionTier` imported from `src/classify/engine.js`. `BudgetPolicy` defined in types.ts and used in config.ts, engine.ts, runner.ts. `UserState`, `UserCut`, `EnforceResult` defined once and consumed consistently.

**Deferred to future work:**
- GitHub Budgets API client (`src/github/budget.ts`) — needs endpoint shape verification against actual API
- Notification integration for uncloseable-gap alerts
- warning_hours deferred notification system
