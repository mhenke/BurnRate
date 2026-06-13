# BurnRate DevOps and Operational Review

This document contains a comprehensive analysis of the BurnRate project's CI/CD pipeline, operational practices, deployment strategies, monitoring/observability, incident response, infrastructure as code, and environment management.

---

## Executive Summary

An evaluation of the active codebase and GitHub Actions workflows revealed **9 key findings** ranging from **Critical** to **Low** severity. 

The most urgent issue is a **Critical operational bug** in the production workflow files, which attempt to load configuration files (`config/burnrate.yml` and `config/value_config.yml`) that are gitignored and never provisioned during job runs, causing all scheduled production workflows to fail immediately with `ENOENT` errors.

Other significant concerns include **High-severity** non-transactional database writes in the ETL ingestion pipeline and the lack of any PostgreSQL integration/dialect testing in CI (despite PostgreSQL being the target production database).

Additionally, the review identified several **Medium-severity** issues concerning automated migrations executed during scheduled jobs, an SSRF vulnerability in the GitHub API signed URL fetching logic, a CPU-blocking $O(N^2)$ algorithm in user classification, and the absence of failure alerting for scheduled jobs.

---

## Detailed Findings

### 1. Critical: Gitignored Configuration Files Cause Scheduled Workflows to Fail
* **Location:** `.github/workflows/daily-budget-check.yml`, `.github/workflows/daily-forecast.yml`, `.github/workflows/nightly-etl.yml`, `.github/workflows/weekly-classify.yml`
* **Severity:** Critical
* **Operational Risk Assessment:** All scheduled production workflows (ETL, daily forecast, budget checks, and user classification) will fail instantly upon execution. The workflows pass configuration paths (`BURNRATE_CONFIG: config/burnrate.yml` and `VALUE_CONFIG_PATH: config/value_config.yml`) to the application, but these files are gitignored and never created in the GitHub Actions runner environment. This leads to immediate application crashes with `ENOENT: no such file or directory` errors.
* **Description:** 
  The codebase uses a configuration loader (`src/config.ts` and `src/classify/value_config.ts`) that calls `readFileSync` on the config paths without fallback or checking for file existence. The workflows execute the CLI directly without provisioning these files.
* **Recommendation:** 
  Update the scheduled GitHub Actions workflows to copy the provided sample configuration files to the expected paths prior to running the commands. Since the sample configurations dynamically reference environment variables (e.g. `${DATABASE_URL}` and `${GITHUB_TOKEN}`), the Node app will expand them correctly at runtime:
  
  ```yaml
  # Add this step to scheduled workflows before executing the scripts:
  - name: Setup Configuration Files
    run: |
      cp config/burnrate.sample.yml config/burnrate.yml
      cp config/value_config.sample.yml config/value_config.yml
  ```

---

### 2. High: Non-Transactional Database Writes in Ingestion Pipeline
* **Location:** `src/etl/pipeline.ts` (lines 55-244)
* **Severity:** High
* **Operational Risk Assessment:** If the pipeline experiences an API timeout, rate-limiting block, process termination, or database interruption midway through its sequential execution, the database will be left in a partially updated, skewed state. Some tables (e.g., `raw_reports`) will contain the daily logs, but others (e.g., `daily_usage`, `team_usage`, `users`) will lack associated updates. This breaks database integrity and complicates recovery or safe retries.
* **Description:** 
  The ingestion pipeline `runObserveOnlyPipeline` executes multiple separate SQL inserts/updates for `raw_reports`, `users`, `daily_usage`, and `team_usage` inside loops and async calls. None of these database writes are wrapped in a database transaction.
* **Recommendation:** 
  Refactor `runObserveOnlyPipeline` to wrap its internal database operations in a transaction using the Drizzle client (`db.transaction`). This ensures that either all database writes for the day succeed, or the entire operation is rolled back safely on failure:
  
  ```typescript
  export async function runObserveOnlyPipeline(
    gh: GitHubClient,
    db: DbClient,
    day: string,
  ): Promise<PipelineResult> {
    const result: PipelineResult = { rawStored: 0, usageUpserted: 0, errors: [] };
    const isSqlite = typeof db.run === 'function';
    
    // Wrap database operations in a transaction
    return await db.transaction(async (tx: any) => {
      // Perform all insertions/updates using tx instead of db
      // ...
      return result;
    });
  }
  ```

