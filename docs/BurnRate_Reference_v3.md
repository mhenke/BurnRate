**BurnRate**

GitHub Copilot AI Credit Governance Platform

*Architecture, API Reference & Implementation Guide*

*Version 3.0 --- Verified against GitHub Docs June 13, 2026*

This document is the definitive reference for building BurnRate --- a FinOps-style governance layer for GitHub Copilot AI Credits. Version 3.0 incorporates a full multi-source audit: corrected endpoint paths, an accurate budget hierarchy, a new permissions matrix, corrected billing usage endpoint, softened legacy endpoint claims, and clear labeling of BurnRate design decisions vs GitHub product behavior.

**1. Billing Model Context (June 2026)**

GitHub Copilot switched from flat Premium Request Units to usage-based AI Credit billing on June 1, 2026. This is the foundational model BurnRate is built on.

  ----------------------- --------------------------- -------------------------
  **Plan**                **Standard Credits/Seat**   **Promo Jun--Aug 2026**

  Copilot Business        1,900 / seat / month        3,000 / seat / month

  Copilot Enterprise      3,900 / seat / month        7,000 / seat / month

  Copilot Pro             1,500 / month               ---

  Copilot Pro+            7,000 / month               ---
  ----------------------- --------------------------- -------------------------

+-------------------------------------------------------------------------------------------+
| **⚠️ Post-Promo Cliff: September 1, 2026**                                                |
|                                                                                           |
| Business drops from 3,000 → 1,900 credits/seat. Enterprise drops from 7,000 → 3,900/seat. |
|                                                                                           |
| Design all thresholds and ULB amounts using post-promo numbers as your baseline.          |
|                                                                                           |
| The June--August window is your calibration period, not your steady state.                |
+-------------------------------------------------------------------------------------------+

**Key mechanics:** All seat credits pool at the enterprise level. 1 AI Credit = \$0.01 USD. Code completions and Next Edit Suggestions are unlimited and never consume credits. All other features (chat, agents, code review) are metered. Additional metered usage beyond the pool only occurs if the AI credit paid usage policy is explicitly enabled by an admin.

**2. Permissions Matrix**

+---------------------------------------------------------------------------------------------+
| **Read This Before Writing Any Code**                                                       |
|                                                                                             |
| Auth requirements differ significantly by endpoint. Using the wrong token type will produce |
|                                                                                             |
| 403 or 404 errors that are hard to diagnose. Fine-grained PATs do NOT work for enterprise   |
|                                                                                             |
| seat management endpoints. Map your token strategy to this matrix before implementation.    |
+---------------------------------------------------------------------------------------------+

  ------------------------------- ------------------------------------------- ---------------------------------------------- -------------------------------------
  **Endpoint Group**              **Classic PAT Scopes**                      **Fine-Grained PAT**                           **GitHub App**

  Org seat management             manage_billing:copilot + read:org           Copilot Business org permission                Copilot org permission (read/write)

  Enterprise seat management      manage_billing:copilot or read:enterprise   NOT SUPPORTED                                  GitHub App installation token

  Org usage metrics               manage_billing:copilot or read:org          Supported --- org Copilot metrics permission   GitHub App user/installation token

  Enterprise usage metrics        manage_billing:copilot or read:enterprise   Enterprise Copilot metrics permission (read)   GitHub App user/installation token

  Budget management (org)         manage_billing:copilot                      Supported --- billing write permission         GitHub App installation token

  Billing AI credit usage (org)   manage_billing:copilot or read:org          Supported --- billing read permission          GitHub App user/installation token
  ------------------------------- ------------------------------------------- ---------------------------------------------- -------------------------------------

+--------------------------------------------------------------------------------------------+
| **Recommendation: Use a GitHub App**                                                       |
|                                                                                            |
| For an OSS tool like BurnRate, a GitHub App installation token is the cleanest approach.   |
|                                                                                            |
| It avoids personal token sprawl, scopes permissions precisely per org, and works across    |
|                                                                                            |
| both org and enterprise endpoints. Classic PATs are acceptable for single-org deployments. |
+--------------------------------------------------------------------------------------------+

**3. API Surface --- The Five Domains**

Use API version header X-GitHub-Api-Version: 2026-03-10 on all requests.

**3.1 Seat Management**

**Purpose:** Who has a license, assignment date, last activity, seat type. Sync nightly.

