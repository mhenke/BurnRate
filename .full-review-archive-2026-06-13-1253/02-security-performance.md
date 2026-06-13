# Phase 2: Security & Performance Review

## Security Findings

### High
- **YAML Structure Hijacking / Injection in Config Loader** (`src/config.ts` L12-14):
  Environment variables are expanded directly on the raw configuration file text before parsing as YAML. A variable containing YAML syntax can hijack configuration settings (e.g., redirecting `github.token` or `postgres.url`).
- **Server-Side Request Forgery (SSRF) in Signed URL Downloader** (`src/github/client.ts` L21-28):
  `fetchSignedUrl` fetches arbitrary URLs provided by report payloads without validation, enabling coercion of requests to internal metadata endpoints.
- **Known High-Severity Vulnerabilities in `esbuild` Dependency** (`package.json` / devDependencies):
  Outdated versions of `drizzle-kit` and `vitest` pull in `esbuild <= 0.28.0` which is vulnerable to DNS Rebinding, Remote Code Execution, and Arbitrary File Reads.

### Medium
- **Non-Transactional Database Operations in ETL Pipeline** (`src/etl/pipeline.ts` L102-191, 216-240):
  The pipeline inserts and updates multiple tables in separate operations without transactions, risking database corruption and forecast skew if interrupted.
- **Uncaught Parser Exceptions Leading to Denial of Service (DoS)** (`src/etl/parse_enterprise.ts` L35-36, `src/etl/parse_teams.ts` L40):
  Lack of exception handling on type coercions (`BigInt` and `Number`) can crash the ETL pipeline execution if a feed format contains floats or malformed numbers.
- **Division-by-Zero in Forecast Engine** (`src/forecast/engine.ts` L36-37):
  Calculating utilization percentages divides by `poolTotal` without checking if it is `0` or negative, leading to false critical alerts (`Infinity`) or bypassed alerts (negative percentages).

### Low
- **Improper Neutralization of SQL Commands via `sql.raw` in CLI Helper** (`src/index.ts` L79-87):
  CLI commands bypass ORM parameterization using `sql.raw`, which could lead to SQL Injection in the future if user input is interpolated.
- **Uncleaned Temporary Directories in Test Suites** (`tests/config.test.ts` L10-11, L32-33):
  Tests call `mkdtempSync` but never clean up the generated temp directories.

---

## Performance Findings

### Critical
- **$O(N^2)$ Complexity in Classification Engine** (`src/classify/engine.ts` L43-48, 105-129):
  For each user record, the classifier runs a `.filter()` scan over the entire `sortedCredits` array. For 50,000 active users, this causes $2.5 \times 10^9$ inner-loop iterations, blocking Node's single-threaded event loop for minutes.

### High
- **Missing Database Indexes on High-Volume Tables** (`src/db/schema.ts`):
  Lack of individual indexes on `daily_usage(usage_date)`, `daily_usage(github_login)`, and `users(team)` leads to full table sequential scans as the tables grow.
- **Sequential Database Writes and Lack of Batching** (`src/classify/runner.ts` L115-162):
  Updates user states sequentially inside a loop rather than using bulk operations or transaction bundling, yielding poor write throughput (~50 writes/sec on SQLite).
- **In-Memory Buffering of Large JSON Payloads** (`src/github/client.ts` L21-28, `src/etl/pipeline.ts` L85-90):
  Large daily enterprise JSON reports (50MB+) are loaded and parsed fully in-memory, causing large memory footprint spikes (up to 500MB) due to V8 object overhead and risking Out-of-Memory (OOM) crashes.

### Medium
- **Lack of SQLite Concurrency & Sync Optimization** (`src/db/client.ts` L16-20):
  SQLite uses default synchronous/journaling settings, causing writes to block concurrent reads and slowing down sequential disk transactions.
- **Hardcoded Postgres Connection Pool Limit** (`src/db/client.ts` L14):
  PostgreSQL connection pool max size is hardcoded to 5, which can lead to starvation under parallel scheduler execution.
- **Unbounded Array Allocation in Seats Pagination** (`src/github/seats.ts` L4-18):
  Creates a single large array of 50,000+ seat objects in memory, generating high heap utilization and garbage collection latency.

### Low
- **Redundant Month-to-Date Database Scan** (`src/index.ts` L129-148):
  Near the start of a month, the query fetches 30 days of data, only to filter out up to 29 days in-memory.

---

## Critical Issues for Phase 3 Context

1. **Test Coverage Gaps for Vulnerability Remediation**:
   Test cases must be added or enhanced to verify the following security boundaries:
   - Configuration loader handles invalid and structural injection attempts.
   - Downloader correctly throws exceptions on non-whitelisted/non-HTTPS targets.
   - Parser components correctly catch float parsing errors without throwing uncaught exceptions.
   - Forecast engine handles pool sizes `<= 0` gracefully.
2. **Performance/Load testing**:
   The $O(N^2)$ algorithm must be tested with large array datasets to prevent performance regressions.
3. **Database Transaction Testing**:
   Tests must be written to verify that partial failures in the ETL pipeline trigger database rollback.
