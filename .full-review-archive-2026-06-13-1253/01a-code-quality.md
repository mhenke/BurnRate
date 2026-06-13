# BurnRate Code Quality Review

This document contains a comprehensive analysis of the BurnRate codebase targeting complexity, maintainability, clean code principles, code duplication, and error handling.

---

## Executive Summary

A review of the active codebase revealed **9 key findings** ranging from **Critical** to **Low** severity. 

The most urgent issue is a **Critical logical bug** in the Month-to-Date (MTD) credits calculation, which makes invalid assumptions about query result sizing and day offsets, leading to incorrect calculations and potential negative index queries.

Another major area of concern is **High-severity code duplication** across the ETL pipeline. Due to a manual, dialect-based database branching pattern (`isSqlite`), the database insertion logic is cloned for Postgres and SQLite schemas. This can be resolved with elegant schema mappings, improving maintainability.

Additionally, the review identified several **Medium-severity** issues concerning the lack of transactional safety in the pipeline, unsafe type casting/usage of `any`, and error-swallowing behaviors in API calls.

---

## Detailed Findings

### 1. Critical: Logical Bug in Month-to-Date (MTD) Credits Calculation
* **Location:** `src/index.ts` (lines 70-72)
* **Severity:** Critical
* **Description:** 
  The calculation of `creditsUsedMtd` relies on array indexes and the current day of the month:
  ```typescript
  const dailyCredits = rows.map((r) => Number(r.credits));
  const creditsUsedMtd = dailyCredits
    .filter((_, i) => i >= rows.length - new Date().getDate())
    .reduce((a, b) => a + b, 0);
  ```
  This logic introduces two fatal flaws:
  1. **Missing Data Vulnerability:** It assumes the database has returned exactly one record per day. If any day is missing (e.g., weekends without usage or missing ETL runs), `rows.length` will be smaller than `new Date().getDate()`. This causes `rows.length - new Date().getDate()` to be negative, making the filter condition `i >= negative_number` evaluate to `true` for every single row. The calculation then returns all usage records, including those from the previous month.
  2. **Data Out of Sync:** If the data query does not end precisely on the current day, mapping index limits directly to calendar days results in offset drift.
* **Recommendation:** 
  Filter the retrieved rows dynamically by comparing their calendar date string against the first day of the current month. This makes the code immune to missing records or array sizing issues.
  
  ```typescript
  // Recommended Fix
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const startOfMonthStr = `${year}-${month}-01`;

  const creditsUsedMtd = rows
    .filter((r) => r.usage_date >= startOfMonthStr)
    .reduce((sum, r) => sum + Number(r.credits), 0);
  ```

---

