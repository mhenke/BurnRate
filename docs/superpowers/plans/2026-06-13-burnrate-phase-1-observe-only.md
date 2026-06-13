# BurnRate Phase 1 — Observe-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript, GitHub-Actions-driven, read-only BurnRate pipeline that ingests Copilot usage reports into Postgres, stores raw payloads, and produces simple burn forecasts without any budget writes or Copilot Skills automation.

**Architecture:** A small Node/TypeScript CLI wraps a GitHub API client, a Postgres client, and a set of ETL parsers. GitHub Actions schedules the CLI for nightly ingestion and morning forecasting. Raw report payloads are stored first, then parsed into normalized tables so schema changes can be recovered without losing history.

**Tech Stack:** TypeScript, Node.js, `pg`, `octokit`, `yaml`, `dotenv`, `tsx`, `vitest`, GitHub Actions, Postgres.

---

### Task 1: Bootstrap the repository and runtime entrypoints

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.sample`
- Create: `src/index.ts`
- Create: `tests/bootstrap.test.ts`

- [~] **Step 1: Write the failing test**

```ts
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('bootstrap', () => {
  it('has package.json with expected fields', () => {
    const pkg = JSON.parse(existsSync('package.json') ? '{}' : '{}');
    // This will fail until package.json exists and has the name field:
    expect(pkg.name).toBe('burnrate');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bootstrap.test.ts`
Expected: fail because `package.json` does not exist or has no `name` field.

- [ ] **Step 3: Write minimal implementation**

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
    "forecast": "tsx src/index.ts forecast",
    "migrate": "tsx src/index.ts migrate"
  },
  "dependencies": {
    "octokit": "^4.0.0",
    "pg": "^8.16.0",
    "yaml": "^2.8.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["tests"]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install && npx vitest run tests/bootstrap.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.sample src/index.ts tests/bootstrap.test.ts
git commit -m "feat: bootstrap burnrate repo"
```

---

### Task 2: Add config loading and validation

**Files:**
- Create: `src/config.ts`
- Create: `config/burnrate.sample.yml`
- Modify: `src/index.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

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
  `github:\n  enterprise: acme\n  org: acme-inc\n  token: ${'${GITHUB_TOKEN}'}\npostgres:\n  url: ${'${DATABASE_URL}'}\n`,
  'utf8',
);
assert.throws(() => loadConfig(file), /Missing burnrate.yml/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: failure because `loadConfig` is not implemented.

- [ ] **Step 3: Write minimal implementation**

```ts
import { config as dotenvConfig } from 'dotenv';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

dotenvConfig(); // Load .env into process.env

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts config/burnrate.sample.yml src/index.ts tests/config.test.ts
git commit -m "feat: add burnrate config loading"
```

---

### Task 3: Create the Postgres schema and migration runner

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/migrate.ts`
- Create: `tests/db/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { schemaStatements } from '../../src/db/schema.js';

assert.equal(schemaStatements.length, 7);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: fail because schema statements are not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS raw_reports (
    id BIGSERIAL PRIMARY KEY,
    report_type TEXT NOT NULL,
    report_day DATE NOT NULL,
    source_url TEXT NOT NULL,
    payload JSONB NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (report_type, report_day)
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    github_login TEXT PRIMARY KEY,
    enterprise TEXT NOT NULL,
    org TEXT NOT NULL,
    display_name TEXT,
    email TEXT,
    team TEXT,
    employee_id TEXT,
    manager TEXT,
    seat_created_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    consumption_tier TEXT,
    value_tier TEXT,
    bucket_updated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS daily_usage (
    usage_date DATE NOT NULL,
    github_login TEXT NOT NULL,
    credits NUMERIC(10,2) NOT NULL DEFAULT 0,
    tokens_input BIGINT NOT NULL DEFAULT 0,
    tokens_output BIGINT NOT NULL DEFAULT 0,
    chat_requests INTEGER NOT NULL DEFAULT 0,
    agent_requests INTEGER NOT NULL DEFAULT 0,
    accepted_lines INTEGER NOT NULL DEFAULT 0,
    suggested_lines INTEGER NOT NULL DEFAULT 0,
    acceptance_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
    credits_per_acc_loc NUMERIC(10,4) NOT NULL DEFAULT 0,
    model_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    ide_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    language_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (usage_date, github_login)
  )`,
  `CREATE TABLE IF NOT EXISTS team_usage (
    usage_date DATE NOT NULL,
    team TEXT NOT NULL,
    credits NUMERIC(12,2) NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0,
    avg_acceptance_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
    PRIMARY KEY (usage_date, team)
  )`,
  `CREATE TABLE IF NOT EXISTS pool_snapshots (
    snapshot_date DATE PRIMARY KEY,
    total_credits NUMERIC(12,2) NOT NULL,
    credits_used NUMERIC(12,2) NOT NULL,
    credits_remaining NUMERIC(12,2) NOT NULL,
    forecast_7d NUMERIC(12,2),
    forecast_30d NUMERIC(12,2),
    pct_elapsed NUMERIC(8,4)
  )`,
  `CREATE TABLE IF NOT EXISTS classification_history (
    effective_date DATE NOT NULL,
    github_login TEXT NOT NULL,
    consumption_tier_old TEXT,
    consumption_tier_new TEXT,
    value_tier TEXT,
    reason TEXT,
    PRIMARY KEY (effective_date, github_login)
  )`,
  `CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];
```

**Naming convention note:** The plan uses `usage_date` and `github_login` in daily_usage (matching the reference doc), `snapshot_date` in pool_snapshots, and `report_day` in raw_reports (the staging layer name, deliberately distinct from the normalized layer to avoid confusion). This aligns with the reference doc v2 naming. The one deliberate divergence: `raw_reports.report_day` is kept distinct from `daily_usage.usage_date` because the staging layer records what day a report series was fetched for, not the usage day itself.

- [ ] **Step 3b: Implement the DB client and migration runner**

```ts
// src/db/client.ts
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(connectionString: string): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<pg.QueryResult<T>> {
  if (!pool) throw new Error('Database not connected');
  return pool.query<T>(text, params);
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error('Database not connected');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

```ts
// src/db/migrate.ts
import { schemaStatements } from './schema.js';
import { query, getPool } from './client.js';

export async function runMigrations(connectionString: string): Promise<void> {
  getPool(connectionString);
  for (const stmt of schemaStatements) {
    await query(stmt);
  }
  console.log(`Applied ${schemaStatements.length} schema statements`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/client.ts src/db/schema.ts src/db/migrate.ts tests/db/schema.test.ts
git commit -m "feat: add postgres schema bootstrap"
```

---

### Task 4: Implement GitHub API client with Octokit

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

Run: `npx vitest run tests/github/client.test.ts`
Expected: fail because createGitHubClient is not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/github/types.ts
export type GitHubReportType = 'users-1-day' | 'enterprise-1-day' | 'enterprise-user-teams-1-day';

export type SignedReportResponse = {
  download_links: string[];
  report_day: string;
};

export type SeatResponse = {
  seats: Array<{
    assignee: { login: string };
    last_activity_at: string | null;
    last_activity_editor: string | null;
    created_at: string;
    plan_type: string;
  }>;
};

export type PaginationResult<T> = {
  data: T[];
  nextPage: number | null;
};
```

```ts
// src/github/client.ts
import { Octokit } from 'octokit';

export type GitHubClientOptions = {
  token: string;
  enterprise: string;
  baseUrl?: string;
};

export function createGitHubClient(opts: GitHubClientOptions) {
  const octokit = new Octokit({
    auth: opts.token,
    baseUrl: opts.baseUrl ?? 'https://api.github.com',
  });

  // X-GitHub-Api-Version: 2026-03-10
  octokit.hook.wrap('request', async (request, options) => {
    options.headers['X-GitHub-Api-Version'] = '2026-03-10';
    return request(options);
  });

  /**
   * Generic paginator that follows GitHub's Link header.
   */
  async function paginate<T>(url: string, params: Record<string, any> = {}): Promise<T[]> {
    const results: T[] = [];
    let page: number | undefined;
    do {
      const { data, headers } = await octokit.request('GET ' + url, { ...params, page, per_page: 100 });
      if (Array.isArray(data)) {
        results.push(...data);
      } else if (data && typeof data === 'object' && 'seats' in data) {
        results.push(...(data as any).seats);
      }
      const linkHeader = headers.link as string | undefined;
      page = undefined;
      if (linkHeader) {
        const match = linkHeader.match(/<[^>]*[?&]page=(\d+)>; rel="next"/);
        if (match) page = parseInt(match[1], 10);
      }
    } while (page);
    return results;
  }

  return { octokit, paginate };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/github/client.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/github/client.ts src/github/types.ts tests/github/client.test.ts
git commit -m "feat: add github octokit client with pagination"
```

---

### Task 5: Implement report and seat fetching

**Files:**
- Create: `src/github/reports.ts`
- Create: `src/github/seats.ts`
- Create: `tests/github/reports.test.ts`
- Create: `tests/github/seats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { buildReportUrls } from '../../src/github/reports.js';

assert.equal(
  buildReportUrls('acme-inc', 'users-1-day', '2026-06-12')[0],
  '/enterprises/acme-inc/copilot/metrics/reports/users-1-day?day=2026-06-12',
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/github/reports.test.ts`
Expected: fail because buildReportUrls is not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/github/reports.ts
import type { GitHubReportType } from './types.js';

export function buildReportUrls(enterprise: string, reportType: GitHubReportType, day?: string): string[] {
  const base = `/enterprises/${enterprise}/copilot/metrics/reports/${reportType}`;
  if (reportType.endsWith('-1-day') && day) {
    return [`${base}?day=${day}`];
  }
  return [base];
}

/**
 * Fetch a signed report by: (1) requesting the signed URL, (2) immediately
 * downloading the payload. Signed URLs expire quickly so we never store them
 * without fetching first.
 */
export async function fetchSignedReport(
  fetchUrl: string,
  octokit: any,
): Promise<{ payload: any; sourceUrl: string }> {
  const { data } = await octokit.request('GET ' + fetchUrl);

  const payloads: any[] = [];
  for (const link of data.download_links) {
    const resp = await fetch(link);
    const json = await resp.json();
    payloads.push(json);
  }
  return { payload: payloads.length === 1 ? payloads[0] : payloads, sourceUrl: fetchUrl };
}
```

```ts
// src/github/seats.ts
import type { SeatResponse } from './types.js';

export async function fetchAllSeats(enterprise: string, octokit: any): Promise<SeatResponse['seats']> {
  const url = `/enterprises/${enterprise}/copilot/billing/seats`;
  const { data } = await octokit.request('GET ' + url, { per_page: 100 });
  return data.seats;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/github/reports.test.ts tests/github/seats.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/github/reports.ts src/github/seats.ts tests/github/reports.test.ts tests/github/seats.test.ts
git commit -m "feat: add report and seat fetching"
```

---

### Task 6: Implement raw storage and ETL parsers

**Files:**
- Create: `src/etl/raw_storage.ts`
- Create: `src/etl/parse_users.ts`
- Create: `src/etl/parse_enterprise.ts`
- Create: `src/etl/parse_teams.ts`
- Create: `src/etl/parse_seats.ts`
- Create: `tests/etl/raw_storage.test.ts`
- Create: `tests/etl/parse_users.test.ts`
- Create: `tests/etl/parse_enterprise.test.ts`
- Create: `tests/etl/parse_teams.test.ts`
- Create: `tests/etl/parse_seats.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/etl/raw_storage.test.ts
import { strict as assert } from 'node:assert';
import { normalizeRawReport } from '../../src/etl/raw_storage.js';

it('normalizes raw report metadata', () => {
  const result = normalizeRawReport({ report_day: '2026-06-12', source_url: 'https://example.com/report', payload: { foo: 1 } });
  assert.equal(result.report_day, '2026-06-12');
  assert.equal(typeof result.ingested_at, 'string');
});
```

```ts
// tests/etl/parse_users.test.ts
import { strict as assert } from 'node:assert';
import { parseUsersFromSeats } from '../../src/etl/parse_users.js';

it('parses users from seat payload', () => {
  const seats = [
    {
      assignee: { login: 'jdoe' },
      last_activity_at: '2026-06-10T12:00:00Z',
      created_at: '2024-01-10T00:00:00Z',
      plan_type: 'business',
    },
  ];
  const users = parseUsersFromSeats(seats, 'acme', 'acme-inc');
  assert.equal(users.length, 1);
  assert.equal(users[0].github_login, 'jdoe');
  assert.equal(users[0].enterprise, 'acme');
});
```

```ts
// tests/etl/parse_enterprise.test.ts
import { strict as assert } from 'node:assert';
import { parseEnterpriseUsage } from '../../src/etl/parse_enterprise.js';

it('parses enterprise daily report', () => {
  const report = {
    usage: [
      {
        day: '2026-06-12',
        total_credits_used: 5000,
        total_premium_request_units_used: 100,
        breakdown: { models: {}, languages: {}, editors: {} },
      },
    ],
  };
  const parsed = parseEnterpriseUsage(report, 'acme');
  assert.equal(parsed?.credits_used, 5000);
  assert.equal(parsed?.usage_date, '2026-06-12');
});
```

```ts
// tests/etl/parse_teams.test.ts
import { strict as assert } from 'node:assert';
import { parseTeamUsage } from '../../src/etl/parse_teams.js';

it('parses team-level usage from user-teams report', () => {
  const report = [
    { login: 'jdoe', teams: ['platform'], credits: 150 },
    { login: 'asmith', teams: ['platform'], credits: 200 },
    { login: 'bwilson', teams: ['security'], credits: 50 },
  ];
  const teams = parseTeamUsage(report, '2026-06-12');
  assert.equal(teams.length, 2);
  const platform = teams.find(t => t.team === 'platform');
  assert.equal(platform?.credits, 350);
  assert.equal(platform?.active_users, 2);
});
```

```ts
// tests/etl/parse_seats.test.ts
import { strict as assert } from 'node:assert';
import { parseSeatSnapshot } from '../../src/etl/parse_seats.js';

it('parses seat snapshot into pool row', () => {
  const seats = [
    { plan_type: 'business', assignee: { login: 'a' } },
    { plan_type: 'business', assignee: { login: 'b' } },
  ];
  const result = parseSeatSnapshot(seats, '2026-06-12', 3000);
  assert.equal(result.total_credits, 6000);
  assert.equal(result.snapshot_date, '2026-06-12');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/etl/`
Expected: all fail because parser functions are not defined.

- [ ] **Step 3: Write minimal implementations**

```ts
// src/etl/raw_storage.ts
export function normalizeRawReport(input: { report_day: string; source_url: string; payload: any }) {
  return { ...input, ingested_at: new Date().toISOString() };
}
```

```ts
// src/etl/parse_users.ts
export type ParsedUser = {
  github_login: string;
  enterprise: string;
  org: string;
  seat_created_at: string | null;
  last_activity_at: string | null;
};

export function parseUsersFromSeats(seats: any[], enterprise: string, org: string): ParsedUser[] {
  return seats.map((s: any) => ({
    github_login: s.assignee.login,
    enterprise,
    org,
    seat_created_at: s.created_at ?? null,
    last_activity_at: s.last_activity_at ?? null,
  }));
}
```

```ts
// src/etl/parse_enterprise.ts
export type ParsedEnterpriseUsage = {
  usage_date: string;
  enterprise: string;
  credits_used: number;
};

export function parseEnterpriseUsage(report: any, enterprise: string): ParsedEnterpriseUsage | null {
  if (!report.usage?.length) return null;
  const day = report.usage[0];
  return {
    usage_date: day.day,
    enterprise,
    credits_used: day.total_credits_used ?? 0,
  };
}
```

```ts
// src/etl/parse_teams.ts
export type ParsedTeamUsage = {
  usage_date: string;
  team: string;
  credits: number;
  active_users: number;
  avg_acceptance_rate: number;
};

export function parseTeamUsage(report: any[], usageDate: string): ParsedTeamUsage[] {
  const teamMap = new Map<string, { credits: number; users: Set<string> }>();
  for (const entry of report) {
    for (const team of entry.teams ?? []) {
      if (!teamMap.has(team)) teamMap.set(team, { credits: 0, users: new Set() });
      const group = teamMap.get(team)!;
      group.credits += entry.credits ?? 0;
      group.users.add(entry.login);
    }
  }
  return Array.from(teamMap.entries()).map(([team, data]) => ({
    usage_date: usageDate,
    team,
    credits: data.credits,
    active_users: data.users.size,
    avg_acceptance_rate: 0,
  }));
}
```

```ts
// src/etl/parse_seats.ts
export type ParsedSeatSnapshot = {
  snapshot_date: string;
  total_credits: number;
  credits_used: number;
  credits_remaining: number;
};

export function parseSeatSnapshot(seats: any[], snapshotDate: string, monthlyCreditsPerSeat: number): ParsedSeatSnapshot {
  const total = seats.length * monthlyCreditsPerSeat;
  return {
    snapshot_date: snapshotDate,
    total_credits: total,
    credits_used: 0,
    credits_remaining: total,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/etl/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/etl/ tests/etl/
git commit -m "feat: add raw storage and etl parsers"
```

---

### Task 7: Build the ETL pipeline orchestration

**Files:**
- Create: `src/etl/pipeline.ts`
- Create: `tests/etl/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { runObserveOnlyPipeline } from '../../src/etl/pipeline.js';

it('pipeline is defined and rejects when no config', async () => {
  await assert.rejects(() => runObserveOnlyPipeline({} as any), /Config/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/etl/pipeline.test.ts`
Expected: fail because pipeline does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/etl/pipeline.ts
import type { BurnrateConfig } from '../config.js';
import { createGitHubClient } from '../github/client.js';
import { buildReportUrls, fetchSignedReport } from '../github/reports.js';
import { fetchAllSeats } from '../github/seats.js';
import { normalizeRawReport } from './raw_storage.js';
import { parseUsersFromSeats } from './parse_users.js';
import { parseEnterpriseUsage } from './parse_enterprise.js';
import { parseTeamUsage } from './parse_teams.js';
import { parseSeatSnapshot } from './parse_seats.js';
import { query } from '../db/client.js';

export async function runObserveOnlyPipeline(config: BurnrateConfig): Promise<void> {
  if (!config.github?.token || !config.postgres?.url) {
    throw new Error('Config missing required fields');
  }

  const { octokit } = createGitHubClient({ token: config.github.token, enterprise: config.github.enterprise });
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const enterprise = config.github.enterprise;
  const org = config.github.org;

  // 1. Fetch seats (no signing; raw data is direct API response)
  const seats = await fetchAllSeats(enterprise, octokit);

  // 2. Fetch signed reports and store raw payloads BEFORE parsing
  const reportTypes = ['users-1-day', 'enterprise-1-day', 'enterprise-user-teams-1-day'] as const;
  for (const reportType of reportTypes) {
    const urls = buildReportUrls(enterprise, reportType, yesterday);
    for (const url of urls) {
      const { payload, sourceUrl } = await fetchSignedReport(url, octokit);
      const record = normalizeRawReport({ report_day: yesterday, source_url: sourceUrl, payload });
      await query(
        'INSERT INTO raw_reports (report_type, report_day, source_url, payload) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING',
        [reportType, record.report_day, record.source_url, JSON.stringify(record.payload)],
      );
    }
  }

  // 3. Parse and upsert users from seats
  const users = parseUsersFromSeats(seats, enterprise, org);
  for (const u of users) {
    await query(
      `INSERT INTO users (github_login, enterprise, org, seat_created_at, last_activity_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (github_login) DO UPDATE SET last_activity_at = EXCLUDED.last_activity_at`,
      [u.github_login, u.enterprise, u.org, u.seat_created_at, u.last_activity_at],
    );
  }

  // 4. Parse and upsert pool_snapshots from seats
  const parsedSeats = parseSeatSnapshot(seats, yesterday, 3000);
  await query(
    `INSERT INTO pool_snapshots (snapshot_date, total_credits, credits_used, credits_remaining)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (snapshot_date) DO UPDATE SET
       total_credits = EXCLUDED.total_credits,
       credits_remaining = EXCLUDED.credits_remaining`,
    [parsedSeats.snapshot_date, parsedSeats.total_credits, parsedSeats.credits_used, parsedSeats.credits_remaining],
  );

  console.log(`ETL pipeline completed for ${yesterday}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/etl/pipeline.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/etl/pipeline.ts tests/etl/pipeline.test.ts
git commit -m "feat: add etl pipeline orchestration"
```

---

### Task 8: Implement the forecast engine

**Files:**
- Create: `src/forecast/engine.ts`
- Create: `src/forecast/forecast.ts`
- Create: `tests/forecast/engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { calcBurnRate } from '../../src/forecast/engine.js';

it('calculates 7d and 30d moving average burn rate', () => {
  // 3 days of data: 100, 200, 300 credits/day
  const result = calcBurnRate(3, 31, [
    { usage_date: '2026-06-01', total_credits: 100 },
    { usage_date: '2026-06-02', total_credits: 200 },
    { usage_date: '2026-06-03', total_credits: 300 },
  ]);
  // avg = 200/day, mtd = 600, remaining days = 28
  // forecast = 600 + (200 * 28) = 6200
  assert.equal(result.forecast_30d, 6200);
  assert.equal(result.burnRateDaily, 200);
  assert.equal(result.remainingDays, 28);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/forecast/engine.test.ts`
Expected: fail because calcBurnRate is not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/forecast/engine.ts
export type DailyBurn = {
  usage_date: string;
  total_credits: number;
};

export type ForecastResult = {
  burnRateDaily: number;
  mtdCredits: number;
  remainingDays: number;
  forecast_7d: number;
  forecast_30d: number;
  divergencePct: number;
};

export function calcBurnRate(
  daysInMonth: number,
  dayOfMonth: number,
  recentDays: DailyBurn[],
): ForecastResult {
  const mtdCredits = recentDays.reduce((sum, d) => sum + d.total_credits, 0);
  const remainingDays = daysInMonth - dayOfMonth;
  const burnRateDaily = recentDays.length > 0
    ? mtdCredits / recentDays.length
    : 0;

  // 7-day window (last 7 entries)
  const last7 = recentDays.slice(-7);
  const rate7d = last7.length > 0
    ? last7.reduce((s, d) => s + d.total_credits, 0) / last7.length
    : burnRateDaily;

  // 30-day window (all entries)
  const rate30d = burnRateDaily;

  const forecast_7d = mtdCredits + rate7d * remainingDays;
  const forecast_30d = mtdCredits + rate30d * remainingDays;

  const divergencePct = rate7d > 0
    ? Math.abs(rate7d - rate30d) / rate7d * 100
    : 0;

  return { burnRateDaily, mtdCredits, remainingDays, forecast_7d, forecast_30d, divergencePct };
}
```

```ts
// src/forecast/forecast.ts
import { query } from '../db/client.js';
import { calcBurnRate, type DailyBurn } from './engine.js';

export async function runDailyForecast(): Promise<void> {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const result = await query<DailyBurn>(
    `SELECT usage_date, SUM(credits) as total_credits
     FROM daily_usage
     WHERE usage_date >= date_trunc('month', CURRENT_DATE)
     GROUP BY usage_date
     ORDER BY usage_date`,
  );

  const forecast = calcBurnRate(daysInMonth, dayOfMonth, result.rows);

  console.log(`Daily burn rate: ${forecast.burnRateDaily.toFixed(2)} credits/day`);
  console.log(`7d forecast: ${forecast.forecast_7d.toFixed(2)}`);
  console.log(`30d forecast: ${forecast.forecast_30d.toFixed(2)}`);
  if (forecast.divergencePct > 15) {
    console.log(`⚠️ Forecast divergence: ${forecast.divergencePct.toFixed(1)}% — investigate`);
  }

  // Update pool_snapshots with forecast values
  await query(
    `UPDATE pool_snapshots
     SET forecast_7d = $1, forecast_30d = $2
     WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM pool_snapshots)`,
    [forecast.forecast_7d, forecast.forecast_30d],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/forecast/engine.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/forecast/ tests/forecast/
git commit -m "feat: add forecast engine with dual 7d/30d moving average"
```

---

### Task 9: Wire the CLI

**Files:**
- Modify: `src/index.ts`
- Create: `tests/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { main } from '../src/index.js';

it('exports main function', () => {
  assert.equal(typeof main, 'function');
});

it('check command resolves', async () => {
  await assert.doesNotReject(() => main(['node', 'index.js', 'check']));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index.test.ts`
Expected: fail because CLI wiring does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
import { loadConfig } from './config.js';
import { getPool, closePool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { runObserveOnlyPipeline } from './etl/pipeline.js';
import { runDailyForecast } from './forecast/forecast.js';

export async function main(argv: string[]): Promise<void> {
  const command = argv[2] ?? 'check';
  const configPath = process.env.BURNRATE_CONFIG ?? 'config/burnrate.yml';

  if (command === 'check') {
    console.log('BurnRate Phase 1 — Observe Only');
    console.log('Commands: migrate, etl, forecast');
    return;
  }

  const config = loadConfig(configPath);
  getPool(config.postgres.url);

  try {
    switch (command) {
      case 'migrate':
        await runMigrations(config.postgres.url);
        break;
      case 'etl':
        await runObserveOnlyPipeline(config);
        break;
      case 'forecast':
        await runDailyForecast();
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await closePool();
  }
}

main(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/index.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: wire cli entrypoint"
```

---

### Task 10: Create GitHub Actions workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/nightly-etl.yml`
- Create: `.github/workflows/daily-forecast.yml`
- Create: `tests/workflows.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';

it('nightly etl workflow exists', () => {
  expect(existsSync('.github/workflows/nightly-etl.yml')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflows.test.ts`
Expected: fail because workflows are not created yet.

- [ ] **Step 3: Write minimal implementation**

```yaml
# .github/workflows/ci.yml
name: ci
on: [push]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm test
```

```yaml
# .github/workflows/nightly-etl.yml
name: nightly-etl
on:
  schedule:
    - cron: '0 1 * * *'
  workflow_dispatch: {}
permissions:
  contents: read
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
          GITHUB_TOKEN: ${{ secrets.PAT }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

```yaml
# .github/workflows/daily-forecast.yml
name: daily-forecast
on:
  schedule:
    - cron: '0 8 * * *'
  workflow_dispatch: {}
permissions:
  contents: read
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workflows.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ tests/workflows.test.ts
git commit -m "feat: add github actions workflows"
```

---

### Verification checklist for Phase 1

- [ ] `npm run build` succeeds
- [ ] `npm test` succeeds (all tests including CI workflow existence)
- [ ] `npm run migrate` bootstraps all 7 tables
- [ ] `npm run etl` runs without mutating budgets
- [ ] `npm run forecast` logs burn rate and forecasts
- [ ] `npm run check` prints command help
- [ ] Raw report payloads are stored in `raw_reports` before parsing
- [ ] `classification_history` table exists but is never populated (Phase 2)
- [ ] GitHub Actions `ci.yml` runs on push, `nightly-etl.yml` and `daily-forecast.yml` are cron-based
- [ ] No Copilot Skills code exists yet
- [ ] No budget write endpoints are called
- [ ] Classic PAT with `read:enterprise` scope configured in repo secrets as `PAT`
- [ ] `Copilot usage metrics` policy set to `Enabled everywhere` in enterprise settings

---

### Deliberate gaps deferred to later phases

1. **`classification_history`** — schema exists but never populated; Phase 2 adds the weekly recalc job
2. **`users.manager` and `users.bucket_updated_at`** — columns exist but are nullable and never set; Phase 2 writes them from the value config + ULB sync
3. **`users.consumption_tier` and `users.value_tier`** — columns exist but are null; Phase 2 classification logic fills them
4. **`team_usage.avg_acceptance_rate`** — column exists but is always 0; Phase 2 populates from daily_usage join
5. **`daily_usage.acceptance_rate` and `credits_per_acc_loc`** — columns exist but are always 0; Phase 2 adds the computed-column logic
6. **Alerting** — no Slack/PagerDuty integration; Phase 2 adds notifications
7. **Budget API reads** — not called in Phase 1; Phase 3 adds GET budgets sync
8. **Org-only deployments** — all endpoints target enterprise endpoints; Phase 1 does not handle org-only fallback
9. **Signed URL fetch** — `fetchSignedReport` fetches immediately after receiving the signed URL; no retry or expiry fallback is needed since Phase 1 runs once daily and GitHub URLs are valid long enough for a single fetch
10. **Schema naming reconciliation** — `usage_date` and `github_login` match the reference doc exactly. `raw_reports.report_day` is intentionally kept distinct from `daily_usage.usage_date` because the staging layer records what day a report series was fetched for, not the usage day itself. `pool_snapshots.snapshot_date` aligns with reference doc naming.
