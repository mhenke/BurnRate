# AI Agents Guide

> **For AI agents working on the BurnRate codebase.** This document explains how to work effectively with this project's AI agent configuration.

---

## Quick Start

**Before starting any task:**

1. Read `AGENTS.md` — Core rules and workflows
2. Read this file — Project-specific agent guidance
3. Check `docs/superpowers/plans/` — Active implementation plans

---

## Agent Configuration

BurnRate uses the **oh-my-opencode-slim** agent framework with the following configuration:

### Available Agents

| Agent | Role | When to Use |
|-------|------|-------------|
| `@explorer` | Codebase search specialist | Finding files, patterns, symbols |
| `@librarian` | Documentation lookup | Library APIs, framework docs |
| `@oracle` | Strategic advisor | Architecture decisions, complex debugging, code review |
| `@designer` | UI/UX specialist | Frontend, styling, visual polish |
| `@fixer` | Implementation specialist | Bounded code changes, test updates |
| `@council` | Multi-model consensus | High-stakes decisions needing multiple perspectives |

### Delegation Rules

**MUST delegate:**
- Codebase discovery → `@explorer`
- External research/docs → `@librarian`
- Architecture/complex debugging → `@oracle`
- UI/UX work → `@designer`
- Bounded implementation → `@fixer`

**DO NOT delegate:**
- Single small changes (<20 lines, one file)
- When explaining > doing
- Tight integration with current work

### Workflow

1. **Understand** the request
2. **Plan** using todos for multi-step work
3. **Delegate** to specialists when appropriate
4. **Verify** with tests and builds
5. **Commit** with conventional commit messages

---

## Superpowers Framework

BurnRate uses the **superpowers** planning framework:

### Plan Files

Located in `docs/superpowers/plans/`:

- `2026-06-13-burnrate-phase-1-observe-only.md` — ✅ Complete
- `2026-06-13-burnrate-phase-3-budget-sync.md` — ✅ Complete

### Spec Files

Located in `docs/superpowers/specs/`:

- `2026-06-13-burnrate-classification-slice-design.md` — Phase 2 spec
- `2026-06-13-burnrate-phase-3-budget-sync-notifications.md` — Phase 3 spec

### TDD Workflow

Every task follows Test-Driven Development:

1. Write the failing test
2. Run test → verify it fails (Red)
3. Implement minimum code to pass
4. Run test → verify it passes (Green)
5. Commit progress

---

## Project Structure

```
BurnRate/
├── src/
│   ├── github/          # GitHub API clients
│   │   ├── client.ts    # GitHub client factory
│   │   ├── reports.ts   # Copilot reports API
│   │   └── budget.ts    # Budget API (Phase 3)
│   ├── etl/             # Data pipeline
│   │   ├── pipeline.ts  # Main ETL orchestrator
│   │   ├── parse_users.ts
│   │   ├── parse_teams.ts
│   │   └── parse_enterprise.ts
│   ├── db/              # Database layer
│   │   ├── schema.ts    # Drizzle schema definitions
│   │   ├── migrate.ts   # Migration runner
│   │   └── client.ts    # DB client factory
│   ├── forecast/        # Burn forecasting
│   │   └── engine.ts    # Forecast calculations
│   ├── classify/        # User classification
│   │   ├── engine.ts    # Percentile classifier
│   │   ├── runner.ts    # DB read → classify → write
│   │   └── value_config.ts  # YAML tier config loader
│   ├── budget/          # Budget sync (Phase 3)
│   │   ├── retry.ts     # Shared retry utility
│   │   ├── notifications.ts  # Slack + GitHub Issue dispatch
│   │   └── budget_sync.ts    # Pipeline orchestrator
│   └── index.ts         # CLI entrypoint
├── tests/
│   ├── github/
│   ├── etl/
│   ├── db/
│   ├── forecast/
│   ├── classify/
│   ├── budget/
│   └── index.test.ts
├── docs/
│   ├── superpowers/
│   │   ├── plans/
│   │   └── specs/
│   ├── GITHUB.md        # GitHub setup guide
│   └── AI_AGENTS.md     # This file
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── weekly-classify.yml
│       └── daily-budget-check.yml
├── AGENTS.md            # Agent rules (REQUIRED reading)
├── PRODUCT.md           # Product strategy
├── DESIGN.md            # Visual design system
├── README.md            # User documentation
├── HUMANIZE.md          # Plain language explanation
└── CONTRIBUTING.md      # Contribution guidelines
```

---

## Key Patterns

### Database

**Dual support:** PostgreSQL (production) + SQLite (local dev)