### 2. High: Dialect Branching and Code Duplication in ETL Pipeline
* **Location:** `src/etl/pipeline.ts` (lines 72-208, 226-276)
* **Severity:** High
* **Description:** 
  The codebase branches heavily using the variable `isSqlite`. It duplicates all insert operations, conflict resolution policies, and SQL templates for both SQLite and PostgreSQL tables (e.g., `usersSq` vs `usersPg`, `dailyUsageSq` vs `dailyUsagePg`, etc.).
  
  This violates DRY (Don't Repeat Yourself) principles. Any schema modification or changes to conflict resolution requires updates to two separate blocks of copy-pasted code.
* **Recommendation:** 
  Extract the tables and database helpers dynamically before executing the queries. Since the table columns share the same properties, a dynamic resolver keeps the logic unified and simple.

  ```typescript
  // Recommended Fix
  import {
    rawReportsPg, rawReportsSq,
    usersPg, usersSq,
    dailyUsagePg, dailyUsageSq,
    teamUsagePg, teamUsageSq
  } from '../db/schema.js';

  // Dynamic table mapping based on connection type
  const rawReports = isSqlite ? rawReportsSq : rawReportsPg;
  const users = isSqlite ? usersSq : usersPg;
  const dailyUsage = isSqlite ? dailyUsageSq : dailyUsagePg;
  const teamUsage = isSqlite ? teamUsageSq : teamUsagePg;

  const updateNow = isSqlite ? sql`CURRENT_TIMESTAMP` : sql`now()`;
  const usersTarget = isSqlite ? usersSq.githubLogin : usersPg.githubLogin;

  // Now write single, clean, reusable query calls:
  await db.insert(rawReports)
    .values({
      reportType: rawRow.report_type,
      reportDay: rawRow.report_date,
      sourceUrl: rawRow.source_url,
      payload: rawRow.payload,
    })
    .onConflictDoNothing();

  if (reportType === 'enterprise-1-day' && userRows.length > 0) {
    await db.insert(users)
      .values(userRows)
      .onConflictDoUpdate({
        target: usersTarget,
        set: {
          enterprise: sql`excluded.enterprise`,
          org: sql`excluded.org`,
          displayName: sql`excluded.display_name`,
          email: sql`excluded.email`,
          team: sql`excluded.team`,
          seatCreatedAt: sql`excluded.seat_created_at`,
          lastActivityAt: sql`excluded.last_activity_at`,
          consumptionTier: sql`excluded.consumption_tier`,
          valueTier: sql`excluded.value_tier`,
          updatedAt: updateNow
        }
      });
  }
  ```

---

### 3. High: Error Swallowing during API Fetches in ETL Pipeline
* **Location:** `src/etl/pipeline.ts` (lines 47-50, 57-60, 213-216)
* **Severity:** High
* **Description:** 
  The pipeline fetches report metadata and payloads from GitHub, catching all errors, writing them to `console.error`, and returning `null`:
  ```typescript
  const reportData = await fetchReport(gh, reportType, day).catch((err) => {
    console.error(`Failed to fetch report ${reportType}:`, err);
    return null;
  });
  ```
  If an API call fails due to invalid credentials, rate-limiting, or network downtime, the pipeline ignores the error, continues executing, and reports successful execution. This results in silent omissions and data corruption.
* **Recommendation:** 
  Do not swallow critical exceptions in background processing jobs. Allow errors to propagate, or collect them in an error list and throw a combined exception at the end of the run so the CLI returns a non-zero exit code.
  
  ```typescript
  // Recommended Fix
  try {
    const reportData = await fetchReport(gh, reportType, day);
    if (!reportData || !Array.isArray(reportData.download_links)) {
      throw new Error(`Invalid report format or missing download links for ${reportType}`);
    }
    // ...
  } catch (err) {
    throw new Error(`ETL Pipeline failed fetching ${reportType} report for ${day}: ${(err as Error).message}`, { cause: err });
  }
  ```

---

### 4. Medium: Missing Database Transactions for ETL Upserts
* **Location:** `src/etl/pipeline.ts` (lines 35-280)
* **Severity:** Medium
* **Description:** 
  `runObserveOnlyPipeline` performs many distinct database insert queries. If a failure occurs midway (e.g., database connection issues, primary key violations, or format errors), the database remains in a partially updated state.
  
  This violates the transactional requirements defined in `AGENTS.md`: *"Use database transactions (via the Drizzle client) for multi-statement inserts or updates."*
* **Recommendation:** 
  Wrap the body of `runObserveOnlyPipeline` inside a Drizzle transaction.
  
  ```typescript
  // Recommended Fix
  export async function runObserveOnlyPipeline(
    gh: GitHubClient,
    db: DbClient,
    day: string,
  ): Promise<PipelineResult> {
    const result: PipelineResult = { rawStored: 0, usageUpserted: 0 };
    
    await db.transaction(async (tx) => {
      // Perform all insertions using 'tx' instead of 'db' to ensure atomicity
      // ...
    });

    return result;
  }
  ```

---

### 5. Medium: Division-by-Zero and NaN Risks in Forecast Engine
* **Location:** `src/forecast/engine.ts` (lines 25-59)
* **Severity:** Medium
* **Description:** 
  The forecast engine calculates percentages based on `poolTotal`:
  ```typescript
  const pctOfPool7d = (forecast7d / input.poolTotal) * 100;
  ```
  If the `pool_snapshots` table is empty or has a record with `total_credits = 0`, `input.poolTotal` will be `0`. This results in `pctOfPool7d` evaluating to `Infinity` or `NaN`. The subsequent comparisons (`maxPct >= 110`) trigger false alarms or lead to writing corrupted data to reports/databases.
* **Recommendation:** 
  Add guards to handle zero or negative values for `poolTotal` and `daysElapsed`.
  
  ```typescript
  // Recommended Fix
  const pctOfPool7d = input.poolTotal > 0 ? (forecast7d / input.poolTotal) * 100 : 0;
  const pctOfPool30d = input.poolTotal > 0 ? (forecast30d / input.poolTotal) * 100 : 0;
  ```

---

### 6. Medium: Bypassed Type Safety (`any` usage)
* **Location:** Multiple files (`src/db/client.ts` L6, `src/db/migrate.ts` L145, `src/index.ts` L17, `src/etl/parse_enterprise.ts` L23, `src/github/reports.ts` L23)
* **Severity:** Medium
* **Description:** 
  The codebase uses `any` for core data objects and query parameters. For example:
  * `export type DbClient = any;` in `src/db/client.ts` disables type safety on every database transaction.
  * In the parse functions: `report.data.map((entry: any) => { ... })` disables linting and autocomplete on raw report entry structures.
  
  This violates the rule in `AGENTS.md`: *"DO specify explicit types for all interfaces, parameters, and return types (no implicit `any`)."*
* **Recommendation:** 
  Provide explicit type declarations.
  
  ```typescript
  // Recommended Fix for DbClient
  import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
  import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

  export type DbClient = NodePgDatabase<Record<string, never>> | BetterSQLite3Database<Record<string, never>>;
  ```
  For reports, define the expected schema shape instead of `any`.

---

### 7. Low: Weak Input Parsing and Sanitization in Parsers
* **Location:** `src/etl/parse_enterprise.ts` (lines 24-26, 35), `src/etl/parse_teams.ts` (lines 15-16)
* **Severity:** Low
* **Description:** 
  Values in parsers are directly coerced using `Number(entry.credits_used)` and `BigInt(entry.tokens_input)`. If the GitHub API returns an unexpected non-numeric format, `Number` results in `NaN`, and `BigInt` throws a runtime `SyntaxError`.
* **Recommendation:** 
  Implement safe conversion utilities to wrap parsing operations.
  
  ```typescript
  // Recommended Fix
  function safeNumber(value: unknown, fallback = 0): number {
    if (value === undefined || value === null) return fallback;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  ```

---

### 8. Low: Redundant Array Output in `buildReportUrls`
* **Location:** `src/github/reports.ts` (lines 8-20)
* **Severity:** Low
* **Description:** 
  The `buildReportUrls` function is declared to return `string[]`, but the caller `fetchReport` only ever uses index 0: `urls[0]`. This creates redundant array allocations and confuses API usage.
* **Recommendation:** 
  Simplify the signature to return a single `string`.

---

### 9. Low: Disorganized Test Suite Structure
* **Location:** `tests/etl/parse_users.test.ts`
* **Severity:** Low
* **Description:** 
  `tests/etl/parse_users.test.ts` contains unit tests for multiple distinct files: `parse_users.ts`, `parse_enterprise.ts`, `parse_teams.ts`, and `parse_seats.ts`. This goes against clean folder structure conventions and makes it hard to locate tests for specific modules.
* **Recommendation:** 
  Separate the tests into individual test files corresponding to their source files (e.g., `parse_enterprise.test.ts`, `parse_teams.test.ts`, `parse_seats.test.ts`).
