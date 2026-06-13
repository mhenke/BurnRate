# BurnRate

> **Observe-only GitHub Copilot budget monitoring.** Daily ingestion, raw payload storage, burn forecasts, and budget alerts, without enforcement or automation.

**Site:** https://mhenke.github.io/BurnRate/

[![Tests](https://github.com/mhenke/BurnRate/actions/workflows/ci.yml/badge.svg)](https://github.com/mhenke/BurnRate/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Repository:** [github.com/mhenke/BurnRate](https://github.com/mhenke/BurnRate)

---

## What Problem Does This Solve?

GitHub Copilot billing arrives at month-end. Sometimes the number surprises you. BurnRate gives you visibility without intervention:

- Daily ingestion of Copilot usage reports from the GitHub API
- Raw payload storage protects against schema drift
- Simple forecasts based on actual usage patterns
- Budget alerts when approaching limits (Phase 3)
- Zero writes to GitHub budget settings. This is monitoring, not enforcement
- Interactive chat queries using Copilot Agent Skills


## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL (or SQLite for local dev)
- GitHub Personal Access Token with `manage_billing:copilot` + `read:org` (org-level) or `read:enterprise` (enterprise-level) scope

### Installation

```bash
# Clone the repository
git clone https://github.com/mhenke/BurnRate.git
cd BurnRate

# Install dependencies
npm install

# Copy environment template
cp .env.sample .env

# Edit .env with your credentials
# DATABASE_URL=postgresql://...
# GITHUB_TOKEN=ghp_...
# GITHUB_ENTERPRISE=your-enterprise
# GITHUB_ORG=your-org

# Run migrations
npm run migrate

# Run daily ingestion
npm run ingest

> To replay a previous day (e.g., after an outage) run `npm run etl -- --day YYYY-MM-DD` to backfill that date.
```

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run migrate` | Create or update the local database schema (PostgreSQL or SQLite) |
| `npm run ingest` | Fetch and store today's Copilot reports (alias for `etl`) |
| `npm run etl` | Fetch reports for a specific day (add `-- --day YYYY-MM-DD` to backfill an earlier date) |
| `npm run forecast` | Generate burn forecasts from stored data |
| `npm run classify` | Classify users by consumption/value tiers |
| `npm run budget-sync` | Sync budget limits and send alerts |
| `npm test` | Run test suite |
| `npm run build` | Compile TypeScript |

### Local Postgres (optional)

BurnRate ships with `docker-compose.yml` so you can start a Postgres 14 instance locally. In a separate shell run:

```bash
docker compose up -d db
```

Then point the CLI at it:

```bash
export DATABASE_URL=postgresql://burnrate:changeme@localhost:5432/burnrate
npm run migrate
npm run ingest
```

This mirrors the Quick Start path without requiring an existing Postgres server.

### Copilot Agent Skills

BurnRate packages Copilot Agent Skills for chat interfaces (like Copilot Chat or Claude Code). Administrators can trigger CLI commands and inspect results using natural language:

- **`@burnrate /forecast`**: Run on-demand monthly usage forecasts and view projected pool utilization.
- **`@burnrate /classify`**: Run user tier classification on-demand (supports optional flags `--value-config` and `--report`).
- **`@burnrate /budget-sync`**: Synchronize user-level budgets and check Slack/Issue alert statuses (supports optional flags `--dry-run` and `--json-logs`).
- **`@burnrate /etl`**: Manually trigger daily usage ingestion and raw report storage.

*Skills are located in the [skills/](file:///home/mhenke/Projects/BurnRate/skills) directory and declared in [plugin.json](file:///home/mhenke/Projects/BurnRate/plugin.json).*

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

### Key Design Decisions

1. **Raw-first storage**: Raw JSON payloads are stored before parsing. This protects historical data from schema changes.

2. **Dual database support**: PostgreSQL for production, SQLite for local development and testing. All queries use Drizzle ORM with `isSqlite` branching where needed.

3. **Modular ETL**: API calls in `src/github/`, parsing in `src/etl/`, database writes in `src/db/`. Strict separation.

4. **Observe-only**: Phase 1-3 read from GitHub but never write budget limits or enforcement rules.

## Project Phases

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | Complete | Observe-only ETL pipeline with raw storage |
| **Phase 2** | In progress | User classification by consumption/value tiers (weekly recalc + value tiers) |
| **Phase 3** | In progress | Budget sync + notification hub (Slack, GitHub Issues) — automation being validated |
| **Phase 4** | Planned | ULB enforcement with GitHub Budgets API writes |

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/burnrate

# GitHub API
GITHUB_TOKEN=ghp_xxx  # Classic PAT with manage_billing:copilot + read:org (org) or read:enterprise (enterprise)
GITHUB_ENTERPRISE=my-company
GITHUB_ORG=my-org

# Notifications (Phase 3)
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
BUDGET_ISSUE_REPO=owner/repo

# Optional
DRY_RUN=true           # Don't write to database or send notifications
JSON_LOGS=true         # Output structured JSON logs
```

### Value Tier Configuration

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
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npx vitest run tests/etl/pipeline.test.ts
```

Test coverage target: **80%** for parsers and forecasting calculations.

## GitHub Actions

BurnRate includes two automated workflows:

- **`weekly-classify.yml`**: Runs every Monday at 6 AM UTC to classify users
- **`daily-budget-check.yml`**: Runs Monday-Friday at 9 AM UTC for budget alerts

Both workflows can be triggered manually via `workflow_dispatch`.

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `raw_reports` | Raw JSON payloads from GitHub API |
| `users` | User profiles with team/value tier assignments |
| `daily_usage` | Per-user daily usage metrics |
| `team_usage` | Aggregated team-level usage |
| `pool_snapshots` | Daily pool-level snapshots with forecasts |
| `budget_snapshots` | Budget limit snapshots (Phase 3) |
| `notification_log` | Notification dispatch history (Phase 3) |
| `classification_history` | User classification changes over time |

See `src/db/schema.ts` for full schema definitions.

## Security

- **No hardcoded secrets**: All credentials via environment variables or `dotenv`
- **Parameterized queries**: Drizzle ORM prevents SQL injection by default
- **Token scoping**: GitHub PAT requires `manage_billing:copilot` + `read:org` (org-level) or `read:enterprise` (enterprise-level). No write permissions needed for observe-only phases.
- **Audit trail**: Raw payloads preserved for compliance and debugging
- **SSRF Prevention**: `fetchSignedUrl` strictly validates that targets are HTTPS and limited to a whitelisted set of GitHub API and S3 CDN domains
- **Config Syntax Injection Protection**: Configuration YAML parsing happens before environment variable expansion, ensuring environment variable payloads cannot inject or override configuration keys


## Troubleshooting

### Common Issues

**"GitHub API returned 403"**
- Verify your PAT has `manage_billing:copilot` + `read:org` (org) or `read:enterprise` (enterprise) scope
- Check enterprise slug is correct
- Ensure your account has billing admin access

**"Database connection failed"**
- For PostgreSQL: verify connection string format
- For SQLite: ensure directory is writable
- Run `npm run migrate` before first use

**"No data in reports"**
- Confirm enterprise has Copilot Business/Enterprise
- Check that users have activity in the selected date range
- Review `raw_reports` table for API response payloads

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

## Acknowledgments

Built with:
- [Drizzle ORM](https://orm.drizzle.team/) — Type-safe SQL
- [Vitest](https://vitest.dev/) — Fast unit testing
- [Octokit](https://octokit.github.io/) — GitHub API client
- [GitHub Actions](https://github.com/features/actions) — CI/CD

---

**BurnRate** · Know your burn before GitHub does.
