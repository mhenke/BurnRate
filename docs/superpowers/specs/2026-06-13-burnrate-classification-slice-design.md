# BurnRate Classification Slice Design

> **For agentic workers:** This spec is the source of truth for the classification slice. Implement it with a single `burnrate classify` command and a weekly GitHub Actions cron that runs the same command.

**Goal:** Classify users into consumption and value tiers, persist the results to Postgres, and record an audit trail of changes for weekly review.

**Architecture:** The classification slice is a single TypeScript job that reads recent usage from Postgres, loads a team-name-based `value_config.yml`, computes 30-day consumption tiers, and writes tier changes back to the database. The same job runs both manually and from GitHub Actions, so the CLI and cron share one code path.

**Tech Stack:** TypeScript, Node.js, Drizzle ORM, Postgres + SQLite, `yaml`, `dotenv`, `vitest`, GitHub Actions.

---

## 1. Scope

### In scope

- `burnrate classify` CLI command
- Weekly GitHub Actions cron that runs `burnrate classify`
- 30-day consumption tier calculation using user credits from `daily_usage`
- Value tier assignment using **team-name matching only**
- Persistence of current tiers in `users`
- Persistence of tier changes in `classification_history`
- Optional JSON report output for manual runs
- Unit tests for classifier logic and config parsing

### Out of scope

- Budget API reads or writes
- Copilot Skills / conversational intervention
- title-pattern matching in `value_config.yml`
- alerts, dashboards, or notification delivery
- monthly baseline reset
- ULB enforcement or automation

---

## 2. Design Summary

Classification is a deterministic batch job.

1. Read the latest 30 days of `daily_usage` from Postgres.
2. Aggregate credits per user.
3. Compute percentile-based consumption tiers:
   - `low` = bottom 25%
   - `medium` = P25–P60
   - `high` = P60–P85
   - `extreme` = top 15%
4. Load `value_config.yml` and assign `value_tier` by team name only.
5. Compare new tiers with the current `users` values.
6. Update changed users and append a `classification_history` row for each change.

The same job should be callable in two ways:

- **Manual CLI:** `burnrate classify`
- **Cron:** weekly GitHub Actions workflow that runs the same CLI command

---

## 3. Data Model

### Data dependencies

- `daily_usage` must already contain at least 30 days of credits per user.
- `users.team` must be populated before classification runs; this slice should derive it from the stored `enterprise-user-teams-1-day` raw payloads.
- `value_config.yml` must live at `config/value_config.yml`, with an override path accepted via `--value-config` or `VALUE_CONFIG_PATH`.

### CLI interface

- `burnrate classify`
- `burnrate classify --value-config <path>`
- `burnrate classify --report`

`--report` prints a compact JSON summary to stdout. The summary should include:

- `total_users`
- `changed_users`
- `tier_counts`
- `missing_team_count`

### Required inputs

- `daily_usage(report_day, login, credits, ...)`
- `users(login, team, consumption_tier, value_tier, bucket_updated_at, ...)`
- `value_config.yml`

### Outputs

- `users.consumption_tier`
- `users.value_tier`
- `users.bucket_updated_at`
- `classification_history`

### `classification_history`

The table is an audit log, not a derived cache.

Recommended columns:

- `effective_date`
- `github_login`
- `consumption_tier_old`
- `consumption_tier_new`
- `value_tier`
- `reason`

Note: the committed schema uses `consumption_tier_old` / `consumption_tier_new` instead of the reference doc’s `consumption_from` / `consumption_to`. This spec intentionally follows the committed schema.

Recommended reasons:

- `weekly_recalc`
- `manual`
- `mid_month` is deferred to a later slice.

---

## 4. Classification Rules

### Consumption tier

Compute each user’s total credits over the last 30 days, then rank all users with `PERCENT_RANK()` or equivalent percentile logic.

Boundary rules:

- `extreme`: rank >= 0.85
- `high`: rank >= 0.60 and < 0.85
- `medium`: rank >= 0.25 and < 0.60
- `low`: rank < 0.25

### Value tier

Value tiers are determined by `value_config.yml` using **team-name matching only**.

Suggested config shape:

```yaml
critical:
  teams:
    - platform
    - security
normal:
  teams:
    - product
    - engineering
low_priority:
  teams:
    - marketing
    - ops
```

Matching rules:

- First match wins
- Team names are compared case-insensitively
- Missing teams default to `normal`
- This slice ignores `title_patterns`, but the config shape is forward-compatible for later phases.
- `title_patterns` entries are ignored if present, not treated as an error.
- `users.team` is sourced from the `enterprise-user-teams-1-day` payload, not manual entry.
- NULL or missing team values default to `normal`.

---

## 5. Workflow

### Manual run

1. Load config from `.env` and `value_config.yml`
2. Validate DB connectivity
3. Run classifier
4. Print a compact JSON summary to stdout

The classification job reads the latest 30 calendar days of data (`report_day >= CURRENT_DATE - INTERVAL '30 days'` on Postgres; SQLite equivalent in the implementation) and performs all writes in a single transaction after the read phase completes.

### Weekly cron

1. Checkout repo
2. Install dependencies
3. Run `burnrate classify`
4. Store workflow logs only; no notifications are sent yet

### Update behavior

- Only write rows when a user’s tier changes
- Update `bucket_updated_at` on any tier change
- Keep `classification_history` append-only
- If a row already exists for `(effective_date, github_login)`, the run should no-op for `classification_history` rather than error.

---

## 6. Error Handling

- If `daily_usage` has fewer than 30 days of data, fail with a clear message unless `--allow-partial` is explicitly added later.
- If `value_config.yml` is missing or malformed, exit non-zero and print the file/field error.
- If no team mapping exists for a user, default them to `normal` and record that in the summary.
- If the DB write fails mid-run, wrap all updates in a transaction and roll back.
- If the user count is fewer than 4, assign all users to `medium` and log a warning instead of computing unstable percentile buckets.
- The read phase must happen before the write transaction starts.
- Re-running the job on the same day should not change `bucket_updated_at` unless a tier actually changed.

---

## 7. Testing

### Unit tests

- percentile boundary mapping
- single-user dataset behavior
- all-users-equal dataset behavior
- config parsing and team matching
- diff logic for `users` + `classification_history`
- SQLite path for percentile computation

### Integration-style tests

- classifier run over seeded Postgres rows
- cron and manual CLI both invoke the same runner entrypoint

### Verification goal

- Parser/classifier tests should cover the boundary math and config matching paths well enough to keep the classification code easy to change.

---

## 8. Open Questions

1. Should team-name matching be exact case-insensitive matching only, or should we also normalize whitespace/punctuation?
2. Should team-name matching normalize whitespace/punctuation in addition to case?
3. Do we want `classification_history.reason` to distinguish manual vs weekly runs immediately, or defer the reason split to a later slice?

---

## 9. Decision

This slice will be **persisted classification only**:

- write `users`
- append `classification_history`
- no Budget API calls
- no Copilot Skills
- no enforcement logic
