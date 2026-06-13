# BurnRate Developer Onboarding Guide

Welcome to the **BurnRate** engineering team! This guide maps out your onboarding path from pre-arrival through your first 90 days, tailored specifically to our codebase, tech stack, and development workflows.

---

## 1. Technical Stack Overview

Before diving in, familiarize yourself with our core stack:
* **Runtime**: Node.js 22+ (TypeScript)
* **Database Layer**: Drizzle ORM supporting dual engines:
  * **SQLite** (In-memory/local file) for local development and unit tests.
  * **PostgreSQL** for production environments.
* **API Ingestion**: Octokit (GitHub API Client) fetching Copilot Usage Reports.
* **Testing**: Vitest (strict unit and integration tests, TDD execution).
* **CI/CD**: GitHub Actions workflows for scheduling daily ingestion, forecasts, user classification, and budget syncs.
* **Interactions**: GitHub Copilot Agent Skills (interactive chat commands under `skills/`).

---

## 2. Onboarding Milestones (30/60/90 Day Plan)

### Pre-Boarding (1 Week Before)
- [ ] Hardware shipped with tracking (standard company-provided setup).
- [ ] GitHub account invited to the organization.
- [ ] Slack, password manager (SSO), and AWS/Postgres read-only credentials created.
- [ ] Welcome email with Day 1 agenda sent.
- [ ] Onboarding Buddy assigned (buddy details in Slack channel `#burnrate-dev`).

### Day 1: Orientation & Access Setup
- [ ] **Morning**: Manager 1:1 welcome, team introductions, and review of onboarding milestones.
- [ ] **Afternoon**: IT setup and laptop security configuration (2FA, Password Manager, VPN).
- [ ] **Security Training**: Read `AGENTS.md` and `docs/AI_AGENTS.md` to understand our codebase guardrails and developer rules.
- [ ] **Local Check**: Verify access to GitHub, Slack channels, and target organization repositories.

### Week 1: Codebase Immersion & Local Environment
- [ ] **Repository Setup**: Clone and build the project locally (see Section 3).
- [ ] **Architecture Tour**: Walk through the ETL pipeline, raw-first storage design, and forecast engine with your buddy.
- [ ] **First Code Contribution**:
  - Locate a task labeled `good-first-issue` (such as adjusting classification percentiles or adding a slack message formatter test).
  - Write a failing test (TDD RED phase).
  - Implement a surgical fix (TDD GREEN phase).
  - Submit your first Pull Request, verify CI checks pass, and participate in code review.

### Day 30 Checkpoint: Autonomy in Ingestion & ETL
- [ ] Complete setup of local SQLite and PostgreSQL database engines.
- [ ] Merge at least 3 pull requests containing verified test coverage.
- [ ] Review and detail one area of codebase architecture (e.g., adding documentation to a raw parser).
- [ ] Perform a manual dry run of the classification and forecast pipelines locally.
- **Success Criteria:** Fully functional development environment and comfortable navigating the ETL flows.

### Day 60 Checkpoint: Ownership of Small Features
- [ ] Own a small feature or optimization (e.g., adding notifications to Discord, writing a custom value config helper).
- [ ] Participate in on-call rotation shadowing.
- [ ] Review at least 5 pull requests from other team members.
- [ ] Contribute to the technical design of a Phase 4 ULB enforcement step.
- **Success Criteria:** Shipped one minor feature to production; active contributor in PR reviews.

### Day 90 Checkpoint: Fully Integrated Developer
- [ ] Autonomously design, implement, and test a full feature end-to-end.
- [ ] Handle on-call rotations with supervision.
- [ ] Actively participate in sprint planning, estimation, and retro ceremonies.
- [ ] Mentor a newer team member on BurnRate's raw storage and database migration setup.
- **Success Criteria:** Fully autonomous contributor to the core platform.

---

## 3. Local Development Setup

Follow these steps to configure your local development environment:

### Step 1: Clone the Repository & Install Deps
```bash
git clone https://github.com/mhenke/BurnRate.git
cd BurnRate
npm install
```

### Step 2: Configure Environment Variables
Copy the sample environment file and adjust configuration values:
```bash
cp .env.sample .env
```
Ensure your `.env` contains:
```bash
DATABASE_URL=sqlite.db       # Will create local SQLite file
GITHUB_TOKEN=ghp_your_pat    # A Personal Access Token with read:org scope
GITHUB_ENTERPRISE=your-company
GITHUB_ORG=your-org
```

### Step 3: Run Database Migrations
Initialize the local database schema using Drizzle:
```bash
npm run migrate
```

### Step 4: Run the Test Suite
Ensure the codebase builds and tests pass:
```bash
# Run all tests once
npm test

# Run tests in watch mode
npx vitest

# Run with coverage
npm test -- --coverage
```

### Step 5: Test CLI Pipelines Locally
You can run the pipelines manually in dry-run mode to avoid modifying the database or dispatching external notifications:
```bash
# Ingest yesterday's reports
npm run ingest

# Forecast monthly credits burn rate
npm run forecast

# Re-run user consumption tiering
npm run classify

# Dry run budget sync and issue alerting
npm run budget-sync -- --dry-run
```

---

## 4. Key Design Guidelines

* **TDD Focus**: We write tests first. Do not add functional implementation before you have a corresponding failing test.
* **Preserve Raw Payloads**: All Copilot reports must be stored directly in `raw_reports` first before parsing. This ensures compliance and allows us to rebuild history if GitHub's schema changes.
* **Security Guardrails**:
  * Never commit API tokens or connection strings.
  * Restrict network operations inside `fetchSignedUrl` to HTTPS and whitelisted domains.
  * Always parse YAML configs prior to env variable expansion to prevent structural injection.

If you have any questions or get stuck on environment setup, reach out in `#burnrate-dev` or ping your onboarding buddy!