---

### 3. High: Lack of PostgreSQL Integration and Dialect Testing in CI
* **Location:** `.github/workflows/ci.yml`, `tests/db/client.test.ts`, `tests/db/schema.test.ts`
* **Severity:** High
* **Operational Risk Assessment:** Although the production database uses PostgreSQL, the automated test suite and CI pipeline run exclusively against SQLite in-memory (`:memory:`). Postgres and SQLite have significant differences in SQL syntax, constraints, data types (e.g., `JSONB`, `NUMERIC(precision, scale)`, `TIMESTAMPTZ`, and `BIGSERIAL` in Postgres vs. text/numeric representation in SQLite), and driver implementations. Schema changes or query adjustments that succeed against SQLite can easily crash with database syntax or type errors in production.
* **Description:** 
  No PostgreSQL instance is spawned during testing, and the CI workflow (`ci.yml`) does not define any service container or Docker service for PG testing.
* **Recommendation:** 
  1. Add a PostgreSQL service container to `.github/workflows/ci.yml`.
  2. Implement database integration tests that run migrations and sample queries against a live PostgreSQL container when `DATABASE_URL` is set to a postgres connection string:
  
  ```yaml
  # Example addition to ci.yml
  jobs:
    test:
      runs-on: ubuntu-latest
      services:
        postgres:
          image: postgres:16
          env:
            POSTGRES_DB: burnrate_test
            POSTGRES_USER: test_user
            POSTGRES_PASSWORD: test_password
          ports:
            - 5432:5432
          options: >-
            --health-cmd pg_isready
            --health-interval 10s
            --health-timeout 5s
            --health-retries 5
  ```

---

### 4. Medium: Automatically Executing Migrations in Scheduled Job Runtimes
* **Location:** `src/index.ts` (line 103)
* **Severity:** Medium
* **Operational Risk Assessment:** 
  Running schema migrations (`await runMigrations(db)`) inside the scheduled ETL run creates several operational liabilities:
  1. **Privilege Violations:** The runner executing the ETL pipeline requires elevated database permissions (DDL capability like `CREATE TABLE`) rather than standard read/write (DML) permissions.
  2. **Concurrency Risks:** If scheduled ETL tasks run concurrently or are manually triggered, they may conflict/deadlock on schema changes.
  3. **Silent Deploy Failures:** If a buggy database schema changes the codebase, the deployment will succeed, and the error will only emerge hours later during the nightly ETL run, risking silent failure.
* **Description:** 
  The `etl` command automatically triggers `runMigrations(db)` before initiating the ingestion pipeline.
* **Recommendation:** 
  Decouple database migrations from standard pipeline execution. Create a dedicated migration command (e.g. `npm run db:migrate` or `npx tsx src/db/migrate-cli.ts`) and run it as an explicit deployment step or release phase. Keep the ETL job's database credentials restricted to DML permissions.

---

### 5. Medium: Security Vulnerability (SSRF) in GitHub Signed URL Fetching
* **Location:** `src/github/client.ts` (lines 21-28)
* **Severity:** Medium
* **Operational Risk Assessment:** An attacker who manages to spoof or compromise a GitHub Copilot API response could supply malicious download links. Because the application blindly fetches these URLs, it can be exploited to conduct Server-Side Request Forgery (SSRF) attacks targeting cloud metadata endpoints (e.g., `169.254.169.254`) or internal resources.
* **Description:** 
  The `fetchSignedUrl` helper performs a raw HTTP `fetch(url)` command on the argument string without checking or validating the hostname.
* **Recommendation:** 
  Introduce domain validation in `fetchSignedUrl` to guarantee that fetches only target trusted locations (like S3/Azure storage buckets owned by GitHub or `api.github.com`):
  
  ```typescript
  async function fetchSignedUrl<T>(url: string): Promise<T> {
    const parsed = new URL(url);
    const allowedDomains = ['github.com', 'api.github.com', 'github-cloud.s3.amazonaws.com'];
    
    if (!allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
      throw new Error(`SSRF Prevention: Fetch target domain forbidden: ${parsed.hostname}`);
    }
    
    const response = await fetch(url);
    // ...
  }
  ```

---

