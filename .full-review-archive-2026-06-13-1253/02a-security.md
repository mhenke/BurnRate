# BurnRate Security Audit Review

This document contains a comprehensive security audit of the BurnRate codebase. It evaluates security vulnerabilities against the OWASP Top 10, input validation weaknesses, authentication/authorization flaws, cryptographic issues, dependency vulnerabilities, and configuration security.

---

## Executive Summary

A comprehensive security audit of the BurnRate target codebase was conducted. The audit revealed **8 key security findings** ranging from **High** to **Low** severity.

### Summary of Findings by Severity
*   **High (3):**
    *   YAML Structure Hijacking / Injection in Config Loader (CWE-94)
    *   Server-Side Request Forgery (SSRF) in Signed URL Downloader (CWE-918)
    *   Known High-Severity Vulnerabilities in `esbuild` Dependency (CWE-1104)
*   **Medium (3):**
    *   Non-Transactional Database Operations in ETL Pipeline (CWE-362)
    *   Uncaught Parser Exceptions Leading to Denial of Service (CWE-248 / CWE-755)
    *   Division-by-Zero in Forecast Engine causing Alert Bypass or False Critical Alerts (CWE-369)
*   **Low (2):**
    *   Improper Neutralization of SQL Commands via `sql.raw` in CLI Helper (CWE-89)
    *   Uncleaned Temporary Directories in Test Suites (CWE-377)

---

## Detailed Findings

