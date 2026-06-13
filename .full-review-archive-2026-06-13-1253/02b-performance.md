# BurnRate Performance and Scalability Analysis

This document contains a comprehensive performance and scalability analysis of the BurnRate codebase. It evaluates database efficiency, memory consumption, caching opportunities, I/O bottlenecks, concurrency issues, and overall scalability under enterprise workloads.

---

## Executive Summary

A review of the active codebase revealed **8 key performance and scalability findings** ranging from **Critical** to **Low** severity.

The most critical issue is an **algorithmic complexity bottleneck ($O(N^2)$)** in the user classification engine. For large enterprise clients (50,000+ seats), this blocks Node's single-threaded event loop, leading to high CPU usage, task timeouts, and potential process crashes.

Other high-impact findings include **missing database indexes** on high-volume tables (which will degrade query performance as data grows to millions of rows), **sequential disk/network database writes** in loops that lead to poor write throughput, and **in-memory buffering of large JSON payloads** causing memory footprint spikes.

### Summary of Findings

| ID | Title | Severity | Estimated Performance Impact |
| :--- | :--- | :--- | :--- |
| **1** | [O(N^2) Complexity in Classification Engine](#1-critical-on2-complexity-in-classification-engine) | **Critical** | Blocks event loop for minutes; causes CPU/process timeouts. |
| **2** | [Missing Indexes on High-Volume Tables](#2-high-missing-database-indexes-on-high-volume-tables) | **High** | Sequential scans on millions of rows; high query latency. |
| **3** | [Sequential DB Writes and Lack of Batching](#3-high-sequential-database-writes-and-lack-of-batching) | **High** | $O(N)$ database roundtrips/syncs; turns ms writes into 30+ seconds. |
| **4** | [In-Memory Buffering of Massive JSON Payloads](#4-high-in-memory-buffering-of-large-json-payloads) | **High** | RAM spikes up to 400-500MB+; causes V8 OOM crashes. |
| **5** | [Lack of SQLite Concurrency & Sync Optimization](#5-medium-lack-of-sqlite-concurrency-and-performance-tuning) | **Medium** | Database locking on write; synchronous disk blocks. |
| **6** | [Hardcoded Postgres Connection Pool Limit](#6-medium-hardcoded-postgres-connection-pool-limit) | **Medium** | Connection pool starvation; query queue delays under load. |
| **7** | [Unbounded Array Allocation in Seats Pagination](#7-medium-unbounded-array-allocation-in-github-seats-pagination) | **Medium** | High heap memory allocation; garbage collection churn. |
| **8** | [Redundant Month-to-Date Database Scan](#8-low-redundant-month-to-date-database-scan) | **Low** | Unnecessary IO/memory overhead when calculating MTD near month-start. |

---

## Detailed Findings

### 1. Critical: $O(N^2)$ Complexity in Classification Engine
* **Location:** `src/classify/engine.ts` (lines 43-48, 105-129)
* **Severity:** Critical
* **Estimated Performance Impact:** Extremely High. For an enterprise with 50,000 active users, this logic causes $2.5 \times 10^9$ inner-loop iterations. In Node's single-threaded environment, this blocks the event loop for several minutes, triggers CPU timeouts, halts other asynchronous processes, and can cause memory-constrained execution environments to crash.
* **Description:**
  For each user record, `classifyUsers` calls `computePercentile`, which runs a `.filter()` over the entire `sortedCredits` array:
  ```typescript
  function computePercentile(sortedCredits: number[], credits: number): number {
    if (sortedCredits.length === 0) return 0;
    const count = sortedCredits.filter(c => c <= credits).length;
    return count / sortedCredits.length;
  }
  ```
  Since `classifyUsers` iterates through all elements of `userCredits` (length $N$), this results in $N$ filter operations, each of which iterates through `sortedCredits` (length $N$), leading to a time complexity of **$O(N^2)$**.
* **Optimization Recommendation:**
  Since `sortedCredits` is already sorted, we can build a percentile lookup map in a single $O(N)$ pass. Alternatively, we can use binary search ($O(\log N)$). The single-pass map lookup is the most performant, reducing complexity to **$O(N \log N)$** (from sorting) and **$O(N)$** for classification.

  ```typescript
  // Recommended Fix
  export function classifyUsers(
    userCredits: UserCredits[],
    currentUsers: CurrentUser[],
    config: { resolveValueTier: (team: string | null) => string },
    reason: string,
  ): ClassifyResult {
    const totalUsers = userCredits.length;
    const sortedCredits = userCredits.map(u => u.totalCredits).sort((a, b) => a - b);
    
    // Precompute percentiles in a single O(N) pass
    const percentileMap = new Map<number, number>();
    for (let i = 0; i < totalUsers; i++) {
      const val = sortedCredits[i];
      // Since it's sorted, the count of elements <= val is the index + 1 of the last occurrence
      if (i === totalUsers - 1 || sortedCredits[i + 1] !== val) {
        percentileMap.set(val, (i + 1) / totalUsers);
      }
    }

    // ... in loop:
    for (const uc of userCredits) {
      const percentile = percentileMap.get(uc.totalCredits) ?? 0;
      const consumptionTier = assignConsumptionTier(percentile);
      // ...
    }
  }
  ```

---

### 2. High: Missing Database Indexes on High-Volume Tables
* **Location:** `src/db/schema.ts` (and `src/db/migrate.ts`)
* **Severity:** High
* **Estimated Performance Impact:** High. As daily usage rows grow (e.g., 50k users * 30 days = 1.5 million rows), daily usage queries will degrade rapidly. Query execution times will spike from less than 10 milliseconds to several seconds, saturating database server CPU.
* **Description:**
  Tables lack critical indexes for frequent query operations:
  1. `daily_usage` has a composite unique constraint/index on `(usage_date, github_login)`. However, queries that look up user histories filter by `github_login` alone, which cannot use this index.
  2. Aggregations (e.g., in `src/classify/runner.ts` and `src/index.ts`) query by a range of `usage_date` and group by `github_login` or `usage_date`. Without individual indexes on `usage_date` and `github_login`, databases must perform full table scans.
  3. Joins on `users.team` during classification require full table scans on `users` because `team` is unindexed.
* **Optimization Recommendation:**
  Add indexes to `daily_usage(usage_date)`, `daily_usage(github_login)`, and `users(team)` in both PG and SQLite definitions.

  ```typescript
  // Recommended Fix (PostgreSQL example in schema.ts)
  import { index } from 'drizzle-orm/pg-core';

  export const dailyUsagePg = pgTable('daily_usage', {
    usageDate: pgDate('usage_date').notNull(),
    githubLogin: pgText('github_login').notNull(),
    // ...
  }, (t) => [
    pgUnique('daily_usage_date_login_pk').on(t.usageDate, t.githubLogin),
    index('daily_usage_date_idx').on(t.usageDate),
    index('daily_usage_login_idx').on(t.githubLogin),
  ]);

  export const usersPg = pgTable('users', {
    githubLogin: pgText('github_login').primaryKey(),
    team: pgText('team'),
    // ...
  }, (t) => [
    index('users_team_idx').on(t.team),
  ]);
  ```

---

### 3. High: Sequential Database Writes and Lack of Batching
* **Location:** `src/classify/runner.ts` (lines 115-162)
* **Severity:** High
* **Estimated Performance Impact:** High. In SQLite, executing queries sequentially in a loop results in $O(N)$ write transactions, each requiring physical disk syncs. In Postgres, sequential `await` updates result in $O(N)$ network/IPC roundtrips. This degrades write throughput from thousands of rows per second to less than 50 rows per second.
* **Description:**
  When writing classification updates, the runner loops over `result.changes` and executes updates and inserts sequentially:
  ```typescript
  for (const change of result.changes) {
    await db.update(usersSq).set(...).where(...);
    await db.insert(classificationHistorySq).values(...);
  }
  ```
* **Optimization Recommendation:**
  1. Wrap SQLite writes in an explicit transaction so they commit to disk in a single disk sync.
  2. Bulk insert `classification_history` in a single multi-row insert.
  3. Batch or run the user updates concurrently in chunks (e.g., using `Promise.all` with limited concurrency).

  ```typescript
  // Recommended Fix (runner.ts)
  const historyRows = result.changes.map(change => ({
    effectiveDate,
    githubLogin: change.githubLogin,
    consumptionTierOld: change.consumptionTierOld,
    consumptionTierNew: change.consumptionTierNew,
    valueTier: change.valueTierNew,
    reason: change.reason,
  }));

  // Bulk insert history (1 trip)
  if (historyRows.length > 0) {
    await tx.insert(T.classificationHistory).values(historyRows).onConflictDoNothing();
  }

  // Batch updates in chunks of 100 in parallel
  const chunkSize = 100;
  for (let i = 0; i < result.changes.length; i += chunkSize) {
    const chunk = result.changes.slice(i, i + chunkSize);
    await Promise.all(chunk.map(change =>
      tx.update(T.users)
        .set({
          consumptionTier: change.consumptionTierNew,
          valueTier: change.valueTierNew,
          bucketUpdatedAt: now,
          updatedAt: updateNow,
        })
        .where(eq(T.users.githubLogin, change.githubLogin))
    ));
  }
  ```

---

### 4. High: In-Memory Buffering of Large JSON Payloads
* **Location:** `src/github/client.ts` (lines 21-28), `src/etl/pipeline.ts` (lines 85-90)
* **Severity:** High
* **Estimated Performance Impact:** High. For large enterprises with 50,000+ seats, daily reports uncompress to 50MB-100MB+ JSON payloads. Parsing this using `response.json()` consumes 4x-5x that space in heap memory as V8 objects, leading to memory spikes of 300MB-500MB. This risks Out-Of-Memory (OOM) crashes in memory-constrained containers or serverless runtimes.
* **Description:**
  Reports are fully downloaded and buffered in memory before being parsed:
  ```typescript
  async function fetchSignedUrl<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) { ... }
    return response.json() as Promise<T>;
  }
  ```
* **Optimization Recommendation:**
  Use streaming parsers (such as `stream-json` or `JSONStream`) to process incoming reports without loading the entire JSON file into the application heap at once.
  ```typescript
  // Recommended Fix: Stream and process in chunks
  import { parser } from 'stream-json';
  import { streamArray } from 'stream-json/streamers/StreamArray';

  // Parse streams chunk-by-chunk rather than response.json()
  const response = await fetch(url);
  const reader = response.body?.getReader();
  // Pass stream to streaming JSON parser
  ```

---

### 5. Medium: Lack of SQLite Concurrency and Performance Tuning
* **Location:** `src/db/client.ts` (lines 16-20)
* **Severity:** Medium
* **Estimated Performance Impact:** Medium. Standard SQLite write locking blocks concurrent readers. Lack of caching or incorrect synchronous modes limits write throughput on SQLite databases.
* **Description:**
  The SQLite client (`better-sqlite3`) is initialized with default settings. It uses default rollback journal mode and full fsyncs.
* **Optimization Recommendation:**
  Configure Write-Ahead Logging (WAL) mode to allow concurrent reads during writes. Tune the cache size, temporary storage location, and busy timeout pragmas.

  ```typescript
  // Recommended Fix (client.ts)
  sqliteDb = new Database(connectionString === ':memory:' ? ':memory:' : connectionString);
  if (connectionString !== ':memory:') {
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('synchronous = NORMAL');
    sqliteDb.pragma('cache_size = 2000'); // 8MB cache
    sqliteDb.pragma('temp_store = MEMORY');
    sqliteDb.pragma('busy_timeout = 5000'); // Prevent SQLITE_BUSY locking issues
  }
  db = drizzleSqlite({ client: sqliteDb });
  ```

---

### 6. Medium: Hardcoded Postgres Connection Pool Limit
* **Location:** `src/db/client.ts` (line 14)
* **Severity:** Medium
* **Estimated Performance Impact:** Medium. A pool limit of 5 is highly restrictive under concurrency. In a multi-tenant web application or parallel scheduled worker setup, this will cause queries to queue, leading to connection timeouts.
* **Description:**
  The PostgreSQL connection pool size is hardcoded:
  ```typescript
  pgPool = new pg.Pool({ connectionString, max: 5 });
  ```
* **Optimization Recommendation:**
  Expose the connection pool limit to environment variables, allowing database administrators or operators to configure it based on deployment capacity.

  ```typescript
  // Recommended Fix (client.ts)
  const maxPool = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10;
  pgPool = new pg.Pool({
    connectionString,
    max: maxPool,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
  ```

---

### 7. Medium: Unbounded Array Allocation in GitHub Seats Pagination
* **Location:** `src/github/seats.ts` (lines 4-18)
* **Severity:** Medium
* **Estimated Performance Impact:** Medium. Creating a single in-memory array of 50,000+ seat objects results in high heap allocation and high garbage collection latency.
* **Description:**
  `fetchAllSeats` pulls pages of seats and appends them to a single array:
  ```typescript
  const seats: CopilotSeat[] = [];
  for await (const response of client.octokit.paginate.iterator(...)) {
    seats.push(...response.data.seats);
  }
  return seats;
  ```
* **Optimization Recommendation:**
  Use a generator/iterator pattern or a callback function (`processAllSeats`) so pages can be processed and garbage-collected sequentially.

  ```typescript
  // Recommended Fix (seats.ts)
  export async function processAllSeats(
    client: GitHubClient,
    onBatch: (seats: CopilotSeat[]) => Promise<void>
  ): Promise<void> {
    for await (const response of client.octokit.paginate.iterator(
      (client.octokit.rest as any).enterpriseAdmin.listCopilotSeatsForEnterprise,
      { enterprise: client.enterprise, per_page: 100 },
    )) {
      const data = response.data as { seats?: CopilotSeat[] };
      if (data.seats && data.seats.length > 0) {
        await onBatch(data.seats);
      }
    }
  }
  ```

---

### 8. Low: Redundant Month-to-Date Database Scan
* **Location:** `src/index.ts` (lines 129-148)
* **Severity:** Low
* **Estimated Performance Impact:** Low. Near the start of a month, the query fetches 30 days of data, only to filter out up to 29 days in-memory. This results in redundant SQL processing and network I/O.
* **Description:**
  The forecast command fetches 30 days of usage from the database but only uses the rows starting from the first day of the current month to calculate MTD credits:
  ```typescript
  const rows = await runQuery<{ usage_date: string; credits: any }>(db, query);
  const creditsUsedMtd = rows
    .filter(r => r.usage_date >= firstOfMonth)
    .reduce((sum, r) => sum + Number(r.credits), 0);
  ```
* **Optimization Recommendation:**
  Instead of pulling 30 days of data and filtering in-memory, query specifically for the MTD sum in a separate count query, or retrieve only the target month's data using two separate, optimized queries.

  ```typescript
  // Recommended Fix (index.ts)
  // Query only the required rows or sum directly in the database
  const mtdQuery = isSqlite
    ? `SELECT SUM(credits) as totalMtd FROM daily_usage WHERE usage_date >= '${firstOfMonth}'`
    : `SELECT SUM(credits) as totalMtd FROM daily_usage WHERE usage_date >= '${firstOfMonth}'`;
  ```

---

## Scalability and Architectural Recommendations

1. **Horizontal Scaling:** The state of the system is stored fully within the database, which is good for scaling out the application layer. However, SQLite lacks multi-instance concurrent write support. As the system scales, transitioning fully to PostgreSQL is required.
2. **Cron Scheduler and ETL Concurrency:** The ETL pipeline fetches metrics for a single date. If running in a clustered environment, ensure only one ETL instance is active at a time to prevent duplicate API requests, rate-limiting locks, and concurrent write deadlocks.
3. **Caching Database Queries:** For CLI outputs (e.g., forecasting reports), the underlying data (`daily_usage`, `pool_snapshots`) changes only once a day after the ETL pipeline runs. Caching the computed forecast results in a table or a Redis key (if a server is introduced) would completely eliminate database and classification workload overhead for status commands.