### 6. Medium: $O(N^2)$ CPU-Blocking Loop in User Classification
* **Location:** `src/classify/engine.ts` (lines 43-48, 105-106)
* **Severity:** Medium
* **Operational Risk Assessment:** As the number of active users grows (e.g., in a large enterprise with 10k+ users), the user classification job will consume significant CPU resources and block the Node.js event loop. This could result in execution timeouts, increased runner costs, or app freezes.
* **Description:** 
  The `classifyUsers` function runs a loop over all users. In each iteration, it calls `computePercentile`, which performs a full array scan (`sortedCredits.filter(...)`) to count elements. This creates a nested loop with quadratic time complexity ($O(N^2)$).
* **Recommendation:** 
  Optimize the percentile logic. Because `sortedCredits` is pre-sorted, we can map each credit to its percentile in a single linear $O(N)$ pass, reducing the overall time complexity to $O(N \log N)$ (sorting) + $O(N)$ (mapping):
  
  ```typescript
  // Pre-calculate percentiles in a single loop:
  const creditPercentiles = new Map<number, number>();
  for (let i = 0; i < sortedCredits.length; i++) {
    // Stores the highest index (percentile) for the credit value
    creditPercentiles.set(sortedCredits[i], (i + 1) / sortedCredits.length);
  }
  
  // Inside the user loop, look up the percentile in O(1) time:
  const percentile = creditPercentiles.get(uc.totalCredits) ?? 0;
  ```

---

### 7. Medium: Absent Failure Alerting in Scheduled Production Workflows
* **Location:** `.github/workflows/nightly-etl.yml`, `.github/workflows/daily-forecast.yml`, `.github/workflows/weekly-classify.yml`
* **Severity:** Medium
* **Operational Risk Assessment:** If a scheduled cron job fails (due to API failures, network dropouts, database downtime, or configuration errors), there is no mechanism to notify the team. Failures will remain completely silent until someone manually inspects the GitHub Actions run history, potentially delaying response times for days or weeks.
* **Description:** 
  Unlike `daily-budget-check.yml` (which has Slack integration for budget limits), the scheduled workflows do not have alerting or webhook notification steps for job failures.
* **Recommendation:** 
  Add a failure fallback step to scheduled workflows that notifies the engineering team via Slack, Teams, or pager channels using webhooks:
  
  ```yaml
  - name: Alert on Failure
    if: failure()
    run: |
      curl -X POST -H 'Content-type: application/json' \
        --data '{"text":"🚨 Scheduled BurnRate Workflow Failed: **${{ github.workflow }}** (Run ID: ${{ github.run_id }})"}' \
        ${{ secrets.SLACK_WEBHOOK_URL }}
  ```

---

### 8. Low: Missing and Outdated package.json Scripts
* **Location:** `package.json`
* **Severity:** Low
* **Operational Risk Assessment:** Developers or deploy scripts trying to run `npm run ingest` or `npm run migrate` (as mentioned in codebase documentation and common workflow manuals) will fail immediately due to missing script definitions.
* **Description:** 
  The package file defines `check`, `etl`, `forecast`, `classify`, and `budget-sync`, but lacks explicit `ingest` or `migrate` configurations.
* **Recommendation:** 
  Add aliases in `package.json` pointing to the proper entrypoint commands:
  
  ```json
  "scripts": {
    "migrate": "tsx src/db/migrate.ts",
    "ingest": "tsx src/index.ts etl"
  }
  ```

---

### 9. Low: Hardcoded Connection Pool Limit (`max: 5`)
* **Location:** `src/db/client.ts` (line 14)
* **Severity:** Low
* **Operational Risk Assessment:** A pool limit of 5 is highly restrictive and can result in execution bottlenecks or connection timeouts if concurrent queries or multiple pipelines execute in parallel.
* **Description:** 
  The PostgreSQL pool creation is hardcoded: `pgPool = new pg.Pool({ connectionString, max: 5 });`.
* **Recommendation:** 
  Make the connection pool limit configurable via environment variables (e.g. `DATABASE_POOL_MAX`), falling back to a sensible default like `10` or `20`:
  
  ```typescript
  const maxPoolSize = process.env.DATABASE_POOL_MAX ? parseInt(process.env.DATABASE_POOL_MAX, 10) : 10;
  pgPool = new pg.Pool({ connectionString, max: maxPoolSize });
  ```
