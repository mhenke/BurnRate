# Phase 3: Testing & Documentation Review

## Test Coverage Findings

### High
- **Zero PostgreSQL Path Verification**:
  PostgreSQL pool creation (`src/db/client.ts`), PostgreSQL migrations (`src/db/migrate.ts`), PG schemas, and PG-specific raw query statements (using PG type casts/intervals) are completely untested.
- **Untested Security Boundary Implementations**:
  No tests verify defenses against YAML structure hijacking in the config loader or host validation in the signed URL downloader.
- **Unverified Error and Exception Boundaries**:
  Test cases do not verify parser behavior on invalid or floating-point tokens, or forecast engine behavior under zero or negative `poolTotal` values.

### Medium
- **ETL Transaction Rollback Gaps**:
  No integration tests assert that database updates and inserts roll back atomically on pipeline failures.
- **Manual Mock Isolation Pollution Risks**:
  Vitest mock spy cleanup is handled manually within individual tests, risking pollution/leakage into subsequent test blocks if an assertion fails early.

### Low
- **Algorithmic Scale / Regression Tests Missing**:
  No automated performance scale tests verify the event loop execution time of the classification engine under large user datasets (e.g., 10,000+ records).

---

## Documentation Findings

### Critical
- **Severe Language/Runtime Mismatch in System Reference** (`docs/BurnRate_Reference_v2.md`):
  The guide describes a Python-based CLI setup and execution instructions (`python -m burnrate.etl`) despite the codebase being completely Node.js and TypeScript.

### High
- **Inaccurate Configuration Schema in Reference Document** (`docs/BurnRate_Reference_v2.md`):
  Lists a flat database configuration block that diverges from the `BurnrateConfig` structure in `src/config.ts` and causes runtime errors.
- **Missing or Non-Existent Commands in README/CONTRIBUTING**:
  Instructs developers to run `npm run migrate` and `npm run ingest` to setup and run the pipeline, but neither command exists in `package.json`.

### Medium
- **Missing Comments/Math Explanations in Forecast Engine** (`src/forecast/engine.ts`):
  Zero JSDoc comments or inline math formulas explain the core moving-averages, divergence thresholds, and alert classification logic.
- **Visual Styles vs. System Design Mismatch in `DESIGN.md`**:
  `DESIGN.md` in the root contains style tokens for a frontend marketing page rather than component layouts, database flows, or architecture for the CLI tool.
- **Undocumented Architecture Decision Records (ADRs)**:
  The repository has no ADRs documenting major technical decisions like raw-first ingestion storage or dual-dialect Drizzle branching.
- **Undocumented Pipeline Error Swallowing**:
  No documentation explains the rationale for swallowing API fetch errors during metric runs.

### Low
- **Incorrect Dialect Import References in Guides** (`docs/AI_AGENTS.md`):
  Claims that `isSqlite` is exported from `client.ts`, but the codebase checks the dialect ad-hoc using `typeof db.run === 'function'`.
- **Missing Warning Comments on Security Controls**:
  Remediated security boundaries (YAML expansion and signed URLs) lack warning comments, leaving them vulnerable to regression during refactoring.