**Org-level**

> GET /orgs/{org}/copilot/billing/seats
>
> ?per_page=100&page=N (paginate via Link response header)

**Enterprise-level**

> GET /enterprises/{enterprise}/copilot/billing/seats

Key fields per seat: assignee.login, last_activity_at, last_activity_editor, created_at, plan_type.

+------------------------------------------------------------------------------------------+
| **❌ Endpoint Does Not Exist**                                                           |
|                                                                                          |
| Multiple sources cited GET /orgs/{org}/members/{username}/copilot for individual lookup. |
|                                                                                          |
| This endpoint is not in current docs. Filter the seats list by login instead.            |
+------------------------------------------------------------------------------------------+

**3.2 Usage Metrics Reports (Primary Data Source)**

+--------------------------------------------------------------------------------------------------+
| **Deprecated, Not Closed**                                                                       |
|                                                                                                  |
| The legacy /copilot/metrics endpoints are marked deprecated in current GitHub Docs.              |
|                                                                                                  |
| The exact closure date cannot be verified from documentation. Treat them as legacy and           |
|                                                                                                  |
| do not build new integrations against them. Use the /copilot/metrics/reports/\* endpoints below. |
+--------------------------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------------+
| **Prerequisite**                                                                       |
|                                                                                        |
| Set \'Copilot usage metrics\' policy to \'Enabled everywhere\' in enterprise settings. |
|                                                                                        |
| Without this, all /metrics/reports/\* endpoints return 403.                            |
+----------------------------------------------------------------------------------------+

**Enterprise --- Daily snapshot**

> GET /enterprises/{enterprise}/copilot/metrics/reports/enterprise-1-day?day=YYYY-MM-DD

**Enterprise --- 28-day rolling**

> GET /enterprises/{enterprise}/copilot/metrics/reports/enterprise-28-day

**Per-user --- Daily**

> GET /enterprises/{enterprise}/copilot/metrics/reports/users-1-day?day=YYYY-MM-DD

**Per-user --- 28-day rolling**

> GET /enterprises/{enterprise}/copilot/metrics/reports/users-28-day

**User-Team mapping --- Daily**

> GET /enterprises/{enterprise}/copilot/metrics/reports/enterprise-user-teams-1-day?day=YYYY-MM-DD

All endpoints return signed download URLs, not data directly. Download and parse immediately --- signed URLs expire. Store the raw payload before parsing (see Section 4.2).

+--------------------------------------------------------------------------------------------+
| **❌ No /latest Suffix on 28-Day Endpoints**                                               |
|                                                                                            |
| Multiple sources cited paths ending in /users-28-day/latest and /enterprise-28-day/latest. |
|                                                                                            |
| These paths do not exist in the verified docs nav. The 28-day endpoints have no suffix.    |
|                                                                                            |
| 1-day endpoints require a ?day=YYYY-MM-DD query parameter.                                 |
+--------------------------------------------------------------------------------------------+

**Org-level equivalents**

> GET /orgs/{org}/copilot/metrics/reports/users-1-day?day=YYYY-MM-DD
>
> GET /orgs/{org}/copilot/metrics/reports/users-28-day
>
> GET /orgs/{org}/copilot/metrics/reports/org-1-day?day=YYYY-MM-DD
>
> GET /orgs/{org}/copilot/metrics/reports/org-28-day
>
> GET /orgs/{org}/copilot/metrics/reports/org-user-teams-1-day?day=YYYY-MM-DD

Historical data available from October 10, 2025 up to 1 year back.

**3.3 Billing AI Credit Usage**

+--------------------------------------------------------------------------------------------+
| **Use the Specific AI Credit Endpoint**                                                    |
|                                                                                            |
| The generic GET /organizations/{org}/settings/billing/usage exists but returns a different |
|                                                                                            |
| payload covering all billing products. For Copilot AI credit data specifically, use the    |
|                                                                                            |
| dedicated endpoint below. Both exist; they are not interchangeable.                        |
+--------------------------------------------------------------------------------------------+

**AI credit usage --- org level (correct endpoint)**

> GET /organizations/{org}/settings/billing/ai_credit/usage
>
> Supports fine-grained PATs with billing read permission
>
> Returns up to 24 months of historical data

Use for financial reconciliation, chargeback reporting, and month-end close. Covers org-managed licenses only --- not self-purchased individual plans.