```typescript
import { isSqlite } from './client.js';

const tables = isSqlite ? schemaSq : schemaPg;
const statements = isSqlite ? sqliteStatements : pgStatements;
```

**Always use transactions for multi-statement operations:**

```typescript
await db.transaction(async (tx) => {
  await tx.insert(schema.users).values(users);
  await tx.insert(schema.classificationHistory).values(changes);
});
```

### GitHub API

**Always include API version header:**

```typescript
headers: {
  'X-GitHub-Api-Version': '2026-03-10',
  'Authorization': `token ${token}`,
}
```

**Use Octokit request interface:**

```typescript
const response = await octokit.request('GET /organizations/{org}/settings/billing/ai_credit/usage', {
  org,
});
```

### Error Handling

**Descriptive messages with context:**

```typescript
if (!response.ok) {
  throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
}
```

**Wrap non-Error throws:**

```typescript
catch (err) {
  const error = err instanceof Error ? err : new Error(String(err));
  // Handle error
}
```

### Testing

**Mock external APIs:**

```typescript
import { vi } from 'vitest';

const mockOctokit = {
  request: vi.fn().mockResolvedValue({ data: mockData }),
};
```

**Use injectable delays for retry tests:**

```typescript
await withRetry(fn, {
  maxAttempts: 3,
  delays: [100, 200],
  delayFn: () => Promise.resolve(), // Skip real delays
});
```

---

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | Database connection | `postgresql://user:pass@localhost:5432/burnrate` or `:memory:` |
| `GITHUB_TOKEN` | GitHub PAT | `ghp_xxx` |
| `GITHUB_ENTERPRISE` | Enterprise identifier | `my-company` |
| `GITHUB_ORG` | Organization identifier | `my-org` |
| `SLACK_WEBHOOK_URL` | Slack notifications | `https://hooks.slack.com/...` |
| `BUDGET_ISSUE_REPO` | GitHub Issue repo | `owner/repo` |
| `DRY_RUN` | Skip writes/notifications | `true` or `false` |
| `JSON_LOGS` | Structured logging | `true` or `false` |

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run ingest` | Fetch and store Copilot reports |
| `npm run forecast` | Generate burn forecasts |
| `npm run classify` | Classify users by tiers |
| `npm run budget-sync` | Sync budgets and send alerts |
| `npm test` | Run test suite |
| `npm run build` | Compile TypeScript |
| `npm run migrate` | Run database migrations |

---

## Current Status

### Phase 1: Observe-Only ETL ✅

- Raw report storage
- User/team parsing
- Daily usage aggregation
- Pool snapshots with forecasts

### Phase 2: Classification ✅

- Consumption tier (percentile-based)
- Value tier (config-driven)
- Classification history tracking
- Weekly automated classification

### Phase 3: Budget Sync + Notifications ✅

- Budget API integration
- Daily budget snapshots
- Slack notifications
- GitHub Issue creation/commenting
- Alert level change detection
- Notification deduplication

### Phase 4: ULB Enforcement 📋 Planned

- GitHub Budgets API writes
- User-scoped budget limits
- Tier-based multipliers
- Last-day release logic

---

## Common Tasks

### Adding a New Feature

1. Check `docs/superpowers/plans/` for active plans
2. Create/update plan file with TDD steps
3. Write failing test
4. Implement minimum code
5. Verify tests pass
6. Commit with conventional message

### Fixing a Bug

1. Write test that reproduces the bug (should fail)
2. Fix the code
3. Verify test passes
4. Check for regressions (run full suite)
5. Commit fix

### Running Tests

```bash
# All tests
npm test

# Specific file
npx vitest run tests/budget/budget_sync.test.ts

# With coverage
npm test -- --coverage

# Watch mode
npx vitest
```

### Debugging

**Enable verbose logging:**

```bash
DEBUG=burnrate:* npm run budget-sync
```

**Use dry-run mode:**

```bash
npm run budget-sync -- --dry-run --json-logs
```

**Check database directly:**

```sql
-- PostgreSQL
SELECT * FROM budget_snapshots ORDER BY snapshot_date DESC LIMIT 10;

-- SQLite
sqlite3 burnrate.db "SELECT * FROM budget_snapshots ORDER BY snapshot_date DESC LIMIT 10;"
```

---

## Questions?

- **Architecture questions:** Read `PRODUCT.md` and `AGENTS.md`
- **Visual design:** Read `DESIGN.md`
- **Implementation details:** Check `docs/superpowers/specs/`
- **Agent workflows:** Read `AGENTS.md`

---

**Last updated:** 2026-06-13
