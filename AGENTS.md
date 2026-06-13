# AGENTS.md — BurnRate
> Last updated: 2026-06-13T07:18:00-05:00
> This file defines the rules, patterns, and guardrails for all AI agents working on this project.

## How to Read This File
Every agent working on this codebase must read this file before performing any task. Follow the instructions, constraints, and workflow patterns defined below.

## Stack Context
Node.js + TypeScript + Drizzle ORM (PostgreSQL + SQLite) + Vitest + GitHub Actions.

## Code Style Rules
- DO use standard async/await syntax for asynchronous operations.
- DO specify explicit types for all interfaces, parameters, and return types (no implicit `any`).
- DO use `X-GitHub-Api-Version: 2026-03-10` on all GitHub API requests.
- DON'T hardcode secrets, passwords, or tokens. Use `dotenv` or config files.

## Architecture Guardrails
- Always store the raw JSON reports directly in the `raw_reports` table BEFORE parsing. This protects history from schema drift.
- Use database transactions (via the Drizzle client) for multi-statement inserts or updates.
- Keep the ETL processing modular: API calls in `src/github/`, database writes in `src/db/`, and parsing in `src/etl/`.

## Testing Requirements
- Unit tests must be written for all parsers and mathematical forecasting calculations.
- Test coverage for new code in these areas must meet or exceed 80%.
- Use `vitest` for running tests, and mock all API calls.

## Security Rules (All Agents)
- Never commit actual environment secrets or tokens to the repository.
- Ensure SQL queries are parameterized (no string interpolation of user inputs) to prevent SQL injection.

## Superpowers Plan Execution Workflow
We use the **superpowers** framework for implementing plans. All development is guided by structured markdown plans inside the `docs/superpowers/plans/` directory.

### Plan Updates
- Before starting any task, read the active plan (e.g., [docs/superpowers/plans/2026-06-13-burnrate-phase-1-observe-only.md](file:///home/mhenke/Projects/BurnRate/docs/superpowers/plans/2026-06-13-burnrate-phase-1-observe-only.md)).
- Mark tasks as in-progress or complete by editing the checkboxes (`[ ]` to `[x]`) in the plan file.
- Update the plan file incrementally as tasks are completed and commit changes.

### TDD Execution
For each step in a task:
1. Write the failing test.
2. Run the test and verify it fails (Red).
3. Implement the minimum code to make it pass.
4. Run the test and verify it passes (Green).
5. Commit the task progress.
