# Modern Framework and Language Best Practices Review
**Project:** BurnRate  
**Target Path:** `/home/mhenke/Projects/BurnRate`  
**Date:** 2026-06-13

This review assesses adherence to modern language features, framework conventions, security practices, performance standards, build configurations, and overall code quality across the scoped files of the BurnRate repository.

---

## Executive Summary of Findings

| Finding | Severity | Category | Target File(s) | Description |
| :--- | :--- | :--- | :--- | :--- |
| **1. Month-to-Date Forecast Off-by-One Mismatch** | **Critical** | Logic / Math | `src/index.ts` | Discrepancy between process-based elapsed days and ETL-based database usage date range. |
| **2. Bypassing Drizzle Migrations with Hardcoded SQL** | **High** | Architecture / Pattern | `src/db/migrate.ts`<br>`src/db/schema.ts` | Schema definitions are duplicated and DDL is hardcoded, risking sync issues. |
| **3. YAML Structure Injection via Pre-Parse Env Expansion** | **High** | Security | `src/config.ts` | Regex environment expansion on raw string content before parsing YAML. |
| **4. SSRF Vulnerability in fetchSignedUrl** | **High** | Security | `src/github/client.ts` | Downloads files from any arbitrary URL without hostname/protocol validation. |
| **5. Database Dialect Coupling & Fragile Ad-Hoc Checks** | **High** | Architecture | `src/db/client.ts`<br>`src/etl/pipeline.ts`<br>`src/index.ts` | Using ad-hoc type checks (like `typeof db.run === 'function'`) and manual schema routing. |
| **6. Explicit `any` Type for Database Client** | **Medium** | Language Idioms | `src/db/client.ts` | Bypasses TypeScript type-safety compiler checks for queries and mutations. |
| **7. Side Effects in Module Scope & Dotenv Redundancy** | **Medium** | Language Idioms | `src/config.ts` | Global side-effects when importing; redundant dependency in Node.js 20.6+. |
| **8. Sequential Writes and Missing Transactions in ETL** | **Medium** | Performance / Pattern | `src/etl/pipeline.ts` | Sequential loops for network and DB writes, violating transaction guardrails. |
| **9. Lack of PostgreSQL Path Test Coverage** | **High** | Testing | `tests/db/client.test.ts` | Database connection, schema, and migrations only test SQLite path. |
| **10. Suboptimal TS compiler settings** | **Low** | Build Config | `tsconfig.json` | Excluding test folder disables type-safety validation for tests in IDE. |

---

## Detailed Findings & Recommendations

### 1. Month-to-Date Forecast Off-by-One Mismatch
> [!IMPORTANT]
> This issue leads to inaccurate forecasts that consistently understate monthly credit usage by a full day's average.

*   **Severity:** Critical
*   **Description:** 
    In the `forecast` command, `daysElapsed` is calculated as `now.getDate()`. However, the ETL pipeline runs daily for *yesterday* (`Date.now() - 86400000`). Consequently, the latest daily usage record available in the database is for yesterday.
    Thus, `creditsUsedMtd` aggregates only up to yesterday (i.e. `daysElapsed - 1` days). When computing the forecast:
    $$\text{forecast} = \text{creditsUsedMtd} + (\text{rate} \times (daysInMonth - daysElapsed))$$
    The formula forecasts for only $(daysElapsed - 1) + (daysInMonth - daysElapsed) = daysInMonth - 1$ days.
*   **Current Pattern:**
    ```typescript
    const daysElapsed = now.getDate();
    // e.g. on Jun 30: daysElapsed = 30, remaining = 0
    // forecast uses only 29 days of actuals + 0 days of rate = 29 days total!
    ```
*   **Recommended Pattern:**
    Align the elapsed days with the latest date for which data exists in the database, or dynamically subtract one from the current day since ETL operates on a one-day delay.
*   **Migration/Fix Example:**
    ```typescript
    // In src/index.ts
    // Use the latest date of the rows retrieved as the boundary for elapsed days
    const daysElapsed = rows.length > 0 
      ? new Date(rows[rows.length - 1].usage_date).getDate() 
      : now.getDate() - 1;
    ```

---

