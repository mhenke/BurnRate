# BurnRate

> Observe-only GitHub Copilot budget monitoring. Daily ingestion, raw payload storage, burn forecasts, and budget alerts. No enforcement or automation.

**Site:** https://mhenke.github.io/BurnRate/

[![Tests](https://github.com/mhenke/BurnRate/actions/workflows/ci.yml/badge.svg)](https://github.com/mhenke/BurnRate/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Repository:** [github.com/mhenke/BurnRate](https://github.com/mhenke/BurnRate)

---

## The gap

GitHub ships enforcement controls for Copilot billing: enterprise budgets, cost-center budgets, user-level hard caps, spending limits, and static alerts at 75/90/100 percent. What it does not ship is observability, forecasting, attribution, or automation around Copilot AI Credit consumption.

An example: GitHub's included-usage alerts cover Actions, Packages, Codespaces, and LFS. Copilot AI Credits are not in that list. If you monitor AI spend, you get no "90% of included usage consumed" alert for your Copilot pool.

BurnRate fills that gap:

- Ingests Copilot usage reports from the GitHub API every day
- Stores raw payloads so schema changes do not erase history
- Produces forecasts from actual usage patterns
- Alerts when budgets approach limits (Phase 3)
- Pushes to Slack and GitHub Issues (Phase 3)
- Supports interactive chat queries via Copilot Agent Skills
- Writes nothing to GitHub. Monitoring, not enforcement.

## Quick start

### Prerequisites

- Node.js 22+
- PostgreSQL or SQLite for local dev
- GitHub PAT with `manage_billing:copilot` + `read:org` (org) or `read:enterprise` (enterprise) scope

### Installation

```bash
git clone https://github.com/mhenke/BurnRate.git
cd BurnRate
npm install
cp .env.sample .env
# edit .env with your credentials

npm run migrate
npm run ingest
```

To backfill a previous day: `npm run etl -- --day YYYY-MM-DD`.

### Available commands

| Command | Description |
|---------|-------------|
| `npm run migrate` | Create or update the database schema |
| `npm run ingest` | Fetch and store today's Copilot reports |
| `npm run etl` | Fetch reports for a specific day (use `--day YYYY-MM-DD` to backfill) |
| `npm run forecast` | Generate burn forecasts from stored data |
| `npm run classify` | Classify users by consumption and value tiers |
| `npm run budget-sync` | Sync budget limits and send alerts |
| `npm test` | Run the test suite |
| `npm run build` | Compile TypeScript |

### Local Postgres (optional)

BurnRate ships a `docker-compose.yml` for Postgres 14. In a separate shell:

```bash
docker compose up -d db
```

Then:

```bash
export DATABASE_URL=postgresql://burnrate:changeme@localhost:5432/burnrate
npm run migrate
npm run ingest
```

### Copilot Agent Skills

The repo includes Copilot Agent Skills for chat interfaces like Copilot Chat and Claude Code. Admins can run CLI commands in natural language:

- `@burnrate /forecast`: on-demand monthly usage forecasts
- `@burnrate /classify`: run user tier classification (supports `--value-config` and `--report`)
- `@burnrate /budget-sync`: sync user budgets and check alert statuses (supports `--dry-run` and `--json-logs`)
- `@burnrate /etl`: trigger daily usage ingestion

Skills live in [skills/](file:///home/mhenke/Projects/BurnRate/skills) and are declared in [plugin.json](file:///home/mhenke/Projects/BurnRate/plugin.json).

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  GitHub API     │────▶│  ETL Layer   │────▶│   PostgreSQL    │
│  (Copilot)      │     │  (src/github/│     │   (raw_reports) │
│                 │     │   src/etl/)  │     │                 │
└─────────────────┘     └──────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │  Forecast    │
                        │  (src/forecast/)
                        └──────────────┘
```

### Key design decisions

1. **Raw-first storage.** JSON payloads are stored before parsing. Schema changes do not corrupt historical data.

2. **Dual database support.** PostgreSQL for production, SQLite for local dev. Queries use Drizzle ORM with `isSqlite` branching where needed.

3. **Modular ETL.** API calls in `src/github/`, parsing in `src/etl/`, database writes in `src/db/`. Strict separation.

4. **Observe-only.** Phases 1-3 read from GitHub but never write budget limits or enforcement rules.

## Project phases

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | ✅ Complete | Observe-only ETL pipeline with raw storage |
| **Phase 2** | ✅ Complete | User classification by consumption and value tiers |
| **Phase 3** | ✅ Complete | Budget sync and notification hub (Slack, GitHub Issues) |
| **Phase 4** | 📋 Planned | ULB enforcement with GitHub Budgets API writes |

## Configuration

### Environment variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/burnrate

# GitHub API
GITHUB_TOKEN=ghp_xxx
GITHUB_ENTERPRISE=my-company
GITHUB_ORG=my-org

# Notifications (Phase 3)
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
BUDGET_ISSUE_REPO=owner/repo

# Optional
DRY_RUN=true           # skip DB writes and notifications
JSON_LOGS=true         # output structured JSON
```

### Value tier configuration

Create `config/value_config.yml` to define team-based value tiers:

```yaml
teams:
  - name: Platform Engineering
    value_tier: extreme
  - name: Data Science
    value_tier: high
  - name: Internal Tools
    value_tier: medium
  - name: QA
    value_tier: low
```

## Testing

```bash
npm test
npm test -- --coverage
npx vitest run tests/etl/pipeline.test.ts
```

Coverage target: 80% for parsers and forecasting calculations.

## GitHub Actions

Automated workflows:

- `nightly-etl.yml`: daily at 1 AM UTC, fetches and stores usage reports
- `daily-forecast.yml`: daily at 8 AM UTC, computes burn forecasts
- `weekly-classify.yml`: Monday at 6 AM UTC, classifies users
- `daily-budget-check.yml`: Monday-Friday at 9 AM UTC, syncs budgets and sends alerts

All workflows support `workflow_dispatch` for manual triggering.

## Database schema

### Core tables

| Table | Purpose |
|-------|---------|
| `raw_reports` | Raw JSON payloads from GitHub API |
| `users` | User profiles with team and value tier assignments |
| `daily_usage` | Per-user daily usage metrics |
| `team_usage` | Aggregated team-level usage |
| `pool_snapshots` | Daily pool-level snapshots with forecasts |
| `budget_snapshots` | Budget limit snapshots (Phase 3) |
| `notification_log` | Notification dispatch history (Phase 3) |
| `classification_history` | User classification changes over time |

Full schema definitions live in `src/db/schema.ts`.

## Security

- No hardcoded secrets. All credentials via environment variables or dotenv.
- Parameterized queries. Drizzle ORM prevents SQL injection by default.
- Token scoping. GitHub PAT requires `manage_billing:copilot` plus `read:org` (org) or `read:enterprise` (enterprise). No write permissions needed for observe-only phases.
- Audit trail. Raw payloads are preserved for compliance and debugging.
- SSRF prevention. `fetchSignedUrl` validates that targets are HTTPS and whitelisted to GitHub API and S3 CDN domains.
- Config injection protection. YAML parsing happens before env var expansion, so payloads cannot inject config keys.

## Troubleshooting

**"GitHub API returned 403"**
- Verify your PAT has the right scope
- Check the enterprise slug
- Confirm your account has billing admin access

**"Database connection failed"**
- PostgreSQL: verify the connection string format
- SQLite: make sure the directory is writable
- Run `npm run migrate` first

**"No data in reports"**
- Confirm the enterprise has Copilot Business or Enterprise
- Check that users have activity in the date range
- Look at `raw_reports` for API response payloads

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

- [Drizzle ORM](https://orm.drizzle.team/)
- [Vitest](https://vitest.dev/)
- [Octokit](https://github.com/octokit/octokit.js)
- [GitHub Actions](https://github.com/features/actions)

---

**BurnRate** - Know your burn before GitHub does.
