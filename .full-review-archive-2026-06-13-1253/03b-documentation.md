# BurnRate Technical Documentation Audit

This document contains a comprehensive technical documentation audit of the BurnRate codebase. It evaluates inline documentation, API documentation, architectural assets, README completeness, and documentation accuracy.

---

## Executive Summary

A review of the project documentation and target files revealed **8 key findings** regarding completeness and accuracy, ranging from **Critical** to **Low** severity.

### Key Summary Points:
1. **Critical Runtime Mismatch:** The main developer reference (`docs/BurnRate_Reference_v2.md`) describes a Python implementation (e.g., `python -m burnrate.etl`) and has a completely incorrect YAML configuration schema, despite the repository being entirely TypeScript/Node.js.
2. **Setup Instructions Out of Sync:** The root `README.md` and `CONTRIBUTING.md` instruct users to run non-existent npm commands (`npm run migrate` and `npm run ingest`), causing the quick start guide to fail immediately.
3. **Misaligned Design Assets:** The root `DESIGN.md` houses frontend style guide tokens (for a Linear-themed web page) instead of system design, architecture diagrams, or components for the BurnRate command-line application.
4. **Sparse Inline Documentation:** Critical business logic—specifically the moving-average forecasting calculations and the ETL pipeline orchestrator—lacks inline comments, JSDoc headers, and mathematical rationale.

---

## Detailed Findings