### 2. Bypassing Drizzle Migrations with Hardcoded SQL
*   **Severity:** High
*   **Description:**
    The project defines DB tables twice (once for Postgres and once for SQLite) in `src/db/schema.ts` and duplicates those definitions in raw SQL strings inside `src/db/migrate.ts`. This defeats `drizzle-kit`'s automatic migration generation, creating a severe synchronization risk where modifying the Drizzle schema doesn't update the migrations.
*   **Current Pattern:**
    ```typescript
    export const pgSchemaStatements = [
      `CREATE TABLE IF NOT EXISTS raw_reports (...`
    ];
    export async function runMigrations(db: any) {
      for (const stmt of statements) { ... db.execute(sql.raw(stmt)) ... }
    }
    ```
*   **Recommended Pattern:**
    Use `drizzle-kit` to output migrations into static SQL files (e.g. `./drizzle/migrations`) and run Drizzle's official `migrate` helper at application startup.
*   **Migration/Fix Example:**
    ```typescript
    // In src/db/migrate.ts
    import { migrate as pgMigrate } from 'drizzle-orm/node-postgres/migrator';
    import { migrate as sqliteMigrate } from 'drizzle-orm/better-sqlite3/migrator';

    export async function runMigrations(db: DbClient, isSqlite: boolean): Promise<void> {
      if (isSqlite) {
        await sqliteMigrate(db, { migrationsFolder: './drizzle/migrations/sqlite' });
      } else {
        await pgMigrate(db, { migrationsFolder: './drizzle/migrations/pg' });
      }
    }
    ```

---

### 3. YAML Structure Injection via Pre-Parse Env Expansion
> [!CAUTION]
> If any environment variable expanded via string replacement contains newlines or YAML characters, it could alter the structure of the config block parsed.

*   **Severity:** High
*   **Description:**
    `expandEnv` runs a regex replacement on raw YAML content before it passes into the YAML parser. This is a vulnerability if credentials or paths contain YAML-breaking characters.
*   **Current Pattern:**
    ```typescript
    const raw = readFileSync(filePath, 'utf8');
    const parsed = parse(expandEnv(raw)); // string manipulation first
    ```
*   **Recommended Pattern:**
    Parse the YAML document first to extract structures, then recursively traverse and replace environment variables in string nodes only.
*   **Migration/Fix Example:**
    ```typescript
    import { parse } from 'yaml';

    function expandEnvValue(value: string): string {
      return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? '');
    }

    function expandObject(obj: any): any {
      if (typeof obj === 'string') return expandEnvValue(obj);
      if (Array.isArray(obj)) return obj.map(expandObject);
      if (obj !== null && typeof obj === 'object') {
        return Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [k, expandObject(v)])
        );
      }
      return obj;
    }

    export function loadConfig(filePath: string): BurnrateConfig {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = expandObject(parse(raw));
      // validate schema afterwards...
    }
    ```

---

### 4. SSRF Vulnerability in fetchSignedUrl
*   **Severity:** High
*   **Description:**
    The `fetchSignedUrl` function in `src/github/client.ts` receives arbitrary URLs from the GitHub API response and fetches them directly. Without host/protocol verification, an attacker could supply an internal resource URL (e.g. `http://127.0.0.1:8080/admin`) to execute SSRF.
*   **Current Pattern:**
    ```typescript
    async function fetchSignedUrl<T>(url: string): Promise<T> {
      const response = await fetch(url);
      return response.json();
    }
    ```
*   **Recommended Pattern:**
    Validate that the incoming URL protocol is `https:` and the hostname belongs specifically to a trusted GitHub domain.
*   **Migration/Fix Example:**
    ```typescript
    async function fetchSignedUrl<T>(url: string): Promise<T> {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        throw new Error('Only HTTPS protocol is supported for signed URL download');
      }
      
      const allowedDomainPattern = /\.github(usercontent)?\.com$/;
      if (!allowedDomainPattern.test(parsed.hostname) && parsed.hostname !== 'api.github.com') {
        throw new Error(`Untrusted host domain detected: ${parsed.hostname}`);
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Signed URL fetch failed: ${response.status}`);
      return response.json();
    }
    ```

---

### 5. Database Dialect Coupling & Fragile Ad-Hoc Checks
*   **Severity:** High
*   **Description:**
    Checking database engine types with ad-hoc checks (like `typeof db.run === 'function'`) and manually importing duplicate SQLite vs Postgres schemas creates high maintenance overhead.
*   **Current Pattern:**
    ```typescript
    // src/etl/pipeline.ts
    const isSqlite = typeof db.run === 'function';
    const T = getTables(isSqlite); // returns rawReportsSq or rawReportsPg
    ```
*   **Recommended Pattern:**
    Create a Database Repository layer or configure Drizzle to use a single schema object mapped to different adapters, or inspect `$client` types formally rather than checking if methods like `.run` exist.
*   **Migration/Fix Example:**
    ```typescript
    // In src/db/client.ts, expose client dialect info:
    export type DbClient = {
      instance: any;
      dialect: 'postgres' | 'sqlite';
    };
    ```

---

### 6. Explicit `any` Type for Database Client
*   **Severity:** Medium
*   **Description:**
    `DbClient` is defined as `any`, disabling all TypeScript autocomplete and compilation safety checks for queries.
*   **Current Pattern:**
    ```typescript
    export type DbClient = any;
    ```
*   **Recommended Pattern:**
    Declare a union type using the exact Drizzle ORM client database wrappers.
*   **Migration/Fix Example:**
    ```typescript
    import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
    import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

    export type DbClient = NodePgDatabase<Record<string, never>> | BetterSQLite3Database<Record<string, never>>;
    ```

---

### 7. Side Effects in Module Scope & Dotenv Redundancy
*   **Severity:** Medium
*   **Description:**
    Importing `src/config.ts` immediately triggers `dotenvConfig()` globally. This executes configuration side effects in test runs and restricts dependency flexibility. Furthermore, Node.js 20.6+ natively supports `.env` configuration.
*   **Current Pattern:**
    ```typescript
    // src/config.ts
    import { config as dotenvConfig } from 'dotenv';
    dotenvConfig(); // Executed globally
    ```
*   **Recommended Pattern:**
    Remove `dotenv` from dependencies. Use Node.js's native `--env-file` argument in command scripts.
*   **Migration/Fix Example:**
    ```json
    // package.json scripts
    "scripts": {
      "etl": "node --env-file=.env --import=tsx src/index.ts etl"
    }
    ```

---

### 8. Sequential Writes and Missing Transactions in ETL
*   **Severity:** Medium
*   **Description:**
    The ETL pipeline handles network downloads and database writes in sequential loops. This is slow and leaves the database vulnerable to partial states on failure because queries are not executed inside transactions.
*   **Current Pattern:**
    ```typescript
    for (const link of reportData.download_links) {
      const rawPayload = await gh.fetchSignedUrl(link);
      await db.insert(T.rawReports).values(...);
      if (reportType === 'enterprise-1-day') {
        await db.insert(T.users).values(...);
      }
    }
    ```
*   **Recommended Pattern:**
    Fetch remote payloads in parallel with `Promise.all`, then insert them within a database transaction block.
*   **Migration/Fix Example:**
    ```typescript
    const payloads = await Promise.all(
      reportData.download_links.map(link => gh.fetchSignedUrl(link))
    );

    await db.transaction(async (tx) => {
      for (const payload of payloads) {
        await tx.insert(T.rawReports).values(...);
        // ...
      }
    });
    ```

---

### 9. Lack of PostgreSQL Path Test Coverage
*   **Severity:** High
*   **Description:**
    The entire database testing suite uses SQLite's `:memory:` mode. None of the PostgreSQL configurations, schema constraints, pg-specific types (e.g. `jsonb`, `timestamptz`), or migrations are covered by tests.
*   **Current Pattern:**
    ```typescript
    beforeAll(() => {
      initDb(':memory:');
    });
    ```
*   **Recommended Pattern:**
    Mock connection pools or leverage test databases (via local PostgreSQL instance or Docker container) in test files to verify Postgres-specific schema mappings.

---

### 10. Suboptimal TS compiler settings
*   **Severity:** Low
*   **Description:**
    `tests` is listed inside `"exclude"` inside `tsconfig.json`. This causes editors/IDEs to ignore type errors inside tests, missing type discrepancies during refactoring.
*   **Current Pattern:**
    ```json
    "exclude": ["tests"]
    ```
*   **Recommended Pattern:**
    Include `tests` in the workspace check compilation but use a different config file for build distributions (e.g., `tsconfig.build.json` which excludes `tests`).
