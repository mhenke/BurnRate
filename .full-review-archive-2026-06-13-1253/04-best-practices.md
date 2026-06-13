# Phase 4: Best Practices & Standards

## Framework & Language Findings

### Critical
- **Month-to-Date Forecast Off-by-One Mismatch** (`src/index.ts` L129-148):
  Calculates `daysElapsed` as `now.getDate()`. Since the ETL pipeline processes data with a one-day delay, the database only holds usage records up to yesterday (i.e. `daysElapsed - 1` days). This causes forecast calculations to consistently under-forecast by exactly one day's average.

### High
- **Bypassing Drizzle Migrations with Hardcoded SQL** (`src/db/migrate.ts` / `schema.ts`):
  Database schemas are duplicated across definitions in `schema.ts` and raw DDL strings in `migrate.ts` instead of using Drizzle's official `migrate()` function and auto-generating versioning scripts via `drizzle-kit`.
- **YAML Structure Injection in Config Loader** (`src/config.ts` L12-14):
  Environment variables are expanded via regex on the raw config text before parsing, rendering it vulnerable to YAML syntax injection that could hijack configuration keys.
- **SSRF Vulnerability in Signed URL Downloader** (`src/github/client.ts` L21-28):
  `fetchSignedUrl` retrieves files from arbitrary URLs without protocol or host verification.
- **Database Dialect Coupling in Business Logic** (`src/db/client.ts` / `src/etl/pipeline.ts`):
  Uses ad-hoc checks (like `typeof db.run === 'function'`) and manual schema routing to distinguish dialects, complicating dialect switching.

### Medium
- **Bypassed TypeScript Types (`DbClient = any`)** (`src/db/client.ts` L6):
  Disables type-safety checks and autocomplete on Drizzle queries across the codebase.
- **Side Effects in Module Scope & Dotenv Redundancy** (`src/config.ts`):
  Importing the config file triggers global side-effects (`dotenvConfig()`), and dotenv is redundant in modern Node.js environments (20.6+) which natively support `.env` files via `--env-file`.
- **Sequential ETL Writes and Missing Transactions** (`src/etl/pipeline.ts`):
  Chains network requests and database writes sequentially inside loops without transactions, violating transaction requirements in `AGENTS.md` guidelines.

---

## CI/CD & DevOps Findings

### Critical
- **Gitignored Configuration Files Cause Scheduled Workflows to Fail** (`.github/workflows/` daily & weekly jobs):
  The scheduled actions attempt to run the CLI passing configuration paths (`config/burnrate.yml` and `config/value_config.yml`) that are gitignored. Because the runner environment does not copy or provision these files, all production cron jobs crash immediately with `ENOENT`.

### High
- **Non-Transactional Ingestion Writes** (`src/etl/pipeline.ts`):
  Ingestion writes occur sequentially outside database transactions, risking database corruption and forecast skew if interrupted mid-run.
- **Lack of PostgreSQL Integration/Dialect Testing in CI** (`.github/workflows/ci.yml`):
  All CI tests run against SQLite `:memory:`, leaving Postgres pool settings, migrations, native PG schemas (e.g. `jsonb`, `timestamptz`), and queries completely untested in CI.

### Medium
- **Automated Database Migrations inside Cron Job Runtime** (`src/index.ts`):
  The ETL pipeline command runs migrations automatically on start. This requires cron tasks to have elevated database permissions (DDL) and risks lock contention.
- **SSRF Target Vulnerability** (`src/github/client.ts`):
  Lack of domain boundaries on fetches allows SSRF to internal metadata endpoints.
- **$O(N^2)$ Classification Loop** (`src/classify/engine.ts`):
  Nested loops on user classification block Node's single-threaded event loop under large datasets.
- **Absent Failure Alerting in Scheduled Production Workflows** (`.github/workflows/`):
  Scheduled jobs lack alerting (e.g. slack webhooks on `if: failure()`), leaving run failures completely silent.

### Low
- **Missing package.json Scripts** (`package.json`):
  Does not define aliases for `npm run ingest` or `npm run migrate` mentioned in troubleshooting documentation.
- **Hardcoded Connection Pool Limit (`max: 5`)** (`src/db/client.ts` L14):
  Hardcoded connection limit restricts scalability under parallel execution.
