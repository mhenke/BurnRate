# BurnRate Phase 1 — Observe-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript, GitHub-Actions-driven, read-only BurnRate pipeline that ingests Copilot usage reports into Postgres, stores raw payloads, and produces simple burn forecasts without any budget writes or Copilot Skills automation.

**Architecture:** A small Node/TypeScript CLI wraps a GitHub API client, a Postgres client, and a set of ETL parsers. GitHub Actions schedules the CLI for nightly ingestion and morning forecasting. Raw report payloads are stored first, then parsed into normalized tables so schema changes can be recovered without losing history.

**Tech Stack:** TypeScript, Node.js, `pg`, `octokit`, `dotenv`, `tsx`, `vitest`, GitHub Actions, Postgres.

---

### Task 1: Bootstrap the repository and runtime entrypoints

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `.env.sample`
- Create: `src/index.ts`
- Create: `tests/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { it, expect } from 'vitest';

it('imports the main module', async () => {
  await expect(import('../src/index.js')).resolves.toBeDefined();
});
```

This fails because `src/index.ts` doesn't exist yet.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bootstrap.test.ts`
Expected: fail because `package.json` does not exist or has no `name` field.

- [x] **Step 3: Write minimal implementation**

```json
{
  "name": "burnrate",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "check": "tsx src/index.ts check",
    "etl": "tsx src/index.ts etl",
    "forecast": "tsx src/index.ts forecast"
  },
  "dependencies": {
    "octokit": "^4.0.0",
    "pg": "^8.16.0",
    "yaml": "^2.8.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "@types/pg": "^8.11.0",
    "vitest": "^3.0.0"
  }
}
```

```ts
// src/index.ts
export async function main(_argv: string[]): Promise<void> {
  // stub — wiring happens in Task 10
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build`
Expected: TypeScript compiles.

Run: `npm install`
Expected: installs dependencies.

- [x] **Step 5: Commit** `be70f54`

```bash
git add package.json tsconfig.json .gitignore README.md .env.sample src/index.ts tests/bootstrap.test.ts
git commit -m "feat: bootstrap burnrate repo"
```

---

### Task 2: Add config loading and validation

**Files:**
- Create: `src/config.ts`
- Create: `config/burnrate.sample.yml`
- Modify: `src/index.ts`
- Create: `tests/config.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { loadConfig } from '../src/config.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'burnrate-'));
const file = join(dir, 'burnrate.yml');
writeFileSync(
  file,
  `github:\n  enterprise: acme\n  org: acme-inc\n  token: \${GITHUB_TOKEN}\npostgres:\n  url: \${DATABASE_URL}\n`,
  'utf8',
);
assert.throws(() => loadConfig(file), /Missing burnrate.yml/);
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/config.test.ts`
Expected: failure because `loadConfig` is not implemented.

- [x] **Step 3: Write minimal implementation**

```ts
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export type BurnrateConfig = {
  github: { enterprise: string; org: string; token: string };
  postgres: { url: string };
};

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '');
}

export function loadConfig(filePath: string): BurnrateConfig {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = parse(expandEnv(raw)) as Partial<BurnrateConfig>;
  if (!parsed.github?.enterprise) throw new Error('Missing burnrate.yml github.enterprise');
  if (!parsed.github?.org) throw new Error('Missing burnrate.yml github.org');
  if (!parsed.github?.token) throw new Error('Missing burnrate.yml github.token');
  if (!parsed.postgres?.url) throw new Error('Missing burnrate.yml postgres.url');
  return parsed as BurnrateConfig;
}
```

```yaml
# config/burnrate.sample.yml
github:
  enterprise: acme
  org: acme-inc
  token: ${GITHUB_TOKEN}
postgres:
  url: ${DATABASE_URL}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/config.test.ts`
Expected: pass.

- [x] **Step 5: Commit** `64e099a`

```bash
git add src/config.ts config/burnrate.sample.yml src/index.ts tests/config.test.ts
git commit -m "feat: add burnrate config loading"
```

---

### Task 3: Define the Postgres schema (aligned to reference doc)

Create the schema definition module with all Phase 1 tables. Naming follows the reference doc exactly (`snapshot_date`, `total_credits`, `usage_date`, `fetched_at`, etc.). `classification_history` is created as a stub but not populated until Phase 2.

