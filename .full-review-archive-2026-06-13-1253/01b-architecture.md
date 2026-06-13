# Architectural Design & Structural Integrity Review
**Project:** BurnRate  
**Target File Scope:** Core source files under `src/` and project configurations (`package.json`, `tsconfig.json`).  
**Date:** 2026-06-13  

---

## Executive Summary

The BurnRate codebase is a clean, well-scoped CLI tool for monitoring GitHub Copilot usage. It successfully implements pure-functional parsers, a mathematical forecasting engine, and supports both SQLite and PostgreSQL.

However, several architectural concerns undermine its type safety, maintainability, and reliability:
1. **Dialect Coupling & Code Duplication:** The system is heavily coupled to database engines, duplicating schemas and DML code inside the core ETL pipeline.
2. **Weak Type Safety:** The database client (`DbClient`) is defined as `any`, bypassing TypeScript safety gates and violating the project's style guidelines.
3. **Missing Transactions:** Multi-step inserts in the ETL pipeline are not run within transactions, risking database corruption.
4. **Boundary Violations:** CLI command orchestrators mix CLI argument parsing with direct database queries and calculations.

---

## Detailed Findings & Recommendations

### 1. Schema Duplication and Synchronization Risk
* **Severity:** High
* **Component/File:** `src/db/schema.ts`, `src/db/migrate.ts`
* **Architectural Impact:** 
  The core database schema is duplicated across four locations:
  1. PostgreSQL Drizzle schema (`rawReportsPg`, `usersPg`, etc.) in `schema.ts`.
  2. SQLite Drizzle schema (`rawReportsSq`, `usersSq`, etc.) in `schema.ts`.
  3. Raw PostgreSQL DDL strings in `migrate.ts` (`pgSchemaStatements`).
  4. Raw SQLite DDL strings in `migrate.ts` (`sqliteSchemaStatements`).
  
  Any change to the data model (e.g., adding or updating a column) requires a developer to manually update four separate definitions across two files. This presents a high risk of **schema drift** where SQLite (used in tests) diverges from PostgreSQL (used in production), causing tests to pass while production fails.
* **Recommendation:**
  * Adopt `drizzle-kit` for generating migration files rather than writing raw SQL strings inside `migrate.ts`.
  * Use Drizzle's migration runners (`migrate` from `drizzle-orm/node-postgres/migrator` or `drizzle-orm/better-sqlite3/migrator`) to run generated migrations programmatically.
  * Reduce schema duplication by extracting common column structures where possible, or programmatically deriving schemas if Drizzle permits, or at least eliminating the manual raw SQL lists in `migrate.ts`.

---

### 2. Database Dialect Coupling in Business Logic
* **Severity:** High
* **Component/File:** `src/etl/pipeline.ts`, `src/index.ts`
* **Architectural Impact:**
  The ETL pipeline (`pipeline.ts`) and command execution engine (`index.ts`) branch dynamically based on the database driver type (e.g., `typeof db.run === 'function'`). This causes massive code duplication for every database insert and update statement:
  ```typescript
  if (isSqlite) {
    await db.insert(usersSq).values(userRows).onConflictDoUpdate(...);
  } else {
    await db.insert(usersPg).values(userRows).onConflictDoUpdate(...);
  }
  ```
  This violates the **Open-Closed Principle (OCP)**. If a new dialect is introduced (or if SQLite is swapped for another engine), core ETL pipelines and index files must be rewritten.
* **Recommendation:**
  * Implement the **Repository Pattern** or a **Database Adapter** layer.
  * Define interfaces such as `UserRepository`, `UsageRepository`, and `RawReportRepository` that expose database-agnostic methods (e.g., `saveUsers(users: User[])`).
  * Implement two concrete adapters (Postgres and SQLite) that implement these interfaces, shifting the driver-specific branches out of the ETL logic.

---

### 3. Weak Database Client Typing
* **Severity:** High
* **Component/File:** `src/db/client.ts`
* **Architectural Impact:**
  The database client type is exported as `any`:
  ```typescript
  export type DbClient = any;
  ```
  This circumvents TypeScript compile-time checks across the entire data access layer. Dynamic query building and mapping operations lose IDE autocomplete, hiding syntax errors or column mismatches until runtime. This directly violates the project rule in `AGENTS.md`: *"DO specify explicit types for all interfaces, parameters, and return types (no implicit any)."*
* **Recommendation:**
  Define a strict union type or a common wrapper interface for `DbClient`:
  ```typescript
  import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
  import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

  export type DbClient = NodePgDatabase<Record<string, never>> | BetterSQLite3Database<Record<string, never>>;
  ```

---