**3.4 Budget Management (Enforcement Layer)**

+-------------------------------------------------------------------------------------------+
| **✅ Per-User Hard Caps Are Real**                                                        |
|                                                                                           |
| User-Level Budgets (ULBs) shipped June 1, 2026 and are always hard stops.                 |
|                                                                                           |
| When a user hits their ULB, all AI-credit-consuming features block immediately.           |
|                                                                                           |
| Code completions continue --- they don\'t consume credits. No fallback to cheaper models. |
+-------------------------------------------------------------------------------------------+

**Budget CRUD**

> GET /organizations/{org}/settings/billing/budgets (list, up to 10/page)
>
> POST /organizations/{org}/settings/billing/budgets (create)
>
> PATCH /organizations/{org}/settings/billing/budgets/{id} (modify amount)
>
> DELETE /organizations/{org}/settings/billing/budgets/{id} (remove override)

**Create Individual ULB payload**

> { \"budget_amount\": 30,
>
> \"prevent_further_usage\": true,
>
> \"budget_scope\": \"user\",
>
> \"budget_type\": \"BundlePricing\",
>
> \"budget_product_sku\": \"ai_credits\",
>
> \"user\": \"github_login\" }

**3.5 Budget Hierarchy (Full Picture)**

GitHub provides four budget controls. They serve different purposes and activate at different points in the credit lifecycle.

  -------------------- ----------------------------------- ------------------------------------------- ---------------------- -------------
  **Control**          **Scope**                           **When Active**                             **Hard Stop?**         **Default**

  Universal ULB        Every licensed user (default)       Pool phase AND metered phase                Always                 Not set

  Individual ULB       Single user (overrides Universal)   Pool phase AND metered phase                Always                 Not set

  Cost Center Budget   Group of users in a cost center     Metered phase only (after pool exhausted)   Only if flag enabled   Off

  Enterprise Budget    All metered usage enterprise-wide   Metered phase only (after pool exhausted)   Only if flag enabled   Off
  -------------------- ----------------------------------- ------------------------------------------- ---------------------- -------------

+-------------------------------------------------------------------------------------+
| **⚠️ Critical: \'Stop Usage\' Flag is Off by Default**                              |
|                                                                                     |
| Cost center and enterprise budgets are alerts only by default --- not hard stops.   |
|                                                                                     |
| You must explicitly enable \'Stop usage when budget limit is reached\' on each one. |
|                                                                                     |
| Without this, charges continue accruing after the limit is reached.                 |
|                                                                                     |
| ULBs (Universal and Individual) are always hard stops --- no flag required.         |
+-------------------------------------------------------------------------------------+

+--------------------------------------------------------------------------------------------+
| **⚠️ Metered Usage Requires Policy Enablement**                                            |
|                                                                                            |
| Additional metered usage beyond the pool only occurs if \'AI credit paid usage\' policy is |
|                                                                                            |
| explicitly enabled by an enterprise admin. If the policy is off and the pool is exhausted, |
|                                                                                            |
| usage blocks entirely --- no metered charges. Confirm this policy state before designing   |
|                                                                                            |
| your alert thresholds and enforcement logic.                                               |
+--------------------------------------------------------------------------------------------+

+--------------------------------------------------------------------------------------------+
| **⚠️ Validate CRUD and Precedence Before Phase 3**                                         |
|                                                                                            |
| Before wiring up automation: confirm all four CRUD operations work in your enterprise.     |
|                                                                                            |
| Test the edge case: user has ULB remaining, but enterprise pool is exhausted.              |
|                                                                                            |
| Confirm exact precedence: Individual ULB → Universal ULB → Cost Center → Enterprise limit. |
|                                                                                            |
| These answers must be live-tested before Phase 3 automation fires real budget writes.      |
+--------------------------------------------------------------------------------------------+

**3.6 Team Mapping (Added May 2026)**

Maps licensed users to GitHub teams, enabling User → Team → Department → Cost Center attribution for chargeback.

> GET /enterprises/{enterprise}/copilot/metrics/reports/enterprise-user-teams-1-day?day=YYYY-MM-DD
>
> GET /orgs/{org}/copilot/metrics/reports/org-user-teams-1-day?day=YYYY-MM-DD

**4. Data Model**

Retain all data for at least 13 months for year-over-year comparison. Never delete raw payloads.

**Database compatibility:** Column types shown below use PostgreSQL syntax (JSONB, TIMESTAMPTZ, etc.) as PostgreSQL 14+ is the recommended production database. For local development and single-user evaluation, SQLite is supported via Drizzle ORM's `{ mode: 'json' }` TEXT columns, which transparently handle the JSONB → TEXT translation. The Drizzle schema defines dual table definitions (`*Pg` and `*Sq` variants) to accommodate both backends without code branching.

**4.1 Core Tables**

**users**

> github_login VARCHAR PRIMARY KEY
>
> employee_id VARCHAR
>
> team VARCHAR
>
> manager VARCHAR
>
> consumption_tier ENUM(\'low\',\'medium\',\'high\',\'extreme\') \-- BurnRate classification
>
> value_tier ENUM(\'critical\',\'normal\',\'low_priority\') \-- from value_config.yml
>
> bucket_updated_at TIMESTAMP
>
> seat_created_at TIMESTAMP
>
> last_activity_at TIMESTAMP

**daily_usage**

> usage_date DATE
>
> github_login VARCHAR
>
> credits NUMERIC(10,2)
>
> tokens_input BIGINT
>
> tokens_output BIGINT
>
> chat_requests INTEGER
>
> agent_requests INTEGER
>
> accepted_lines INTEGER
>
> suggested_lines INTEGER
>
> acceptance_rate NUMERIC(5,4) \-- computed
>
> credits_per_acc_loc NUMERIC(10,4) \-- computed
>
> model_breakdown JSONB
>
> ide_breakdown JSONB
>
> language_breakdown JSONB
>
> PRIMARY KEY (usage_date, github_login)

**team_usage**

> usage_date DATE
>
> team VARCHAR
>
> credits NUMERIC(10,2)
>
> active_users INTEGER
>
> avg_acceptance_rate NUMERIC(5,4)
>
> PRIMARY KEY (usage_date, team)

**classification_history**

> effective_date DATE
>
> github_login VARCHAR
>
> consumption_from VARCHAR
>
> consumption_to VARCHAR
>
> value_tier VARCHAR
>
> reason VARCHAR
>
> PRIMARY KEY (effective_date, github_login)

**pool_snapshots**

> snapshot_date DATE
>
> total_credits NUMERIC(12,2)
>
> credits_used NUMERIC(12,2)
>
> credits_remaining NUMERIC(12,2)
>
> forecast_7d NUMERIC(12,2)
>
> forecast_30d NUMERIC(12,2)
>
> pct_elapsed NUMERIC(5,2)
>
> PRIMARY KEY (snapshot_date)

**4.2 Raw Payload Storage**

+-------------------------------------------------------------------------------------+
| **Never Discard Raw Payloads**                                                      |
|                                                                                     |
| Store raw JSON from signed URLs before any parsing. GitHub report schemas change.   |
|                                                                                     |
| Raw storage means a schema change never corrupts your history --- reparse from raw. |
+-------------------------------------------------------------------------------------+

**raw_reports**

> id BIGSERIAL PRIMARY KEY
>
> report_date DATE
>
> report_type VARCHAR \-- \'users-1-day\',\'enterprise-1-day\',\'user-teams-1-day\', etc.
>
> source_url VARCHAR \-- signed URL (audit trail)
>
> payload JSONB
>
> fetched_at TIMESTAMP DEFAULT NOW()

**5. Two-Dimensional User Classification**

+------------------------------------------------------------------------------------------------+
| **BurnRate Design Decision --- Not GitHub Behavior**                                           |
|                                                                                                |
| Everything in this section is BurnRate\'s governance policy, not GitHub product functionality. |
|                                                                                                |
| Percentile thresholds, value tier mappings, and classification rules are configurable          |
|                                                                                                |
| parameters. Adjust them to fit your organization\'s usage patterns and risk tolerance.         |
+------------------------------------------------------------------------------------------------+

**5.1 Consumption Tier (Data-Driven)**

Calculated from 30-day rolling credit consumption using percentiles. Self-adjusts as org adoption grows.

  ------------- ------------------------ -----------------------------------------------------
  **Tier**      **Default Percentile**   **Description**

  Extreme       Top 15%                  Heavy agentic users; significant frontier model use

  High          P60--P85                 Active daily users with regular chat and agent use

  Medium        P25--P60                 Regular completions with occasional chat

  Low           Bottom 25%               Infrequent or completions-only usage
  ------------- ------------------------ -----------------------------------------------------

**Why these cutoffs?** P85 captures the long-tail heavy users who typically account for 40-60% of pool spend despite being only 15% of users — these are where budget intervention has the highest ROI. P25 identifies the bottom quartile whose combined spend rarely exceeds 5-10% of the pool, making them primary candidates for seat reclamation if inactive.

**Calibration by org size:**
- **<100 users:** Lower P85 to P80 — small orgs need broader intervention coverage.
- **100--1,000 users:** Default 85/60/25 split works well. The math stabilizes at this scale.
- **>1,000 users:** Raise P85 to P90 to focus only on true outliers. Large orgs have enough Extreme users at P90.
- **Monitor monthly:** If Extreme tier exceeds 20% of users, raise the threshold. If below 5%, lower it. Goal: Extreme tier users should account for at least 30% of pool spend.

**Classification SQL**

> SELECT github_login, SUM(credits) AS total_30d,
>
> CASE
>
> WHEN PERCENT_RANK() OVER (ORDER BY SUM(credits)) \>= 0.85 THEN \'extreme\'
>
> WHEN PERCENT_RANK() OVER (ORDER BY SUM(credits)) \>= 0.60 THEN \'high\'
>
> WHEN PERCENT_RANK() OVER (ORDER BY SUM(credits)) \>= 0.25 THEN \'medium\'
>
> ELSE \'low\'
>
> END AS consumption_tier
>
> FROM daily_usage
>
> WHERE usage_date \>= CURRENT_DATE - INTERVAL \'30 days\'
>
> GROUP BY github_login;

**5.2 Business Value Tier (Config-Driven)**

Sourced from value_config.yml in the repo. Org admins maintain team and title mappings. Everyone not matched defaults to \'normal\'.

> \# value_config.yml (BurnRate design decision --- edit to match your org)
>
> critical:
>
> teams: \[platform, architecture, security\]
>
> title_patterns: \[Staff Engineer, Principal, Distinguished\]
>
> low_priority:
>
> teams: \[interns, contractors\]
>
> title_patterns: \[Intern, Contractor\]

**5.3 Automation Decision Matrix**

  ------------------------- --------------------------- ------------------------- ------------------------
  **Consumption / Value**   **Critical**                **Normal**                **Low Priority**

  Extreme                   Increase ULB proactively    Monitor; notify manager   Flag for review queue

  High                      Monitor; efficiency check   Standard treatment        Efficiency review

  Medium                    No action needed            No action needed          No action needed

  Low                       No action needed            Pool reclaim candidate    Seat removal candidate
  ------------------------- --------------------------- ------------------------- ------------------------

**5.4 Efficiency Metrics**

+----------------------------------------------------------------------------------------+
| **BurnRate Design Decision**                                                           |
|                                                                                        |
| These computed metrics are BurnRate\'s value layer on top of raw GitHub usage data.    |
|                                                                                        |
| They distinguish high-value usage from high-cost waste and inform the decision matrix. |
+----------------------------------------------------------------------------------------+

  -------------------------- ---------------------------------- --------------------------------------
  **Metric**                 **Formula**                        **What It Reveals**

  Acceptance Rate            accepted_lines / suggested_lines   Are suggestions useful to this user?

  Credits per Accepted LOC   credits / accepted_lines           Cost efficiency of completions

  Credits per Chat Session   credits / chat_requests            Average cost per conversation

  Credits per Agent Run      credits / agent_requests           Average cost per agentic task

  Model Mix %                credits by model / total credits   Frontier model over-reliance
  -------------------------- ---------------------------------- --------------------------------------

**6. Forecasting**

+------------------------------------------------------------------------------------+
| **BurnRate Design Decision**                                                       |
|                                                                                    |
| Alert thresholds (80%, 90%, 110%) and the 15% divergence flag are BurnRate policy. |
|                                                                                    |
| Tune these to your organization\'s risk tolerance and billing cycle length.        |
+------------------------------------------------------------------------------------+

Use both 7-day and 30-day moving averages. Linear extrapolation breaks around sprint ends, releases, and hackathons. When forecasts diverge \>15%, flag it --- it signals a recent spike or drop the 30-day average hasn\'t absorbed.

> forecast_7d = mtd_credits + (rate_7d \* remaining_days_in_month)
>
> forecast_30d = mtd_credits + (rate_30d \* remaining_days_in_month)

  ------------------------------------- ------------------------------------------------------------- ------------------------------------
  **Condition**                         **Action**                                                    **Channel**

  Either forecast \> 90% of pool        Warning notification                                          Slack / email

  Either forecast \> 100% of pool       Escalation --- metered charges imminent (if policy enabled)   Slack + manager

  Either forecast \> 110% of pool       Recommend ULB tightening                                      PagerDuty / on-call

  User \> 80% of ULB by day 15          Promote consumption tier                                      Automated ULB write (Phase 4 only)

  User \< 20% of ULB by day 20          Flag for demotion next cycle                                  Log only; apply at cycle start

  7d and 30d forecasts diverge \> 15%   Investigate spike or drop                                     Dashboard flag
  ------------------------------------- ------------------------------------------------------------- ------------------------------------

**7. Automated Jobs**

**7.1 Nightly ETL --- 1:00 AM**

-   GET enterprise users-1-day, enterprise-1-day, enterprise-user-teams-1-day for YESTERDAY

-   GET org seats (sync users table: new seats, removed seats, last_activity_at)

-   Store raw payloads to raw_reports BEFORE parsing

-   Parse and upsert: daily_usage, team_usage, pool_snapshots

-   Compute derived columns: acceptance_rate, credits_per_acc_loc

**7.2 Daily Forecast --- 8:00 AM**

-   Calculate 7-day and 30-day moving average burn rates

-   Project both to month-end; compare against pool total

-   Trigger alert thresholds per Section 6

**7.3 Weekly Recalculation --- Sunday 2:00 AM**

-   Recalculate consumption tiers via 30-day percentile SQL

-   Re-read value_config.yml for any admin changes

-   Diff against current classification_history; write changes

-   POST/DELETE Individual ULBs only for Extreme tier changes (delta writes only)

-   Sync GET /budgets to reconcile any manual overrides

-   Send weekly digest: tier distribution, top 20 by credits, efficiency table, team breakdown

**7.4 Monthly Reset --- 1st of Month 3:00 AM**

-   Rerun full classification on prior month data

-   Recalibrate Universal ULB if pool utilization was consistently over/under

-   Generate chargeback report by team / cost center

-   Archive prior month raw_reports to cold storage

-   Recalibrate post-promo thresholds on September 1, 2026

**7.5 Budget Sync --- Nightly**

-   GET /organizations/{org}/settings/billing/budgets

-   Reconcile against local ULB state

-   Alert on any budget present in GitHub but not in BurnRate (manual override detection)

**8. Copilot Agent Skills (Interactive Layer)**

BurnRate packages Copilot Agent Skills for chat interfaces (Copilot Chat, Claude Code, etc.). Skills provide the human-intervention layer that complements the automated GitHub Actions jobs in Section 7. Each skill is a focused, discoverable capability surfaced through natural language commands.

| Skill | Command | Purpose |
|-------|---------|---------|
| ETL | `@burnrate /etl` | Manually trigger daily usage ingestion and raw report storage |
| Forecast | `@burnrate /forecast` | Run on-demand monthly usage forecasts; view projected pool utilization |
| Classify | `@burnrate /classify` | Run user tier classification on-demand (supports `--value-config` and `--report` flags) |
| Budget Sync | `@burnrate /budget-sync` | Sync user-level budgets and check alert statuses (supports `--dry-run` and `--json-logs`) |

Skills are defined in the `skills/` directory as standalone SKILL.md files and declared in `plugin.json`. They depend on the same TypeScript CLI that powers the automated jobs — skills are thin wrappers around the CLI, not duplicate implementations.

**9. Implementation Phasing**

+-------------------------------------------------------------------------+
| **Phase Gate Philosophy**                                               |
|                                                                         |
| Phase 1: Observe only. No automation. Build trust in the data.          |
|                                                                         |
| Phase 2: Recommendations with human approval. No auto-writes to GitHub. |
|                                                                         |
| Phase 3: Automation only after one full billing cycle of observation.   |
|                                                                         |
| OSS users who deploy without historical data must respect these gates.  |
+-------------------------------------------------------------------------+

  --------------------------- ----------------------------------------------------------------------------- ---------------------------------------------------------------
  **Phase**                   **Scope**                                                                     **Gate to Proceed**

  1 --- Observe (Wks 1--2)    ETL, raw storage, seats sync, dashboard, basic forecasting                    2 weeks of clean data validated

  2 --- Classify (Wk 3)       2D classification, efficiency metrics, weekly recalc, recommendation engine   One week of classification diffs reviewed by humans

  3 --- Recommend (Wk 4)      Budget API reads, ULB state sync, human-approved write queue                  Budget CRUD confirmed in target enterprise; precedence tested

  4 --- Automate (Wks 5--6)   Auto ULB writes for Extreme tier, pool alerts, mid-month triggers             One full billing cycle observed with Phase 3

  5 --- Optimize (Aug 2026)   Post-promo recalibration, model-cost analytics, chargeback                    September cliff approaching --- recalibrate before Sept 1
  --------------------------- ----------------------------------------------------------------------------- ---------------------------------------------------------------

**10. Dashboard Design**

**Executive Tab**

  ------------------------------ ---------------------------- ----------------------
  **Metric**                     **Source**                   **Cadence**

  Pool Used % this month         pool_snapshots               Daily

  7-day Forecast vs Pool         Forecast job                 Daily

  30-day Forecast vs Pool        Forecast job                 Daily

  Active Licensed Users          users table                  Nightly

  Users Blocked (ULB hit)        Budget API sync              Nightly

  Extreme + Low Priority count   Classification               Weekly

  Post-Promo Risk (Sept 1)       Modeled from current usage   Weekly
  ------------------------------ ---------------------------- ----------------------

**Team View**

-   Credits MTD and % of pool by team

-   Forecast to month-end per team

-   Average acceptance rate and credits-per-LOC by team

-   7-day trend vs prior week

**User View**

-   github_login, consumption tier, value tier

-   Credits MTD, ULB cap, ULB used %

-   Acceptance rate, credits per accepted LOC, model mix

-   Last activity timestamp, IDE

**FinOps Tab**

-   Top 20 consumers by credit spend

-   Efficiency ranking: credits per accepted LOC (ascending = most efficient)

-   Credit cost by model (GPT-5.x vs Claude vs MAI-Code vs others)

-   Cost by feature: chat vs agent vs code review

-   Inactive seat candidates: last_activity_at \> 30 days

-   Review queue: Extreme + Low Priority users flagged for manager action

**11. Audit Trail --- All Known Corrections**

Three rounds of review have been applied to this document. All corrections are logged here.

  ------------------------------------------------- ----------------------------------------------------- ----------------------
  **Incorrect Claim**                               **Correct Information**                               **Source**

  /users-28-day/latest exists                       No /latest suffix. Path: /users-28-day                Live docs nav v3.0

  /enterprise-28-day/latest exists                  No /latest suffix. Path: /enterprise-28-day           Live docs nav v3.0

  GET /orgs/{org}/members/{username}/copilot        Not in docs. Filter seat list by login.               Live docs v1.0

  GitHub has no per-user hard caps                  FALSE. ULBs are hard stops as of June 1, 2026.        Live docs v1.0

  API version header: 2022-11-28                    Current latest: 2026-03-10                            Live docs v1.0

  Legacy metrics endpoints closed April 2, 2026     Marked deprecated; exact closure date unverified.     Docs review v3.0

  Budget API is unverified/sparse                   Full CRUD confirmed in live docs.                     Live docs v2.0

  Linear extrapolation for forecasting              Use 7d + 30d moving averages.                         Review v2.0

  3-bucket system is sufficient                     2D (consumption x value) prevents misallocation.      Review v2.0

  Generic /settings/billing/usage for AI credits    Use specific /settings/billing/ai_credit/usage        Live docs v3.0

  Cost center + enterprise budgets are hard stops   Hard stop only if \'Stop usage\' flag is enabled.     Live docs v3.0

  Metered usage starts when pool exhausted          Only if \'AI credit paid usage\' policy is enabled.   Live docs v3.0

  No permissions matrix in document                 Full matrix added in Section 2.                       Review v3.0

  Design decisions unlabeled as GitHub facts        All BurnRate policy decisions now labeled.            Review v3.0
  ------------------------------------------------- ----------------------------------------------------- ----------------------

*BurnRate Reference v3.0 --- Verified against GitHub Docs June 13, 2026. Three rounds of multi-source audit applied. API endpoints subject to change; validate against docs.github.com/en/rest/copilot before implementing.*