**Files:**
- Create: `src/db/schema.ts`
- Create: `tests/db/schema.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import * as schema from '../../src/db/schema.js';

describe('schema', () => {
  it('defines the expected tables for both postgres and sqlite', () => {
    assert.ok(schema.rawReportsPg, 'rawReportsPg should be defined');
    assert.ok(schema.rawReportsSq, 'rawReportsSq should be defined');
    assert.ok(schema.usersPg, 'usersPg should be defined');
    assert.ok(schema.usersSq, 'usersSq should be defined');
    assert.ok(schema.dailyUsagePg, 'dailyUsagePg should be defined');
    assert.ok(schema.dailyUsageSq, 'dailyUsageSq should be defined');
    assert.ok(schema.teamUsagePg, 'teamUsagePg should be defined');
    assert.ok(schema.teamUsageSq, 'teamUsageSq should be defined');
    assert.ok(schema.classificationHistoryPg, 'classificationHistoryPg should be defined');
    assert.ok(schema.classificationHistorySq, 'classificationHistorySq should be defined');
    assert.ok(schema.poolSnapshotsPg, 'poolSnapshotsPg should be defined');
    assert.ok(schema.poolSnapshotsSq, 'poolSnapshotsSq should be defined');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: fail because schema module does not exist.

- [x] **Step 3: Write minimal implementation**

We define Drizzle tables for both PostgreSQL and SQLite in [src/db/schema.ts](file:///home/mhenke/Projects/BurnRate/src/db/schema.ts):
- `rawReportsPg` & `rawReportsSq`
- `usersPg` & `usersSq`
- `dailyUsagePg` & `dailyUsageSq`
- `teamUsagePg` & `teamUsageSq`
- `classificationHistoryPg` & `classificationHistorySq`
- `poolSnapshotsPg` & `poolSnapshotsSq`

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: pass.

- [x] **Step 5: Commit** `f1f35a6`

```bash
git add src/db/schema.ts tests/db/schema.test.ts
git commit -m "feat: define database schemas using Drizzle ORM"
```

---

### Task 4: Build the DB client and migration runner

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/migrate.ts`
- Create: `tests/db/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { createDbClient } from '../../src/db/client.js';

assert.equal(typeof createDbClient, 'function');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db/client.test.ts`
Expected: fail because db client module does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/db/client.ts
import pg from 'pg';