### 4. Non-Transactional ETL Operations
* **Severity:** High
* **Component/File:** `src/etl/pipeline.ts`
* **Architectural Impact:**
  The ETL pipeline performs multiple insertions per report (first writing to `raw_reports`, then to user tables, and then daily usage tables) without a transaction context. If the network drops or a database constraint is violated during the second insert, the raw report remains stored but the parsed usage records are missing. This leads to **partial updates** and database inconsistency, directly violating the guideline in `AGENTS.md`: *"Use database transactions (via the Drizzle client) for multi-statement inserts or updates."*
* **Recommendation:**
  Wrap each logical unit of report processing inside a database transaction:
  ```typescript
  await db.transaction(async (tx) => {
    // Perform raw storage and parsed table insertions using transaction context `tx`
  });
  ```

---

### 5. Forecasting Engine Division by Zero Vulnerability
* **Severity:** High
* **Component/File:** `src/forecast/engine.ts`
* **Architectural Impact:**
  The forecasting engine computes percentage ratios based on `input.poolTotal`:
  ```typescript
  const pctOfPool7d = (forecast7d / input.poolTotal) * 100;
  ```
  If no pool snapshots have been recorded yet or if `poolTotal` is zero (or negative), this operation yields `Infinity` or `NaN`. In TypeScript, `Infinity` is serialized as `null` in JSON outputs, which breaks downstream API contracts or UI components. Furthermore, `maxPct` becomes `Infinity`, triggering a false-positive `critical` alert level.
* **Recommendation:**
  Add defensive validation inside `computeForecast`:
  ```typescript
  if (!input.poolTotal || input.poolTotal <= 0) {
    // Return 0% metrics or throw an explicit validation error
  }
  ```

---

### 6. CLI Orchestration Mixing Business and Data Access Concerns
* **Severity:** Medium
* **Component/File:** `src/index.ts`
* **Architectural Impact:**
  The `forecast` command in `src/index.ts` contains raw SQL queries, data parsing logic, date aggregations, and business logic processing inline inside the CLI command executor.
  This violates **Separation of Concerns**. The main entrypoint file is responsible for CLI orchestration (interpreting commands, parsing args) and should not contain query syntax, calculations, or raw database accesses. This makes unit testing the CLI commands difficult without full database mocks.
* **Recommendation:**
  * Extract the queries to a repository layer (e.g., `UsageRepository.getRecentDailyCredits(db, days)`).
  * Extract the date calculation and input gathering logic to a service/orchestrator module (e.g., `ForecastService`).
  * Keep `src/index.ts` purely as a router/CLI layer.

---

### 7. Type Safety Bypasses (Type Casting to `any`)
* **Severity:** Medium
* **Component/File:** `src/github/seats.ts`, `src/etl/parse_*`
* **Architectural Impact:**
  The application utilizes explicit type casting to `any` in two main areas:
  1. REST Admin Endpoint casting: `(client.octokit.rest as any).enterpriseAdmin.listCopilotSeatsForEnterprise`.
  2. Parser data mapping: `(entry: any) => ...` inside `parseDailyUsage` and `parseTeamUsage`.
  
  This bypasses type checking for external boundary interfaces. If the GitHub API returns unexpected payloads or changes its properties, the parsers will fail silently at runtime or convert `undefined` to `NaN` and `'0.0000'`, corrupting the stored statistics.
* **Recommendation:**
  * Resolve Octokit types by importing proper types or configuring client definitions rather than using `as any`.
  * Use lightweight runtime assertion/validation schemas (such as `zod`) to validate incoming JSON payloads before parsing them, ensuring schema boundaries are checked and runtime-safe.

---

## Summary of Severity Levels

| Severity | Count | Key Impacts |
|----------|-------|-------------|
| **Critical** | 0 | None identified. |
| **High** | 5 | Schema drift, database coupling, type safety bypasses, non-atomic writes, division-by-zero errors. |
| **Medium** | 2 | CLI orchestration coupling, API boundary unsafe type assertions. |
| **Low** | 0 | None identified. |

---

## Architectural Recommendation Roadmap

1. **Immediate (Phase 1):**
   * Change `export type DbClient = any` to a strict union type in `src/db/client.ts`.
   * Add input validation to prevent division by zero in `src/forecast/engine.ts`.
   * Wrap the multi-statement inserts in `src/etl/pipeline.ts` inside transactions.
2. **Intermediate (Phase 2):**
   * Abstract the database insertion operations into Repository files (e.g., `src/db/repositories/`) to eliminate dialect checks from `pipeline.ts` and `index.ts`.
   * Move the data aggregation and forecasting queries out of `index.ts` into a `ForecastService`.
3. **Long-Term:**
   * Migrate away from raw DDL string arrays in `migrate.ts` to standard `drizzle-kit` migration generation and programmatic execution.
   * Add schema validation (Zod) on data payloads retrieved from the GitHub API.