### 1. High: YAML Structure Hijacking / Injection in Config Loader
*   **Location:** `src/config.ts` (lines 12-14)
*   **Severity:** High (CVSS: 7.8 | `CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H`)
*   **CWE Reference:** [CWE-94: Improper Control of Generation of Code ('Code Injection')](https://cwe.mitre.org/data/definitions/94.html), [CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html)
*   **Description:**
    The `loadConfig` function reads the configuration file (`burnrate.yml`) as raw text, performs environment variable substitution using regular expressions, and then parses the resulting string as YAML:
    ```typescript
    function expandEnv(value: string): string {
      return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '');
    }
    ```
    Because the substitution is executed on the raw text *prior* to parsing, any environment variable that contains newlines, colons, or YAML structural indentation can inject new YAML keys or override existing ones.
*   **Proof of Concept / Attack Scenario:**
    If an administrator sets `DATABASE_URL` to:
    ```env
    postgres://localhost:5432/db
    github:
      token: hijacked_token
      enterprise: attacker_ent
      org: attacker_org
    ```
    When `expandEnv` runs, the resolved YAML becomes:
    ```yaml
    github:
      enterprise: acme
      org: acme-inc
      token: ${GITHUB_TOKEN}
    postgres:
      url: postgres://localhost:5432/db
    github:
      token: hijacked_token
      enterprise: attacker_ent
      org: attacker_org
    ```
    Upon parsing, the parser will overwrite `github.token`, `github.enterprise`, and `github.org` with the injected values. An attacker who is able to manipulate environment variables (e.g. in a shared hosting environment, CI runner, or container deployment) can redirect GitHub API queries to their own endpoints, leading to data exfiltration.
*   **Remediation:**
    Parse the YAML configuration file *first* without env replacement, then programmatically resolve environment variables on a per-value basis.
    ```typescript
    // Recommended Fix
    export function loadConfig(filePath: string): BurnrateConfig {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = parse(raw) as Partial<BurnrateConfig>;
      
      const resolveValue = (val: string | undefined, envFallback: string): string => {
        if (!val) return process.env[envFallback] ?? '';
        const match = val.match(/^\$\{([A-Z0-9_]+)\}$/);
        return match ? (process.env[match[1]] ?? '') : val;
      };

      const resolved: BurnrateConfig = {
        github: {
          enterprise: resolveValue(parsed.github?.enterprise, 'GITHUB_ENTERPRISE'),
          org: resolveValue(parsed.github?.org, 'GITHUB_ORG'),
          token: resolveValue(parsed.github?.token, 'GITHUB_TOKEN'),
        },
        postgres: {
          url: resolveValue(parsed.postgres?.url, 'DATABASE_URL'),
        }
      };

      if (!resolved.github.enterprise) throw new Error('Missing burnrate.yml github.enterprise');
      if (!resolved.github.org) throw new Error('Missing burnrate.yml github.org');
      if (!resolved.github.token) throw new Error('Missing burnrate.yml github.token');
      if (!resolved.postgres.url) throw new Error('Missing burnrate.yml postgres.url');
      
      return resolved;
    }
    ```

---

### 2. High: Server-Side Request Forgery (SSRF) in Signed URL Downloader
*   **Location:** `src/github/client.ts` (lines 21-28)
*   **Severity:** High (CVSS: 7.5 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`)
*   **CWE Reference:** [CWE-918: Server-Side Request Forgery (SSRF)](https://cwe.mitre.org/data/definitions/918.html)
*   **Description:**
    The `fetchSignedUrl` method directly sends an HTTP GET request to whatever string is passed to it:
    ```typescript
    async function fetchSignedUrl<T>(url: string): Promise<T> {
      const response = await fetch(url);
      ...
      return response.json() as Promise<T>;
    }
    ```
    Although these URLs are returned from the GitHub API response (`reportData.download_links`), there is no validation restricting the fetch operation to trusted domains (e.g. `*.github.com` or `*.githubusercontent.com`).
*   **Proof of Concept / Attack Scenario:**
    If an attacker is able to intercept the GitHub API response (e.g., DNS poisoning, reverse proxy, or compromise of a self-hosted enterprise server endpoint), they can return a download link pointing to an internal server resource, such as AWS Instance Metadata service `http://169.254.169.254/latest/meta-data/` or an internal database.
    The BurnRate server will fetch the internal metadata. If the endpoint returns JSON, `response.json()` parses it successfully and it gets saved directly to the database in `raw_reports.payload`, allowing the attacker to exfiltrate private internal credentials.
*   **Remediation:**
    Implement host validation on the URL parameter before fetching. Restrict targets to HTTPS only and ensure the host is in an explicit whitelist of GitHub API and asset delivery networks.
    ```typescript
    // Recommended Fix
    import { URL } from 'node:url';

    async function fetchSignedUrl<T>(urlStr: string): Promise<T> {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== 'https:') {
        throw new Error('SSRF Prevention: Only HTTPS is permitted');
      }

      const allowedHosts = [
        'api.github.com',
        'github.com',
        'github-cloud.s3.amazonaws.com',
        'github-cloud.githubusercontent.com'
      ];

      const isWhitelisted = allowedHosts.some(
        allowed => parsed.hostname === allowed || parsed.hostname.endsWith('.' + allowed)
      );

      if (!isWhitelisted) {
        throw new Error(`SSRF Prevention: Host ${parsed.hostname} is not whitelisted`);
      }

      const response = await fetch(urlStr);
      if (!response.ok) {
        throw new Error(`Signed URL fetch failed: ${response.status} ${response.statusText}`);
      }
      return response.json() as Promise<T>;
    }
    ```

---

### 3. High: Known High-Severity Vulnerabilities in `esbuild` Dependency
*   **Location:** `package.json`
*   **Severity:** High (CVSS: 8.8 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H`)
*   **CWE Reference:** [CWE-1104: Use of Unmaintained or Vulnerable Third-Party Component](https://cwe.mitre.org/data/definitions/1104.html), [CWE-350: Reliance on Reverse DNS Resolution / DNS Rebinding](https://cwe.mitre.org/data/definitions/350.html)
*   **Description:**
    The project uses outdated development dependencies (`drizzle-kit` and `vitest`), which transitively rely on `esbuild <= 0.28.0`. These versions of `esbuild` are subject to several published security advisories:
    *   **DNS Rebinding (GHSA-67mh-4wv8-2f99):** Permits malicious websites to make requests to the development server and read files or data.
    *   **Remote Code Execution (GHSA-gv7w-rqvm-qjhr):** RCE via registry manipulation.
    *   **Arbitrary File Read (GHSA-g7r4-m6w7-qqqr):** Allows file reads in Windows environments.
*   **Proof of Concept / Attack Scenario:**
    When running the testing suite or database migrations locally or in a shared developer workspace, a developer visiting a malicious website could have their browser hijacked to execute commands on the local esbuild development/testing server ports, leading to file disclosure or system compromise.
*   **Remediation:**
    Upgrade `drizzle-kit` and `vitest` to versions using `esbuild > 0.28.0`.
    Run the following command to update packages:
    ```bash
    npm install --save-dev drizzle-kit@latest vitest@latest
    ```

---

### 4. Medium: Non-Transactional Database Operations in ETL Pipeline
*   **Location:** `src/etl/pipeline.ts` (lines 102-191, 216-240)
*   **Severity:** Medium (CVSS: 5.3 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L`)
*   **CWE Reference:** [CWE-362: Concurrent Execution using Shared Resource with Improper Synchronization](https://cwe.mitre.org/data/definitions/362.html), [CWE-400: Uncontrolled Resource Consumption](https://cwe.mitre.org/data/definitions/400.html)
*   **Description:**
    The `runObserveOnlyPipeline` inserts and updates rows in multiple tables (`raw_reports`, `users`, `daily_usage`, and `team_usage`) in separate, isolated statements without utilizing transactions.
    If the network drops, a rate limit is triggered, or the process crashes mid-execution, the database will be left in a partially updated state. This corrupts downstream analytics.
*   **Proof of Concept / Attack Scenario:**
    A pipeline fails right after writing users but before updating `daily_usage` credits. The next CLI execution computes monthly burn rate forecasts using the partial database state. This results in underestimating actual credits used. The budget threshold warning is not triggered, causing the organization to exceed credit budgets without receiving slack/issue alerts.
*   **Remediation:**
    Wrap the database operations in a transaction using the Drizzle client.
    ```typescript
    // Recommended Fix
    export async function runObserveOnlyPipeline(
      gh: GitHubClient,
      db: DbClient,
      day: string,
    ): Promise<PipelineResult> {
      // ...
      // Wrap all inserts in a transaction block
      await db.transaction(async (tx) => {
        // Use `tx` instead of `db` inside the loop
        await tx.insert(T.rawReports).values({ ... }).onConflictDoNothing();
        
        if (reportType === 'enterprise-1-day') {
          await tx.insert(T.users).values(userRows).onConflictDoUpdate(...);
        }
        // ...
      });
      
      return result;
    }
    ```

---

### 5. Medium: Uncaught Parser Exceptions Leading to Denial of Service (DoS)
*   **Location:** `src/etl/parse_enterprise.ts` (lines 35, 36) & `src/etl/parse_teams.ts` (line 40)
*   **Severity:** Medium (CVSS: 5.3 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`)
*   **CWE Reference:** [CWE-248: Uncaught Exception](https://cwe.mitre.org/data/definitions/248.html), [CWE-755: Improper Handling of Exceptional Conditions](https://cwe.mitre.org/data/definitions/755.html)
*   **Description:**
    The ETL parsers lack exception handling and input validation when parsing raw JSON files:
    1.  `BigInt(entry.tokens_input ?? 0)` throws a fatal `SyntaxError` if the value is a float (e.g. `12.5`), or a non-numeric string (e.g. `""`, `"abc"`).
    2.  `Number(entry.avg_acceptance_rate)` yields `NaN` on malformed values. Calling `avgAcceptanceRate.toFixed(4)` returns the string `"NaN"`. PostgreSQL enforces a numeric constraint (`numeric(5,4)`). Inserting `"NaN"` triggers a fatal database driver query error.
    Because these exceptions are not caught within the data mapping iteration, they abort the entire ETL process.
*   **Proof of Concept / Attack Scenario:**
    If a GitHub API response contains a float or empty string in `tokens_input`, the entire nightly cron job crashes, preventing any users or daily usage metrics from being ingested, resulting in a Denial of Service for the billing application.
*   **Remediation:**
    Wrap numeric conversions in safe helper functions that catch parsing errors and return sane defaults (e.g., `0n`, `0`).
    ```typescript
    // Recommended Fix
    function safeBigInt(val: any): bigint {
      try {
        if (val === null || val === undefined) return 0n;
        const parsed = Number(val);
        if (Number.isNaN(parsed) || !Number.isFinite(parsed)) return 0n;
        return BigInt(Math.floor(parsed));
      } catch {
        return 0n;
      }
    }

    function safeFixedNumber(val: any, decimals: number): string {
      const parsed = Number(val);
      if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
        return (0).toFixed(decimals);
      }
      return parsed.toFixed(decimals);
    }
    ```

---

### 6. Medium: Division-by-Zero in Forecast Engine causing Alert Bypass or False Critical Alerts
*   **Location:** `src/forecast/engine.ts` (lines 36-37)
*   **Severity:** Medium (CVSS: 5.3 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`)
*   **CWE Reference:** [CWE-369: Divide By Zero](https://cwe.mitre.org/data/definitions/369.html)
*   **Description:**
    The forecasting engine calculates the percentage of pool credits used:
    ```typescript
    const pctOfPool7d = (forecast7d / input.poolTotal) * 100;
    const pctOfPool30d = (forecast30d / input.poolTotal) * 100;
    ```
    If `poolTotal` is zero or negative (due to a database misconfiguration or missing snapshot), dividing by zero results in `Infinity` or `NaN` (if the forecast is also zero).
    - If `maxPct` is `Infinity`, it triggers the `>= 110` branch, setting `alertLevel = 'critical'`, generating false alarms.
    - If `poolTotal` is negative, the division produces negative percentages, defaulting `alertLevel` to `'ok'`, suppressing alerts even though a negative credit balance is a critical condition.
*   **Proof of Concept / Attack Scenario:**
    If the `pool_snapshots` table is empty or has a zero entry, `poolTotal` defaults to `0`. The application reports a `critical` alarm to Slack/GitHub immediately, even if no credits have actually been used.
*   **Remediation:**
    Validate the `poolTotal` value before carrying out the division. If `poolTotal <= 0`, flag the forecast as an invalid pool total anomaly and return a critical alert context.
    ```typescript
    // Recommended Fix
    export function computeForecast(input: ForecastInput): ForecastResult {
      const remainingDays = input.daysInMonth - input.daysElapsed;
      const rate7d = average(input.dailyCredits.slice(-7));
      const rate30d = average(input.dailyCredits.slice(-30));

      const forecast7d = Math.round((input.creditsUsedMtd + rate7d * remainingDays) * 100) / 100;
      const forecast30d = Math.round((input.creditsUsedMtd + rate30d * remainingDays) * 100) / 100;

      if (input.poolTotal <= 0) {
        return {
          rate7d,
          rate30d,
          forecast7d,
          forecast30d,
          pctOfPool7d: 0,
          pctOfPool30d: 0,
          divergencePct: 0,
          alertLevel: 'critical', // Invalid config alert level
        };
      }

      const pctOfPool7d = (forecast7d / input.poolTotal) * 100;
      const pctOfPool30d = (forecast30d / input.poolTotal) * 100;
      // ...
    }
    ```

---

### 7. Low: Improper Neutralization of SQL Commands via `sql.raw` in CLI Helper
*   **Location:** `src/index.ts` (lines 79-87)
*   **Severity:** Low (CVSS: 2.1 | `CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:N/I:L/A:N`)
*   **CWE Reference:** [CWE-89: Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')](https://cwe.mitre.org/data/definitions/89.html)
*   **Description:**
    The CLI helper function `runQuery` bypasses the Drizzle ORM query builder to execute raw SQL strings via `sql.raw(querySql)`:
    ```typescript
    async function runQuery<T>(db: any, querySql: string): Promise<T[]> {
      const isSqlite = typeof db.run === 'function';
      if (isSqlite) {
        return db.all(sql.raw(querySql)) as T[];
      } else {
        const res = await db.execute(sql.raw(querySql));
        return res.rows as T[];
      }
    }
    ```
    While the queries in `main` are currently hardcoded, utilizing `sql.raw` with a generic string parameter introduces a high risk of SQL Injection if future developers interpolate user inputs (such as filter dates, usernames, or commands) directly into the SQL string.
*   **Remediation:**
    Replace raw SQL strings with Drizzle's structured query builder or enforce parameterization using the default `sql` tag with placeholders.
    ```typescript
    // Recommended Fix (using parameterized queries)
    import { sql } from 'drizzle-orm';

    // Instead of raw string interpolation, use structured statements
    const rows = await db.select().from(dailyUsagePg).where(
      sql`${dailyUsagePg.usageDate} >= ${firstOfMonth}`
    );
    ```

---

### 8. Low: Uncleaned Temporary Directories in Test Suites
*   **Location:** `tests/config.test.ts` (lines 10-11, 32-33)
*   **Severity:** Low (CVSS: 1.8 | `CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`)
*   **CWE Reference:** [CWE-377: Insecure Temporary File](https://cwe.mitre.org/data/definitions/377.html)
*   **Description:**
    The configuration tests write temporary test YAML configuration files to directories created via `mkdtempSync`:
    ```typescript
    const dir = mkdtempSync(join(tmpdir(), 'burnrate-'));
    const file = join(dir, 'burnrate.yml');
    ```
    However, these directories and their contents are never deleted after the test finishes. In local development or shared CI systems, this can slowly fill up the local disk space and leave remnants of test configuration files readable by other local users on the same server.
*   **Remediation:**
    Ensure that directories created by `mkdtempSync` are recursively removed inside a `finally` block or an `afterEach` hook.
    ```typescript
    // Recommended Fix
    import { rmSync } from 'node:fs';

    let testDir: string | null = null;
    
    // In finally/afterAll block:
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
    ```
