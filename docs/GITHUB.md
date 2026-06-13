# BurnRate

Observe-only GitHub Copilot budget monitoring. Daily ingestion, raw payload storage, burn forecasts, and budget alerts, without enforcement or automation.

## GitHub Repository Description

**Recommended description for the GitHub repository "About" section:**

```
Observe-only GitHub Copilot budget monitoring. Daily ingestion, raw payload storage, burn forecasts, and budget alerts, without enforcement or automation.
```

**Alternative (shorter):**

```
Know your Copilot burn before GitHub does. Observe-only budget monitoring with daily ingestion, forecasts, and alerts.
```

**GitHub Pages Site:** https://mhenke.github.io/BurnRate/

**Repository URL:** https://github.com/mhenke/BurnRate

## Repository Topics

Add these topics to the GitHub repository for discoverability:

- `copilot`
- `github-api`
- `budget-tracking`
- `burn-rate`
- `typescript`
- `drizzle-orm`
- `postgresql`
- `github-actions`
- `devops`
- `finops`

## GitHub Pages

If you want to enable a GitHub Pages site for documentation:

1. Go to **Settings** > **Pages**
2. Source: **Deploy from a branch**
3. Branch: **main** > **/docs** folder
4. Save

This will publish documentation at `https://mhenke.github.io/BurnRate/`

## GitHub Actions Workflows

The repository includes two automated workflows:

| Workflow | File | Schedule | Purpose |
|----------|------|----------|---------|
| **CI** | `ci.yml` | On every push | Run tests and build |
| **Weekly Classify** | `weekly-classify.yml` | Monday 6 AM UTC | Classify users by consumption/value tiers |
| **Daily Budget Check** | `daily-budget-check.yml` | Mon-Fri 9 AM UTC | Sync budget limits and send alerts |

## GitHub Issues

### Issue Templates

Consider adding these issue templates in `.github/ISSUE_TEMPLATE/`:

**Bug Report** (`.github/ISSUE_TEMPLATE/bug_report.md`):
```markdown
---
name: Bug Report
about: Create a report to help us improve
title: ''
labels: bug
assignees: ''
---

### Describe the bug
A clear and concise description of what the bug is.

### To Reproduce
Steps to reproduce the behavior:
1. Run '...'
2. See error

### Expected behavior
A clear and concise description of what you expected to happen.

### Environment
- Node version:
- OS:
- Database:
- BurnRate version:

### Logs
Attach full error output.
```

**Feature Request** (`.github/ISSUE_TEMPLATE/feature_request.md`):
```markdown
---
name: Feature Request
about: Suggest an idea for this project
title: ''
labels: enhancement
assignees: ''
---

### Problem
Is your feature request related to a problem? Please describe.

### Proposed Solution
A clear and concise description of what you want to happen.

### Alternatives
Any alternative solutions or features you've considered.

### Additional Context
Add any other context or examples about the feature request here.
```

## GitHub Discussions

Enable GitHub Discussions for:

- General questions
- Feature ideas
- Show and tell (how teams are using BurnRate)
- Q&A

Go to **Settings** > **General** > **Features** > **Discussions** > **Set up discussions**

## GitHub Releases

To create a release:

```bash
# Tag the release
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0

# Or use GitHub CLI
gh release create v1.0.0 --title "Release v1.0.0" --notes "Release notes here"
```

## GitHub Secrets

Required secrets for GitHub Actions:

| Secret | Description | Required For |
|--------|-------------|--------------|
| `DATABASE_URL` | PostgreSQL connection string | All workflows |
| `GITHUB_PAT` | Personal Access Token with `read:org` scope | All workflows |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL | Budget alerts |

Configure in **Settings** → **Secrets and variables** → **Actions**

## GitHub Branch Protection

Recommended branch protection rules for `main`:

- Require a pull request before merging
- Require approvals (1)
- Dismiss stale pull request approvals when new commits are pushed
- Require status checks to pass before merging
  - `npm test`
  - `npm run build`
- Require branches to be up to date before merging
- Include administrators

Configure in **Settings** > **Branches** > **Add branch protection rule**

## GitHub Security

### Security Policy

Create `.github/SECURITY.md`:

```markdown
# Security Policy

## Reporting a Vulnerability

We take security issues seriously. Please report vulnerabilities privately via email.

**Email:** [your-email@example.com]

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours and work with you to address the issue.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < Latest| :x:                |
```

### Dependabot

Enable Dependabot for automatic dependency updates by creating `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
```

---

**Repository URL:** https://github.com/mhenke/BurnRate
