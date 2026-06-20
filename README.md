# BurnRate

> GitHub Copilot budget monitoring and enforcement. Pulls daily usage, stores raw payloads, forecasts burn, classifies users, syncs budgets, and enforces per-user level budgets (ULBs) to prevent pool exhaustion.

**Site:** https://mhenke.github.io/BurnRate/

[![Tests](https://github.com/mhenke/BurnRate/actions/workflows/ci.yml/badge.svg)](https://github.com/mhenke/BurnRate/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Repository:** [github.com/mhenke/BurnRate](https://github.com/mhenke/BurnRate)

---

## The gap

GitHub gives you enforcement controls for Copilot billing: enterprise budgets, cost-center budgets, user-level hard caps, spending limits, and static alerts at 75/90/100 percent. It does not give you much observability, forecasting, attribution, or automation around Copilot AI Credit consumption.

For example, GitHub's included-usage alerts cover Actions, Packages, Codespaces, and LFS. Copilot AI Credits are not in that list. If you want a "90% of included usage consumed" alert for your Copilot pool, you will not get it from GitHub.

BurnRate fills that gap. Every day it pulls your Copilot usage from the GitHub API and stores the raw payloads, so a schema change does not erase history. It forecasts month-end burn from actual usage and alerts when budgets approach limits. You can also ask it questions through Copilot Agent Skills. It writes nothing to GitHub. It just watches.

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
| `npm run enforce` | Run daily ULB enforcement (supports `--report` and `--dry-run`) |
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
                        ┌──────────────┐     ┌─────────────────┐
                        │  Forecast    │────▶│  Classify       │
                        │  (src/forecast/)   │  (src/classify/) │
                        └──────────────┘     └─────────────────┘
                               │                    │
                               ▼                    ▼
                        ┌──────────────┐     ┌─────────────────┐
                        │ Budget Sync  │     │  Enforce        │
                        │ (src/budget/)│     │  (src/enforce/) │
                        └──────────────┘     └─────────────────┘
```

### Key design decisions

1. **Raw-first storage.** JSON payloads are stored before parsing, so schema changes do not corrupt historical data.

2. **Dual database support.** PostgreSQL for production, SQLite for local dev. Queries branch on `isSqlite` where Drizzle behavior differs.

3. **Modular ETL.** API calls live in `src/github/`, parsing in `src/etl/`, and database writes in `src/db/`.

4. **Enforcement added in Phase 4.** The enforce engine calculates per-user budgets (ULBs) from 30-day averages and writes them to `ulb_audit`. v1 is observe-only for GitHub's Budgets API — ULBs are calculated and audited but not yet pushed to GitHub.

## Project phases

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | ✅ Complete | Observe-only ETL pipeline with raw storage |
| **Phase 2** | ✅ Complete | User classification by consumption and value tiers |
| **Phase 3** | ✅ Complete | Budget sync and notification hub (Slack, GitHub Issues) |
| **Phase 4** | ✅ Complete | ULB enforcement with daily projection and per-user budget audits |

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

# Budget enforcement (Phase 4)
BUDGET_MODE=hard           # hard (guarantee pool containment) | soft (tolerate overage)
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
- `daily-enforce.yml`: daily at 1 AM UTC, runs ULB enforcement and writes audit records

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
| `ulb_audit` | Per-user ULB audit trail (Phase 4) |
| `classification_history` | User classification changes over time |

Full schema definitions live in `src/db/schema.ts`.

## Security

Credentials come from environment variables or dotenv, never from code. Drizzle ORM uses parameterized queries by default, so SQL injection is not a concern. The GitHub PAT only needs `manage_billing:copilot` plus `read:org` (org) or `read:enterprise` (enterprise). No write permissions are needed for observe-only phases. Raw payloads are preserved for audit and debugging. `fetchSignedUrl` only accepts HTTPS URLs on the GitHub API and S3 CDN domains. YAML parsing runs before env var expansion, so payloads cannot inject config keys.

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
