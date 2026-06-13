# BurnRate

> **Know your Copilot burn before GitHub does.** BurnRate ingests GitHub Copilot usage reports, stores raw payloads for audit history, and produces burn forecasts. No budget writes. No Copilot Skills automation.

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

## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL (or SQLite for local dev)
- GitHub Personal Access Token with `read:org` scope

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
# ENTERPRISE_SLUG=your-enterprise

# Run migrations
npm run migrate

# Run daily ingestion
npm run ingest
```

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run ingest` | Fetch and store today's Copilot reports |
| `npm run forecast` | Generate burn forecasts from stored data |
| `npm run classify` | Classify users by consumption/value tiers |
| `npm run budget-sync` | Sync budget limits and send alerts |
| `npm test` | Run test suite |
| `npm run build` | Compile TypeScript |

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
| **Phase 2** | Complete | User classification by consumption/value tiers |
| **Phase 3** | Complete | Budget sync + notification hub (Slack, GitHub Issues) |
| **Phase 4** | Planned | ULB enforcement with GitHub Budgets API writes |

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/burnrate

# GitHub API
GITHUB_TOKEN=ghp_xxx  # Personal Access Token with read:org scope
ENTERPRISE_SLUG=my-company

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
- **Token scoping**: GitHub PAT requires only `read:org` (no write permissions)
- **Audit trail**: Raw payloads preserved for compliance and debugging

## Troubleshooting

### Common Issues

**"GitHub API returned 403"**
- Verify your PAT has `read:org` scope
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
