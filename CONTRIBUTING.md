# Contributing to BurnRate

> Thank you for considering contributing to BurnRate! This document explains how to contribute code, report bugs, and suggest improvements.

---

## Quick Links

- [README.md](README.md) — Project overview and quick start
- [HUMANIZE.md](HUMANIZE.md) — Plain language explanation
- [docs/AI_AGENTS.md](docs/AI_AGENTS.md) — AI agent usage guide
- [AGENTS.md](AGENTS.md) — Agent-specific rules and workflows
- [DESIGN.md](DESIGN.md) — Visual design system

---

## Code of Conduct

Be respectful and constructive. We're all here to build useful tools. No harassment, no gatekeeping, no ego.

---

## How to Contribute

### Reporting Bugs

**Before filing a bug report:**

1. Search existing issues to avoid duplicates
2. Check if the issue persists on the latest `main` branch
3. Gather reproduction steps and error messages

**A good bug report includes:**

- What you expected to happen
- What actually happened
- Steps to reproduce (with code snippets if applicable)
- Environment details (Node version, OS, database type)
- Any relevant logs or error messages

**Example:**

```markdown
### Expected
`npm run budget-sync` should sync budget data and log success.

### Actual
Command fails with: "Error: Cannot read properties of undefined (reading 'total_budget')"

### Reproduction
1. Run `npm run budget-sync`
2. Observe error in console

### Environment
- Node: 22.14.0
- OS: macOS 15.2
- Database: PostgreSQL 16
- BurnRate: commit abc123

### Logs
[Attach full error output]
```

### Suggesting Features

**Before suggesting a feature:**

1. Check existing issues and the project roadmap
2. Consider if it aligns with the project's scope (observe-only monitoring)
3. Think about implementation complexity vs. value

**A good feature request includes:**

- The problem you're trying to solve
- Your proposed solution
- Alternative approaches you've considered
- Why this matters for BurnRate's users

**Example:**

```markdown
### Problem
I want to know mid-week if we're on track to exceed budget, but current alerts only fire at 90%+.

### Proposed Solution
Add a "velocity" metric that compares usage rate to time elapsed. Alert if velocity > 1.0 for 3 consecutive days.

### Alternatives
- Manual spreadsheet tracking (tedious)
- Custom SQL queries (not scalable)

### Why This Matters
Early warning gives teams time to adjust behavior before hitting hard limits.
```

### Submitting Code

#### 1. Fork and Clone

```bash
# Fork on GitHub, then:
git clone https://github.com/YOUR_USERNAME/BurnRate.git
cd BurnRate
git remote add upstream https://github.com/mhenke/BurnRate.git
```

#### 2. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-123
```

#### 3. Set Up Development Environment

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.sample .env
# Edit .env with your local config

# Run migrations
npm run migrate

# Verify tests pass
npm test
```

#### 4. Make Your Changes

Follow the project's coding standards:

- **TypeScript**: Explicit types, no implicit `any`
- **Error handling**: Use try/catch with descriptive messages
- **Testing**: Write tests for new code (80% coverage target for parsers/forecasting)
- **Documentation**: Update README.md if behavior changes

#### 5. Run Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npx vitest run tests/etl/pipeline.test.ts
```

#### 6. Commit Your Changes

We use [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git add .
git commit -m "feat: add velocity-based early warning alerts"
# or
git commit -m "fix: handle empty pool_snapshots table gracefully"
```

**Commit types:**

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation changes
- `style:` — Code style changes (formatting, semicolons, etc.)
- `refactor:` — Code refactoring (no behavior change)
- `test:` — Test additions or changes
- `chore:` — Maintenance tasks (dependencies, scripts, config)

#### 7. Push and Open a Pull Request

```bash
git push origin feature/your-feature-name
```

Then open a PR on GitHub with:

- Clear title describing the change
- Description of what changed and why
- Link to any related issues
- Screenshots or logs if applicable

#### 8. Respond to Review Feedback

A maintainer will review your PR. Be responsive to feedback and make requested changes. Once approved, your PR will be merged.

---

## Development Guidelines

### Code Style

- **Async/await**: Use standard async/await, not `.then()` chains
- **Explicit types**: All function parameters and return types must be typed
- **Error messages**: Descriptive and actionable
- **No hardcoded secrets**: Use environment variables or config files

### Architecture

- **Modular ETL**: API calls in `src/github/`, parsing in `src/etl/`, database in `src/db/`
- **Raw-first storage**: Store raw JSON before parsing
- **Dual database support**: PostgreSQL for production, SQLite for local dev
- **Transaction safety**: Use transactions for multi-statement operations

### Testing

- **Unit tests**: Required for all parsers and forecasting logic
- **Mock external APIs**: Never hit real GitHub API in tests
- **80% coverage**: Target for new code in critical paths
- **Test in isolation**: Each test should be independent

### Documentation

- **README.md**: User-facing overview
- **HUMANIZE.md**: Plain language explanation
- **AGENTS.md**: AI agent rules
- **Inline comments**: Explain _why_, not _what_

---

## Project Structure

```
BurnRate/
├── src/
│   ├── github/       # GitHub API clients
│   ├── etl/          # Data extraction, transformation, loading
│   ├── db/           # Database schema, migrations, client
│   ├── forecast/     # Burn forecasting logic
│   ├── classify/     # User classification by tiers
│   ├── budget/       # Budget sync and notifications
│   └── index.ts      # CLI entrypoint
├── tests/
│   ├── github/       # GitHub API client tests
│   ├── etl/          # ETL pipeline tests
│   ├── db/           # Database tests
│   ├── forecast/     # Forecasting tests
│   ├── classify/     # Classification tests
│   ├── budget/       # Budget sync tests
│   └── index.test.ts # CLI tests
├── docs/
│   └── superpowers/  # Implementation plans and specs
├── .github/
│   └── workflows/    # GitHub Actions workflows
├── config/
│   └── value_config.sample.yml
└── package.json
```

---

## Release Process

BurnRate follows a continuous deployment model:

1. All changes merge to `main`
2. CI runs tests and builds
3. If tests pass, deployment is automatic
4. Version tags are created for significant changes

### Version Numbering

We use [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

---

## Questions?

- **General questions**: Open a GitHub Discussion
- **Bug reports**: Open a GitHub Issue
- **Security issues**: Email the maintainer directly (see SECURITY.md)

---

## Thank You

Your contributions make BurnRate better for everyone. Whether it's a typo fix, a new feature, or a bug report, we appreciate your time and effort.