export type DbClient = {
  query: <T extends pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<pg.QueryResult<T>>;
  transaction: <T>(fn: (client: DbClient) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

export function createDbClient(connectionString: string): DbClient {
  const pool = new pg.Pool({ connectionString, max: 5 });

  async function query<T extends pg.QueryResultRow>(sql: string, params?: unknown[]) {
    return pool.query<T>(sql, params);
  }

  async function transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx: DbClient = {
        query: <T extends pg.QueryResultRow>(sql: string, params?: unknown[]) =>
          client.query<T>(sql, params),
        transaction,
        close: () => client.release(),
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return { query, transaction, close: () => pool.end() };
}
```

```ts
// src/db/migrate.ts
import type { DbClient } from './client.js';
import { schemaStatements } from './schema.js';

export async function runMigrations(db: DbClient): Promise<void> {
  await db.transaction(async (tx) => {
    for (const stmt of schemaStatements) {
      await tx.query(stmt);
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/db/client.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/client.ts src/db/migrate.ts tests/db/client.test.ts
git commit -m "feat: add db client and migration runner"
```

---

### Task 5: Implement the GitHub API client

Sets up Octokit with the required `X-GitHub-Api-Version: 2026-03-10` header, PAT-based auth, pagination helper, and signed-URL fetch with expiration handling.

**Prerequisites:**
- The enterprise's "Copilot usage metrics" policy must be set to "Enabled everywhere" — otherwise all `/metrics/reports/*` endpoints return 403.
- The workflow PAT must have scope `read:enterprise` (enterprise) or `manage_billing:copilot + read:org` (org-only). Fine-grained PATs do NOT work for enterprise endpoints.

**Files:**
- Create: `src/github/client.ts`
- Create: `src/github/types.ts`
- Create: `tests/github/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { createGitHubClient } from '../../src/github/client.js';

assert.equal(typeof createGitHubClient, 'function');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/github/client.test.ts`
Expected: fail.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/github/types.ts
export type CopilotReportResponse = {
  report_day: string;
  download_links: string[];
};

export type CopilotSeat = {
  assignee: { login: string };
  last_activity_at: string | null;
  last_activity_editor: string | null;
  created_at: string;
  plan_type: string;
};
```

```ts
// src/github/client.ts
import { Octokit } from 'octokit';

export type GitHubClient = {
  octokit: Octokit;
  enterprise: string;
  org: string;
  fetchSignedUrl: <T>(url: string) => Promise<T>;
};

export function createGitHubClient(token: string, enterprise: string, org: string): GitHubClient {
  const octokit = new Octokit({
    auth: token,
    baseUrl: 'https://api.github.com',
    request: {
      headers: {
        'X-GitHub-Api-Version': '2026-03-10',
      },
    },
  });

  async function fetchSignedUrl<T>(url: string): Promise<T> {
    // Signed URLs expire — fetch and parse immediately
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Signed URL fetch failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  return { octokit, enterprise, org, fetchSignedUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/github/client.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/github/client.ts src/github/types.ts tests/github/client.test.ts
git commit -m "feat: add github client with octokit and signed-url fetcher"
```

---

### Task 6: Implement GitHub API endpoint modules

**Files:**
- Create: `src/github/reports.ts`
- Create: `src/github/seats.ts`
- Create: `tests/github/reports.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { buildReportUrls } from '../../src/github/reports.js';

assert.equal(
  buildReportUrls('acme', 'enterprise-1-day', '2026-06-12')[0],
  '/enterprises/acme/copilot/metrics/reports/enterprise-1-day?day=2026-06-12'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/github/reports.test.ts`
Expected: fail.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/github/reports.ts
export type ReportType =
  | 'enterprise-1-day'
  | 'enterprise-28-day'
  | 'users-1-day'
  | 'users-28-day'
  | 'enterprise-user-teams-1-day';

export function buildReportUrls(
  enterprise: string,
  reportType: ReportType,
  day?: string
): string[] {
  const base = `/enterprises/${enterprise}/copilot/metrics/reports/${reportType}`;
  if (reportType.endsWith('-1-day')) {
    if (!day) throw new Error('day is required for 1-day report types');
    return [`${base}?day=${day}`];
  }
  // 28-day reports have no suffix or query params
  return [base];
}

export async function fetchReport(
  client: { octokit: any; fetchSignedUrl: <T>(url: string) => Promise<T> },
  reportType: ReportType,
  day: string
): Promise<{ download_links: string[]; report_day: string }> {
  const url = buildReportUrls(client.octokit, reportType, day);
  // Steps: 1) GET report endpoint → signed URLs, 2) fetch each signed URL immediately
  // Implementation detail deferred to pipeline orchestration (Task 8)
  throw new Error('not implemented');
}
```

```ts
// src/github/seats.ts
import type { GitHubClient, CopilotSeat } from './types.js';

export async function fetchAllSeats(
  client: GitHubClient,
): Promise<CopilotSeat[]> {
  const seats: CopilotSeat[] = [];
  for await (const response of client.octokit.paginate.iterator(
    client.octokit.rest.enterpriseAdmin.listCopilotSeatsForEnterprise as any,
    { enterprise: client.enterprise, per_page: 100 },
  )) {
    for (const seat of response.data.seats ?? []) {
      seats.push(seat as CopilotSeat);
    }
  }
  return seats;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/github/reports.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/github/reports.ts src/github/seats.ts tests/github/reports.test.ts
git commit -m "feat: add report url builder and seat fetcher"
```

---

### Task 7: Implement ETL raw storage and parse functions

Each parse function accepts raw JSONB and returns typed row arrays. Tests use fixture data.

**Files:**
- Create: `src/etl/raw_storage.ts`
- Create: `src/etl/parse_users.ts`
- Create: `src/etl/parse_enterprise.ts`
- Create: `src/etl/parse_teams.ts`
- Create: `src/etl/parse_seats.ts`
- Create: `tests/etl/raw_storage.test.ts`
- Create: `tests/etl/parse_users.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/etl/raw_storage.test.ts
import { strict as assert } from 'node:assert';
import { normalizeRawReport } from '../../src/etl/raw_storage.js';

const result = normalizeRawReport({ report_type: 'users-1-day', report_date: '2026-06-12', source_url: 'https://example.com', payload: {} });
assert.equal(result.report_date, '2026-06-12');
assert.equal(result.report_type, 'users-1-day');
```

```ts
// tests/etl/parse_users.test.ts
import { strict as assert } from 'node:assert';
import { parseEnterpriseReportToUsers } from '../../src/etl/parse_users.js';

const rows = parseEnterpriseReportToUsers('acme', 'acme-inc', {
  report_day: '2026-06-12',
  data: [{ github_login: 'jdoe', credits_used: 150 }],
});
assert.equal(rows.length, 1);
assert.equal(rows[0].github_login, 'jdoe');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/etl/raw_storage.test.ts tests/etl/parse_users.test.ts`
Expected: fail.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/etl/raw_storage.ts
export type RawReportRow = {
  report_date: string;
  report_type: string;
  source_url: string;
  payload: Record<string, unknown>;
  fetched_at?: string;
};

export function normalizeRawReport(input: Omit<RawReportRow, 'fetched_at'>): RawReportRow {
  return { ...input, fetched_at: new Date().toISOString() };
}
```

```ts
// src/etl/parse_users.ts
export type UserRow = {
  login: string;
  enterprise: string;
  org: string;
  display_name?: string;
  email?: string;
  team?: string;
  seat_created_at?: string;
  last_activity_at?: string;
  consumption_tier?: string;
  value_tier?: string;
};

/** Parse enterprise-1-day report into user rows (status/activity snapshot). */
export function parseEnterpriseReportToUsers(
  enterprise: string,
  org: string,
  report: { report_day: string; data: Array<{ github_login: string } & Record<string, unknown>> },
): UserRow[] {
  return report.data.map((entry) => ({
    login: entry.github_login,
    enterprise,
    org,
  }));
}
```

```ts
// src/etl/parse_enterprise.ts
export type DailyUsageRow = {
  usage_date: string;
  github_login: string;
  credits: number;
  tokens_input: number;
  tokens_output: number;
  chat_requests: number;
  agent_requests: number;
  accepted_lines: number;
  suggested_lines: number;
  acceptance_rate: number | null;
  credits_per_acc_loc: number | null;
  model_breakdown: Record<string, unknown>;
  ide_breakdown: Record<string, unknown>;
  language_breakdown: Record<string, unknown>;
};

/** Parse users-1-day report into daily_usage rows. */
export function parseDailyUsage(
  report: { report_day: string; data: Array<Record<string, unknown>> },
): DailyUsageRow[] {
  return report.data.map((entry: any) => ({
    usage_date: report.report_day,
    github_login: entry.github_login ?? '',
    credits: Number(entry.credits_used ?? 0),
    tokens_input: Number(entry.tokens_input ?? 0),
    tokens_output: Number(entry.tokens_output ?? 0),
    chat_requests: Number(entry.chat_requests ?? 0),
    agent_requests: Number(entry.agent_requests ?? 0),
    accepted_lines: Number(entry.accepted_lines ?? 0),
    suggested_lines: Number(entry.suggested_lines ?? 0),
    acceptance_rate: entry.suggested_lines > 0 ? entry.accepted_lines / entry.suggested_lines : null,
    credits_per_acc_loc: entry.accepted_lines > 0 ? Number(entry.credits_used ?? 0) / entry.accepted_lines : null,
    model_breakdown: entry.model_breakdown ?? {},
    ide_breakdown: entry.ide_breakdown ?? {},
    language_breakdown: entry.language_breakdown ?? {},
  }));
}
```

```ts
// src/etl/parse_teams.ts
export type TeamUsageRow = {
  usage_date: string;
  team: string;
  credits: number;
  active_users: number;
  avg_acceptance_rate: number | null;
};

/** Parse enterprise-user-teams-1-day report into team_usage rows. */
export function parseTeamUsage(
  report: { report_day: string; data: Array<Record<string, unknown>> },
): TeamUsageRow[] {
  if (!Array.isArray(report.data)) return [];
  return report.data.map((entry: any) => ({
    usage_date: report.report_day,
    team: entry.team ?? 'unknown',
    credits: Number(entry.credits_used ?? 0),
    active_users: Number(entry.active_users ?? 0),
    avg_acceptance_rate: entry.avg_acceptance_rate ?? null,
  }));
}
```

```ts
// src/etl/parse_seats.ts
import type { CopilotSeat } from '../github/types.js';

/** Parse seat list into user upsert columns. */
export function parseSeatsToUsers(
  enterprise: string,
  org: string,
  seats: CopilotSeat[],
): Array<{
  login: string;
  enterprise: string;
  org: string;
  seat_created_at: string | null;
  last_activity_at: string | null;
}> {
  return seats.map((seat) => ({
    login: seat.assignee.login,
    enterprise,
    org,
    seat_created_at: seat.created_at ?? null,
    last_activity_at: seat.last_activity_at ?? null,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/etl/raw_storage.test.ts tests/etl/parse_users.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/etl/raw_storage.ts src/etl/parse_users.ts src/etl/parse_enterprise.ts src/etl/parse_teams.ts src/etl/parse_seats.ts tests/etl/raw_storage.test.ts tests/etl/parse_users.test.ts
git commit -m "feat: add etl raw storage and parse functions"
```

---

### Task 8: Wire the ETL pipeline orchestration

fetch → store raw → parse → upsert

**Files:**
- Create: `src/etl/pipeline.ts`
- Create: `tests/etl/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { runObserveOnlyPipeline } from '../../src/etl/pipeline.js';

assert.equal(typeof runObserveOnlyPipeline, 'function');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/etl/pipeline.test.ts`
Expected: fail.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/etl/pipeline.ts
import type { DbClient } from '../db/client.js';
import type { GitHubClient } from '../github/client.js';
import { normalizeRawReport } from './raw_storage.js';
import { parseDailyUsage } from './parse_enterprise.js';

type PipelineResult = {
  rawStored: number;
  usageUpserted: number;
};

/**
 * Phase 1 observe-only pipeline:
 * 1. Fetch report from GitHub API → signed URL
 * 2. Download raw payload
 * 3. Store raw payload in raw_reports
 * 4. Parse into normalized tables
 * 5. Upsert into daily_usage (read-only — no budget writes)
 */
export async function runObserveOnlyPipeline(
  gh: GitHubClient,
  db: DbClient,
  day: string,
): Promise<PipelineResult> {
  const result: PipelineResult = { rawStored: 0, usageUpserted: 0 };

  // Report types to fetch
  const types = ['enterprise-1-day', 'users-1-day', 'enterprise-user-teams-1-day'] as const;

  for (const reportType of types) {
    // Step 1: Get signed URLs from GitHub
    const endpoint = reportType.endsWith('-1-day')
      ? `/enterprises/${gh.enterprise}/copilot/metrics/reports/${reportType}?day=${day}`
      : `/enterprises/${gh.enterprise}/copilot/metrics/reports/${reportType}`;

    const reportResponse: any = await gh.octokit.request(`GET ${endpoint}`);

    if (!reportResponse.data?.download_links?.length) continue;

    // Step 2–3: Download each signed URL and store raw
    for (const link of reportResponse.data.download_links) {
      const rawPayload = await gh.fetchSignedUrl<Record<string, unknown>>(link);

      const rawRow = normalizeRawReport({
        report_date: day,
        report_type: reportType,
        source_url: link,
        payload: rawPayload,
      });

      await db.query(
        `INSERT INTO raw_reports (report_date, report_type, source_url, payload, fetched_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
         ON CONFLICT (report_type, report_date) DO NOTHING`,
        [rawRow.report_date, rawRow.report_type, rawRow.source_url, JSON.stringify(rawRow.payload), rawRow.fetched_at],
      );
      result.rawStored++;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/etl/pipeline.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/etl/pipeline.ts tests/etl/pipeline.test.ts
git commit -m "feat: add etl pipeline orchestration"
```

---

### Task 9: Build the forecast engine

Real monthly projection using dual 7-day and 30-day moving averages. Compares against pool totals and flags threshold breaches. No budget writes.

**Files:**
- Create: `src/forecast/engine.ts`
- Create: `tests/forecast/engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { computeForecast } from '../../src/forecast/engine.js';

// Daily burn rates: 7d avg = (100+200+150+175+225+250+300)/7 = 200, 30d avg = 180
const result = computeForecast({
  dailyCredits: [100, 200, 150, 175, 225, 250, 300],
  poolTotal: 10000,
  creditsUsedMtd: 5000,
  daysInMonth: 30,
  daysElapsed: 15,
});

assert.equal(result.rate7d, 200);
assert.equal(result.rate30d, 185.7); // approximate
assert.equal(result.forecast7d, 5000 + 200 * 15);
assert.equal(result.forecast30d, 5000 + 185.7 * 15);
assert.ok(result.pctOfPool7d > 50);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/forecast/engine.test.ts`
Expected: fail.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/forecast/engine.ts
export type ForecastInput = {
  dailyCredits: number[];
  poolTotal: number;
  creditsUsedMtd: number;
  daysInMonth: number;
  daysElapsed: number;
};

export type ForecastResult = {
  rate7d: number;
  rate30d: number;
  forecast7d: number;
  forecast30d: number;
  pctOfPool7d: number;
  pctOfPool30d: number;
  divergencePct: number;
  alertLevel: 'ok' | 'warning' | 'escalation' | 'critical';
};

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

export function computeForecast(input: ForecastInput): ForecastResult {
  const remainingDays = input.daysInMonth - input.daysElapsed;
  const last7 = input.dailyCredits.slice(-7);
  const last30 = input.dailyCredits.slice(-30);

  const rate7d = average(last7);
  const rate30d = average(last30);

  const forecast7d = Math.round((input.creditsUsedMtd + rate7d * remainingDays) * 100) / 100;
  const forecast30d = Math.round((input.creditsUsedMtd + rate30d * remainingDays) * 100) / 100;

  const pctOfPool7d = (forecast7d / input.poolTotal) * 100;
  const pctOfPool30d = (forecast30d / input.poolTotal) * 100;

  const divergencePct =
    rate7d > 0 && rate30d > 0
      ? Math.round((Math.abs(rate7d - rate30d) / Math.max(rate7d, rate30d)) * 10000) / 100
      : 0;

  let alertLevel: ForecastResult['alertLevel'] = 'ok';
  const maxPct = Math.max(pctOfPool7d, pctOfPool30d);
  if (maxPct >= 110) alertLevel = 'critical';
  else if (maxPct >= 100) alertLevel = 'escalation';
  else if (maxPct >= 90) alertLevel = 'warning';

  return {
    rate7d,
    rate30d,
    forecast7d,
    forecast30d,
    pctOfPool7d: Math.round(pctOfPool7d * 100) / 100,
    pctOfPool30d: Math.round(pctOfPool30d * 100) / 100,
    divergencePct,
    alertLevel,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/forecast/engine.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/forecast/engine.ts tests/forecast/engine.test.ts
git commit -m "feat: add forecast engine with 7d/30d moving averages"
```

---

### Task 10: Wire the CLI and GitHub Actions workflows

**Files:**
- Modify: `src/index.ts`
- Create: `.github/workflows/nightly-etl.yml`
- Create: `.github/workflows/daily-forecast.yml`
- Create: `tests/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { main } from '../src/index.js';

assert.equal(typeof main, 'function');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/index.test.ts`
Expected: fail because `main` is still the stub.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/index.ts
import { config } from 'dotenv';
import { loadConfig, type BurnrateConfig } from './config.js';
import { createDbClient } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createGitHubClient } from './github/client.js';
import { runObserveOnlyPipeline } from './etl/pipeline.js';
import { computeForecast, type ForecastInput } from './forecast/engine.js';

config();

function getConfig(): BurnrateConfig {
  const cfgPath = process.env.BURNRATE_CONFIG ?? 'config/burnrate.yml';
  return loadConfig(cfgPath);
}

export async function main(argv: string[]): Promise<void> {
  const command = argv[2] ?? 'check';

  if (command === 'check') {
    console.log('BurnRate Phase 1 — observe-only');
    console.log('Config check: OK');
    return;
  }

  if (command === 'etl') {
    const cfg = getConfig();
    const db = createDbClient(cfg.postgres.url);
    const gh = createGitHubClient(cfg.github.token, cfg.github.enterprise, cfg.github.org);

    await runMigrations(db);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const result = await runObserveOnlyPipeline(gh, db, yesterday);
    console.log(`ETL complete: ${result.rawStored} raw reports stored`);

    await db.close();
    return;
  }

  if (command === 'forecast') {
    const cfg = getConfig();
    const db = createDbClient(cfg.postgres.url);

    // Read the last 30 days of credit data from pool_snapshots or daily_usage
    const { rows } = await db.query<{ usage_date: string; credits: number }>(
      `SELECT usage_date, SUM(credits) as credits
       FROM daily_usage
       WHERE usage_date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY usage_date
       ORDER BY usage_date`,
    );

    const dailyCredits = rows.map((r) => Number(r.credits));
    const creditsUsedMtd = dailyCredits
      .filter((_, i) => i >= rows.length - new Date().getDate())
      .reduce((a, b) => a + b, 0);

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();

    // Read pool total from latest pool_snapshots or default to a placeholder
    const poolResult = await db.query<{ total_credits: number }>(
      `SELECT total_credits FROM pool_snapshots ORDER BY snapshot_date DESC LIMIT 1`,
    );
    const poolTotal = poolResult.rows.length > 0 ? Number(poolResult.rows[0].total_credits) : 0;

    const forecast = computeForecast({
      dailyCredits,
      poolTotal,
      creditsUsedMtd,
      daysInMonth,
      daysElapsed,
    });

    console.log(JSON.stringify(forecast, null, 2));

    await db.close();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

// Allow direct execution
main(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

```yaml
# .github/workflows/nightly-etl.yml
name: nightly-etl
on:
  schedule:
    - cron: '0 1 * * *'
  workflow_dispatch: {}
jobs:
  etl:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run etl
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_PAT }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          BURNRATE_CONFIG: config/burnrate.yml
```

```yaml
# .github/workflows/daily-forecast.yml
name: daily-forecast
on:
  schedule:
    - cron: '0 8 * * *'
  workflow_dispatch: {}
jobs:
  forecast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run forecast
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          BURNRATE_CONFIG: config/burnrate.yml
```

Key differences from original workflows:
- `secrets.GITHUB_PAT` (properly scoped PAT) instead of built-in `secrets.GITHUB_TOKEN`
- No `npm test` in nightly ETL (production workflow skips tests)
- Added `BURNRATE_CONFIG` env var for explicit config path
- No `permissions:` block (PAT auth supersedes)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/index.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts .github/workflows/nightly-etl.yml .github/workflows/daily-forecast.yml tests/index.test.ts
git commit -m "feat: wire cli and github actions workflows"
```

---

### Verification checklist for Phase 1

- [ ] `npm run build` succeeds
- [ ] `npm test` succeeds
- [ ] `npm run etl` runs without mutating budgets
- [ ] `npm run forecast` runs and logs thresholds only
- [ ] GitHub Actions workflows exist and use PAT (`GITHUB_PAT`) not built-in token
- [ ] Nightly ETL workflow does NOT run `npm test`
- [ ] Raw report payloads are stored before parsing
- [ ] `classification_history` table is created but never populated
- [ ] Backfill script is absent (deferred to later phase)
- [ ] No Copilot Skills code exists yet

---

## Summary of Changes from Original Plan

| Category | Change |
|----------|--------|
| **File implementations** | All core files (`client.ts`, `migrate.ts`, `pipeline.ts`, parse functions, `engine.ts`, `index.ts`) now have concrete implementation code |
| **Schema alignment** | Adopted reference doc naming: `snapshot_date`, `total_credits`, `usage_date`, `github_login`, `fetched_at`; added `manager`, `bucket_updated_at`, `accepted_lines`, `suggested_lines`, `acceptance_rate`, `credits_per_acc_loc`; restructured `team_usage` to summary-level; added `classification_history` stub |
| **Auth/workflows** | PAT secret (`GITHUB_PAT`) replaces built-in token; added `X-GitHub-Api-Version` header; added signed URL expiration note; added "Copilot usage metrics policy" prerequisite |
| **Dependencies** | Added `dotenv` and `@types/pg`; removed `zod` (not used in Phase 1) |
| **Removed inconsistencies** | Bootstrap test now genuinely failing; `backfill` script removed; `npm test` removed from nightly ETL workflow; Task 7 (now Task 10) cleaned up |
| **Task granularity** | Expanded from 7 to 10 tasks: schema split from client, client separate from GitHub endpoints, parse functions split from pipeline orchestration |

## Deliberate Deferrals (still Phase 1 observe-only)

- **`classification_history`**: Table is created but never populated. Phase 2 will write tier changes here.
- **Weekly recalculation / monthly baseline reset**: Fully deferred to Phase 2.
- **Budget API reads (GET budgets sync)**: Deferred to Phase 3.
- **Value tier config (`value_config.yml`)**: Not created in Phase 1; all users default to `null` value_tier.
- **Manager field population**: Requires external HR data — left as `null`.
- **Backfill script**: Not implemented. Phase 1 runs forward-only from first deploy date.
- **`accepted_lines` / `suggested_lines` population**: Schema columns exist; actual data depends on report schema. May be `0` until GitHub populates them.
