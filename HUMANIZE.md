# BurnRate: A Human Explanation

> **This document explains what BurnRate does in plain language. No jargon, no buzzwords. Just what it does and why you might care.**

---

## The Problem

Your company pays GitHub for Copilot seats. At the end of each month, GitHub sends a bill. Sometimes that bill is... surprising.

You might think:
- "We have 50 seats, so we're using 50 seats, right?"
- "Our team is small, how much could we possibly spend?"
- "I wish I knew mid-month if we're on track to go over budget"

GitHub doesn't show you a running tally. They show you the past (last month's bill) but not the present (this month's burn rate).

## What BurnRate Does

BurnRate is like a **budget tracker for your Copilot usage**. It:

1. **Checks your usage daily** - Connects to GitHub's API and downloads usage reports
2. **Stores everything** - Saves the raw data so you always have a record
3. **Makes predictions** - Calculates "at this rate, you'll use X credits by month-end"
4. **Sends alerts** - Notifies you on Slack or creates a GitHub Issue when you're approaching limits

**What it doesn't do:** Change your budget, enforce limits, or automate anything. It's a monitoring tool, not a control tool.

## How It Works (Simple Version)

```
Every day at 9 AM:
  ↓
BurnRate asks GitHub: "How much Copilot did we use yesterday?"
  ↓
GitHub sends back a JSON report
  ↓
BurnRate saves it to a database
  ↓
BurnRate calculates: "You've used 67% of your budget, 73% through the month"
  ↓
If you're in the danger zone → sends a Slack message
  ↓
Done until tomorrow
```

## Who Is This For?

**You might want BurnRate if:**

- You manage Copilot for an organization (50+ seats)
- You've been surprised by a month-end bill before
- You want visibility without automation
- You prefer "observe and alert" over "automate and enforce"

**You probably don't need BurnRate if:**

- You have a small team (<10 seats) and usage is predictable
- You're comfortable with GitHub's built-in billing notifications
- You want automated budget enforcement (GitHub's Budgets API can do that directly)

## Real Example

**Scenario:** Platform team at a mid-size company

- **Budget:** $10,000/month for Copilot
- **Mid-month check:** BurnRate reports 60% used, 55% through the month
- **Forecast:** On track to use $10,900 (9% over budget)
- **Action:** Team lead sends a message: "Hey folks, we're burning hot. Consider easing up on Copilot for the rest of the month."
- **Result:** Month ends at $9,800 (under budget)

Without BurnRate, they would have discovered this on day 31 when the bill arrived.

## Technical Details (For the Curious)

### What's Actually Being Measured?

GitHub Copilot usage is measured in **credits**:
- 1 AI completion = ~10-100 credits (depends on tokens)
- 1 chat conversation = ~50-500 credits
- Your org gets a monthly credit pool based on your plan

BurnRate tracks:
- Credits used per user per day
- Credits used per team per day
- Total pool usage and remaining
- Forecasts based on usage velocity

### Where Does the Data Come From?

GitHub provides API endpoints for AI credit usage, such as:
`GET /organizations/{org}/settings/billing/ai_credit/usage`

This returns usage items:
```json
{
  "timePeriod": { "year": 2026, "month": 6 },
  "organization": "acme-inc",
  "usageItems": [
    {
      "product": "Copilot",
      "sku": "Copilot AI Credits",
      "netAmount": 670000
    }
  ]
}
```

BurnRate fetches this daily and sums the Copilot AI credit usage. Over time, you build a history that GitHub doesn't provide.

### Why Store Raw Payloads?

GitHub might change their API response format. If you only store parsed data, you lose history when the schema changes.

BurnRate stores:
1. **Raw JSON** - exactly what GitHub sent, forever
2. **Parsed metrics** - the numbers we extracted

If GitHub changes their API in 2027, you can re-parse the 2026 raw data with new logic. You never lose history.

## Running BurnRate

### Option 1: Automated (Recommended)

Install BurnRate, configure GitHub Actions, and forget it. It runs every weekday at 9 AM UTC and sends alerts if needed.

```yaml
# .github/workflows/daily-budget-check.yml
# Runs automatically, no manual intervention
```

### Option 2: Manual

Run it yourself when you want a check:

```bash
npm run budget-sync
```

### Option 3: Dry Run

Test without sending notifications:

```bash
npm run budget-sync -- --dry-run
```

## Alerts: What Do They Look Like?

### Slack Notification

```
⚠️ Copilot Budget: Warning

Budget Used:    87.3%
Used:           $8,730 of $10,000
7d Forecast:    94.2%
30d Forecast:   91.5%
Date:           2026-06-13
```

### GitHub Issue

Created automatically in your repo with label `burnrate-budget`. Updates with comments as the month progresses. Title changes to reflect current alert level.

## Alert Levels

| Level | Trigger | Meaning |
|-------|---------|---------|
| **ok** | <90% of budget | You're fine |
| **warning** | 90-99% | Pay attention |
| **escalation** | 100-109% | You've exceeded budget |
| **critical** | ≥110% | Significant overage |
| **all_clear** | Returned to <90% | Situation resolved |

**Important:** BurnRate only notifies when the alert level *changes*. If you're at "warning" for 10 days, you get one notification, not ten.

## Privacy & Security

### What Access Does BurnRate Need?

- **GitHub PAT** with `read:org` scope (read-only, no write permissions)
- **Database** (PostgreSQL or SQLite) to store usage data
- **Slack webhook** (optional) for notifications

### What Data Is Stored?

- User GitHub login (for attribution)
- Team assignments
- Daily usage metrics (credits, tokens, requests)
- Budget snapshots

**Not stored:**
- Code snippets or completions
- File paths or repository names
- Chat conversation content

### Is This Safe?

Yes. BurnRate:
- Never writes to GitHub (read-only API calls)
- Never stores code or sensitive content
- Uses parameterized queries (no SQL injection risk)
- Doesn't commit secrets to the repo

## Cost

BurnRate itself is free (open source, MIT license).

Your costs:
- **Database hosting** - ~$5-15/month for a small PostgreSQL instance (or free with SQLite)
- **GitHub Actions** - Free for public repos, included in private repo minutes
- **Your time** - ~30 minutes to set up, then zero maintenance

Compare to the cost of one surprise overage bill ($1,000+ for large orgs).

## Alternatives

### GitHub's Built-In Budgets

GitHub offers budget alerts directly in Copilot settings.

**Pros:**
- No setup required
- Official GitHub feature

**Cons:**
- Limited customization
- Email-only notifications
- No historical data export
- Can't forecast or trend

### Manual Spreadsheet

Track usage manually in a spreadsheet.

**Pros:**
- Full control
- No dependencies

**Cons:**
- Requires daily manual work
- Easy to forget
- No automation

### BurnRate

**Pros:**
- Automated daily tracking
- Historical data preservation
- Slack/GitHub notifications
- Forecasting
- Open source (audit the code)

**Cons:**
- Requires initial setup (~30 minutes)
- Another tool to maintain

## FAQ

**Q: Will this prevent us from going over budget?**  
A: No. It alerts you, but doesn't enforce. You decide what action to take.

**Q: Can BurnRate automatically disable Copilot when we hit the limit?**  
A: Not yet. That's Phase 4 (planned). For now, it's observe-only.

**Q: Does this work with GitHub Copilot Individual?**  
A: No. Requires Copilot Business or Enterprise (organization-level billing).

**Q: How accurate are the forecasts?**  
A: Reasonably accurate for stable usage patterns. Less accurate if you have wild swings (e.g., onboarding 50 devs mid-month).

**Q: Can I export the data?**  
A: Yes. It's all in your database. Run any SQL query you want.

**Q: What if GitHub changes their API?**  
A: BurnRate stores raw payloads, so you can re-parse historical data. The code would need updating, but your history is safe.

**Q: Is this affiliated with GitHub?**  
A: No. Unofficial open source project.

## Getting Started

See [README.md](README.md) for installation instructions.

See [CONTRIBUTING.md](CONTRIBUTING.md) if you want to contribute.

See [docs/AI_AGENTS.md](docs/AI_AGENTS.md) if you're using AI agents to work on this codebase.

---

**Still have questions?** Open an issue on GitHub.