| ID | Title | Severity | Focus Area |
| :--- | :--- | :--- | :--- |
| **1** | [Severe Runtime/Language Mismatch in Reference Documentation](#1-critical-severe-runtimelanguage-mismatch-in-reference-documentation) | **Critical** | Accuracy |
| **2** | [Non-Existent Commands in README Quick Start & Troubleshooting](#2-high-non-existent-commands-in-readme-quick-start--troubleshooting) | **High** | README Completeness |
| **3** | [Inaccurate Configuration Schema in Reference Documentation](#3-high-inaccurate-configuration-schema-in-reference-documentation) | **High** | Accuracy |
| **4** | [Missing Inline Comments & JSDoc for Forecasting Calculations](#4-medium-missing-inline-comments--jsdoc-for-forecasting-calculations) | **Medium** | Inline Documentation |
| **5** | [Root "DESIGN.md" Mismatch & Lack of Architecture Decision Records (ADRs)](#5-medium-root-designmd-mismatch--lack-of-architecture-decision-records-adrs) | **Medium** | Architecture |
| **6** | [Undocumented Pipeline Error-Swallowing & Bypassed Database Types](#6-medium-undocumented-pipeline-error-swallowing--bypassed-database-types) | **Medium** | Inline Documentation |
| **7** | [Inaccurate Dialect-Checking Imports in AI Agents Guide](#7-low-inaccurate-dialect-checking-imports-in-ai-agents-guide) | **Low** | Accuracy |
| **8** | [Missing Inline Warning Comments on Security Controls (SSRF / YAML Injection)](#8-low-missing-inline-warning-comments-on-security-controls-ssrf--yaml-injection) | **Low** | Inline Documentation |

---

### 1. Critical: Severe Runtime/Language Mismatch in Reference Documentation
* **Location:** `docs/BurnRate_Reference_v2.md` (lines 807-821)
* **Severity:** Critical
* **What is missing or inaccurate:**
  The definitive system reference document (`docs/BurnRate_Reference_v2.md`) describes a Python 3.11+ execution environment and CLI setup (e.g., instructing the user to run `python -m burnrate.etl --once` and `python -m burnrate.check`). However, the BurnRate codebase is fully implemented in Node.js and TypeScript, with no Python code present. This is a severe accuracy mismatch that will fail and confuse developers reading the system guide.
* **Specific documentation recommendation:**
  Rewrite the "Self-Hosting & Configuration" section in `docs/BurnRate_Reference_v2.md` to reference the Node.js 22+ runtime and TypeScript script commands.
  - Replace `python -m burnrate.etl --once` with the actual command `npm run etl`.
  - Replace `python -m burnrate.check` with the actual command `npm run check`.
  - Clarify that Node.js, not Python, is the target runtime environment.

---

### 2. High: Non-Existent Commands in README Quick Start & Troubleshooting
* **Location:** `README.md` (lines 51, 54, 61, 200), `CONTRIBUTING.md` (line 126)
* **Severity:** High
* **What is missing or inaccurate:**
  The `README.md` and `CONTRIBUTING.md` files instruct developers to run `npm run migrate` to apply migrations and `npm run ingest` to run the daily ingestion pipeline. However, these commands do not exist in `package.json`'s script configuration:
  - The script for running the ETL ingestion pipeline is actually `npm run etl` (which executes `tsx src/index.ts etl`).
  - There is no separate `npm run migrate` script. Migrations are executed automatically on start in the `etl` CLI handler (`await runMigrations(db)` inside `src/index.ts`).
  Following the quick start leads to CLI command errors.
* **Specific documentation recommendation:**
  - Add a `"migrate"` script to `package.json` pointing to a script that runs migrations, or update `README.md` and `CONTRIBUTING.md` to explain that migrations run automatically when starting `npm run etl`.
  - Change all references of `npm run ingest` to `npm run etl` throughout the user docs.

---

### 3. High: Inaccurate Configuration Schema in Reference Documentation
* **Location:** `docs/BurnRate_Reference_v2.md` (lines 823-855)
* **Severity:** High
* **What is missing or inaccurate:**
  The reference guide defines a YAML configuration structure (`db: { host, port, database, user, password }`, `storage: { raw_payload }`) that is entirely different from the schema expected by `src/config.ts` and provided in `config/burnrate.sample.yml`. The TypeScript codebase expects:
  ```yaml
  github:
    enterprise: acme
    org: acme-inc
    token: ${GITHUB_TOKEN}
  postgres:
    url: ${DATABASE_URL}
  ```
  If a developer sets up the config file based on `docs/BurnRate_Reference_v2.md`, `loadConfig` throws a missing parameters runtime error.
* **Specific documentation recommendation:**
  Align the configuration sample in `docs/BurnRate_Reference_v2.md` with `config/burnrate.sample.yml` and the `BurnrateConfig` type in `src/config.ts`.

---

### 4. Medium: Missing Inline Comments & JSDoc for Forecasting Calculations
* **Location:** `src/forecast/engine.ts` (lines 1-61)
* **Severity:** Medium
* **What is missing or inaccurate:**
  `src/forecast/engine.ts` contains the core forecast logic using 7-day and 30-day moving averages and divergence threshold classification. This file contains zero JSDoc comments on types/functions and zero inline comments explaining the algorithms, divergence formula, or division-by-zero checks.
* **Specific documentation recommendation:**
  Write JSDoc headers for `computeForecast` and explain the math behind:
  - Divergence percentage calculation.
  - Alert level boundaries (`critical` >= 110%, `escalation` >= 100%, `warning` >= 90%).
  - Safeguard logic for handling a zero or negative `poolTotal`.

---

### 5. Medium: Root "DESIGN.md" Mismatch & Lack of Architecture Decision Records (ADRs)
* **Location:** Root directory, `docs/`
* **Severity:** Medium
* **What is missing or inaccurate:**
  - `DESIGN.md` in the root directory contains front-end design system tokens (colors, font families, radii) for a Linear-themed web page. It does not describe the CLI application design, component layouts, ETL pipeline orchestration, database flow, or system architecture.
  - The repository does not contain any ADRs (Architecture Decision Records) explaining major technical decisions (e.g., choosing raw-first storage to prevent schema drift, dual-dialect branching for PG/SQLite via Drizzle, or manual migration arrays in `migrate.ts`).
* **Specific documentation recommendation:**
  - Rename `DESIGN.md` to `docs/visual-style-guide.md` or similar to clarify it describes the visual styling rules for the pages site.
  - Create a new root `DESIGN.md` or `docs/architecture.md` file featuring system and data-flow diagrams.
  - Set up a `docs/adr/` directory to document architectural choices.

---

### 6. Medium: Undocumented Pipeline Error-Swallowing & Bypassed Database Types
* **Location:** `src/db/client.ts` (line 6), `src/etl/pipeline.ts`
* **Severity:** Medium
* **What is missing or inaccurate:**
  - `src/db/client.ts` uses `export type DbClient = any;`, which completely bypasses TypeScript static compilation checks. The rationale for this bypass is left undocumented.
  - `src/etl/pipeline.ts` catches and swallows API request exceptions (logging them to `console.error` and returning `null`), allowing the pipeline to continue with missing data. The design decisions and criteria for what constitutes a non-fatal vs. fatal error are undocumented.
* **Specific documentation recommendation:**
  - Add inline comments in `src/db/client.ts` explaining the temporary usage of `any` for `DbClient` and the path to replace it with proper typed Drizzle interfaces.
  - Add comments to `runObserveOnlyPipeline` explaining that the pipeline collects fetch errors but continues processing adjacent reports to maximize data availability, aborting only on critical failures.

---

### 7. Low: Inaccurate Dialect-Checking Imports in AI Agents Guide
* **Location:** `docs/AI_AGENTS.md` (lines 150-155)
* **Severity:** Low
* **What is missing or inaccurate:**
  `docs/AI_AGENTS.md` claims that `isSqlite` is imported from `client.ts` (`import { isSqlite } from './client.js'`) to handle dual database schemas. In reality, `client.ts` does not export `isSqlite`. Files instead check the dialect ad-hoc using `typeof db.run === 'function'`.
* **Specific documentation recommendation:**
  Correct the code example in `docs/AI_AGENTS.md` to show the correct ad-hoc dialect check (`typeof db.run === 'function'`) used in the active codebase.

---

### 8. Low: Missing Inline Warning Comments on Security Controls (SSRF / YAML Injection)
* **Location:** `src/github/client.ts` (lines 21-28), `src/config.ts` (lines 12-14)
* **Severity:** Low
* **What is missing or inaccurate:**
  Prior audits identified security vulnerabilities: YAML structure injection in `src/config.ts` and host-spoofing SSRF in `src/github/client.ts`. While fixes may be implemented, the files do not contain comments highlighting the security threats. This omission increases the risk of future modifications inadvertently reverting the security controls.
* **Specific documentation recommendation:**
  - Add security comments in `src/config.ts` near environment substitution explaining the threat of YAML structure hijacking.
  - Add comments in `src/github/client.ts` near the signed URL fetch explaining the SSRF threat model and why host validation is required.
