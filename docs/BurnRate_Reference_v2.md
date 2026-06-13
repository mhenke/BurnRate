**BurnRate**

GitHub Copilot AI Credit Governance Platform

*Architecture, API Reference & Implementation Guide*

*Version 2.0 --- Verified against GitHub Docs June 13, 2026*

This document is the definitive reference for building BurnRate --- a FinOps-style governance layer for GitHub Copilot AI Credits. It synthesizes verified GitHub API surface, corrects errors found in earlier research, and incorporates second-pass improvements including 2D user classification, efficiency metrics, raw payload storage, and moving-average forecasting. BurnRate is designed as an open-source platform. All API patterns, data models, and job pipelines can be self-hosted against any GitHub Copilot subscription tier. See Section 10 for self-hosting guidance and sample configuration. BurnRate uses GitHub Actions to orchestrate autonomous ETL and automation jobs (Section 6), with GitHub Copilot Skills driving the human-intervention layers for approvals, recommendations, and interactive workflows (Section 7).

**1. Billing Model Context (June 2026)**

GitHub Copilot switched from flat Premium Request Units to usage-based AI Credit billing on June 1, 2026. Understanding this model is prerequisite to any API work.

  ----------------------- --------------------------- -------------------------
  **Plan**                **Standard Credits/Seat**   **Promo Jun--Aug 2026**

  Copilot Business        1,900 / seat / month        3,000 / seat / month

  Copilot Enterprise      3,900 / seat / month        7,000 / seat / month

  Copilot Pro             1,500 / month               ---

  Copilot Pro+            7,000 / month               ---
  ----------------------- --------------------------- -------------------------

+-----------------------------------------------------------------------+
| **⚠️ Post-Promo Cliff: September 1, 2026**                            |
|                                                                       |
| Business drops from 3,000 → 1,900 credits/seat. Enterprise drops from |
| 7,000 → 3,900.                                                        |
|                                                                       |
| Design all thresholds, ULB amounts, and bucket boundaries using       |
| post-promo numbers.                                                   |
|                                                                       |
| The promotional window (June--August) is your calibration period, not |
| your steady state.                                                    |
+-----------------------------------------------------------------------+

**Key mechanics:** All seat credits pool at the enterprise level. 1 AI Credit = \$0.01 USD. Code completions and Next Edit Suggestions are unlimited and never consume credits. All other features (chat, agents, code review) are metered. For org-only deployments (no enterprise access), org-level equivalents exist for most endpoints --- see Section 2.2. Without enterprise access, you lose 28-day rolling reports and team mapping.

**2. API Surface --- The Five Domains**

BurnRate requires data from five API domains. Use API version header X-GitHub-Api-Version: 2026-03-10 on all requests.

**2.1 Seat Management**

**Purpose:** Who has a license, assignment date, last activity, seat type.

**Org-level seats**

> GET /orgs/{org}/copilot/billing/seats
>
> ?per_page=100&page=N (paginate via Link header)

**Enterprise-level seats**

> GET /enterprises/{enterprise}/copilot/billing/seats

Response per seat:

> { \"assignee\": { \"login\": \"jdoe\" },
>
> \"last_activity_at\": \"2026-06-10T12:00:00Z\",
>
> \"last_activity_editor\": \"vscode\",
>
> \"created_at\": \"2024-01-10T00:00:00Z\",
>
> \"plan_type\": \"business\" }

+-----------------------------------------------------------------------+
| **Auth Requirements**                                                 |
|                                                                       |
| Classic PAT: manage_billing:copilot + read:org (org endpoint)         |
|                                                                       |
| Classic PAT: manage_billing:copilot or read:enterprise (enterprise    |
| endpoint)                                                             |
|                                                                       |
| Fine-grained PAT: GitHub Copilot Business org permission (org         |
| endpoint only)                                                        |
|                                                                       |
| Enterprise endpoint does NOT support fine-grained PATs                |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| **❌ Endpoint Does Not Exist**                                        |
|                                                                       |
| Multiple sources cited GET /orgs/{org}/members/{username}/copilot for |
| individual seat lookup.                                               |
|                                                                       |
| This endpoint is not in current GitHub Docs. Filter the seats list by |
| login instead.                                                        |
+-----------------------------------------------------------------------+

**2.2 Usage Metrics Reports (Primary Data Source)**

Important: The legacy /copilot/metrics endpoints were deprecated as of April 2, 2026 (confirmed closure date). All integrations must use the Usage Metrics Reports API below.

+-----------------------------------------------------------------------+
| **Prerequisite**                                                      |
|                                                                       |
| Set \'Copilot usage metrics\' policy to \'Enabled everywhere\' in     |
| enterprise settings.                                                  |
|                                                                       |
| Without this, all /metrics/reports/\* endpoints return 403.           |
+-----------------------------------------------------------------------+

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

All endpoints return signed download URLs, not data directly:

> { \"download_links\": \[\"https://signed-url\...\"\], \"report_day\": \"2026-06-12\" }

Download and parse each URL immediately --- signed URLs expire. Store the raw payload before parsing (see Section 3.2).

+-----------------------------------------------------------------------+
| **❌ No /latest Suffix**                                              |
|                                                                       |
| Multiple sources cited paths like /users-28-day/latest and            |
| /enterprise-28-day/latest.                                            |
|                                                                       |
| These paths do not exist. The 28-day endpoints have no suffix. 1-day  |
| endpoints require ?day= param.                                        |
+-----------------------------------------------------------------------+

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

**2.3 Billing Usage**

> GET /organizations/{org}/settings/billing/usage

Provides AI credit consumption billed to org account. Use for financial reconciliation and chargeback. Covers org-managed licenses only --- not self-purchased individual plans. For dedicated AI credit billing details, use: GET /organizations/{org}/settings/billing/ai_credit/usage --- this endpoint returns AI-credit-specific consumption, allocation, and remaining pool balance. The generic /settings/billing/usage endpoint includes AI credits alongside other billing line items; use the dedicated AI credit endpoint when you need granular credit-only data.

**2.4 Budget Management (Enforcement Layer)**

Hard per-user credit caps via the Budget API. Shipped June 1, 2026.

Budget Hierarchy (four controls, evaluated in order):

1\. Individual ULB (User-Level Budget) --- Per-user override. Highest precedence. Applied immediately when configured via Budget API. Only set for users needing custom caps.

2\. Universal ULB --- Default cap for all licensed users in the org. Applies when no Individual ULB is set. Configured via Budget API with budget_scope=org.

3\. Org Budget --- Spending limit at the GitHub organization level. Applies after all individual ULBs are exhausted. \'Stop usage when budget limit is reached\' is OFF by default for this level --- must be explicitly enabled.

4\. Enterprise Spending Limit --- Account-level cap covering all orgs in the enterprise. Applies after org budgets are exhausted. \'Stop usage when budget limit is reached\' is OFF by default for this level --- must be explicitly enabled at https://github.com/settings/billing. When enabled and the limit is hit, ALL AI-credit-consuming features are blocked across the enterprise.

Important enterprise/org budget behavior: These controls act as pool-level gates --- they only block usage after their respective budget pool is fully exhausted. This is different from ULBs, which are individual hard stops. Monitor pool burn rate independently regardless of ULB configuration. See Table 9 for cross-blocking risk notes.

+-----------------------------------------------------------------------+
| **✅ Per-User Hard Caps Exist**                                       |
|                                                                       |
| User-Level Budgets (ULBs) are real hard stops as of June 1, 2026.     |
|                                                                       |
| When a user hits their ULB, all AI-credit-consuming Copilot features  |
| are blocked immediately.                                              |
|                                                                       |
| Code completions continue --- they don\'t consume credits.            |
|                                                                       |
| There is no automatic fallback to cheaper models. It\'s a hard stop.  |
+-----------------------------------------------------------------------+

**List budgets**

> GET /organizations/{org}/settings/billing/budgets

**Create user budget (Individual ULB)**

> POST /organizations/{org}/settings/billing/budgets
>
> Body: { \"budget_amount\": 30,
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

+-----------------------------------------------------------------------+
| **⚠️ Validate CRUD Before Building Phase 3**                          |
|                                                                       |
| Confirm all four operations work in your enterprise before wiring up  |
| automation:                                                           |
|                                                                       |
| POST (create), GET (read), PATCH (modify amount), DELETE (remove      |
| override).                                                            |
|                                                                       |
| Also validate the exact precedence chain: Individual ULB → Universal  |
| ULB → Org budget → Enterprise limit.                                  |
|                                                                       |
| Edge case to test: user has ULB remaining but enterprise pool is      |
| exhausted. Does metered billing begin?                                |
|                                                                       |
| These answers must be confirmed before Phase 3 automation fires real  |
| budget writes.                                                        |
+-----------------------------------------------------------------------+

**Universal ULB vs Individual ULB**

  ---------------- ------------------------------------------------------------------------------------------- --------------------------------------------------------------------------
  **Type**         **Scope**                                                                                   **BurnRate Usage**

  Universal ULB    Default for all licensed users in the org. Off by default --- must be explicitly created.   Set org-wide floor. Covers Standard + Light buckets automatically.

  Individual ULB   Per-user override (full precedence)                                                         Write via API for Power users needing higher caps. Only touch the delta.
  ---------------- ------------------------------------------------------------------------------------------- --------------------------------------------------------------------------

+-----------------------------------------------------------------------+
| ⚠️ Cross-Blocking Risk\                                               |
| A user can be blocked by the enterprise spending limit before         |
| reaching their individual ULB\                                        |
| if the enterprise pool exhausts first. Monitor pool burn rate         |
| independently.                                                        |
|                                                                       |
| \'Stop usage when budget limit is reached\' is OFF by default for org |
| budgets and enterprise-level spending limits. You must explicitly     |
| enable it in GitHub billing settings if you want hard stops at those  |
| levels. ULBs (Individual and Universal) always act as hard stops when |
| set.                                                                  |
+-----------------------------------------------------------------------+

**2.5 Team Mapping (Added May 2026)**

Maps licensed users to their GitHub teams. Without this, you have User → Cost. With this, you have User → Team → Department → Cost Center. Enables chargeback.

> GET /enterprises/{enterprise}/copilot/metrics/reports/enterprise-user-teams-1-day?day=YYYY-MM-DD
>
> GET /orgs/{org}/copilot/metrics/reports/org-user-teams-1-day?day=YYYY-MM-DD

Make this a first-class table in your warehouse. Join with daily_usage for team-level credit consumption.

2.6 Permissions Matrix

The following permissions are required for each API domain. See also Table 2 for auth requirements.

Seat Management (Section 2.1):

\- Org: Classic PAT with manage_billing:copilot + read:org, or Fine-grained PAT with GitHub Copilot Business org permission

\- Enterprise: Classic PAT with manage_billing:copilot or read:enterprise. Fine-grained PATs are NOT supported for enterprise endpoints.

Usage Metrics Reports (Section 2.2):

\- Enterprise: Classic PAT with read:enterprise or manage_billing:copilot

\- Org: Classic PAT with manage_billing:copilot + read:org

\- Prerequisite: \'Copilot usage metrics\' policy set to \'Enabled everywhere\' in enterprise settings (else 403).

Billing Usage (Section 2.3):

\- Generic endpoint (GET /organizations/{org}/settings/billing/usage): manage_billing:copilot

\- Dedicated AI credit endpoint (GET /organizations/{org}/settings/billing/ai_credit/usage): manage_billing:copilot

Budget Management (Section 2.4):

\- All budget CRUD operations: manage_billing:copilot

\- Both org and user scopes require the same scope.

Team Mapping (Section 2.5):

\- Requires read:org (for org endpoint) or read:enterprise (for enterprise endpoint).

Open-source deployment note: For self-hosted deployments without GitHub billing access, mock permissions or use a service account with the minimum required scopes. All endpoints are read-only except Budget POST/PATCH/DELETE in Phase 3+.

**3. Data Model**

Retain all data for at least 13 months to support year-over-year comparison and seasonal pattern detection. Never delete raw payloads. Note: This retention period is a BurnRate recommendation for year-over-year comparison. Self-hosted deployments may choose shorter retention based on storage constraints. Never delete raw payloads if you want the ability to re-parse after schema changes.

**3.1 Core Tables**

**users**

> github_login VARCHAR PRIMARY KEY
>
> employee_id VARCHAR \-- OPTIONAL: HR system ID; can be NULL for OSS deployments
>
> team VARCHAR
>
> manager VARCHAR \-- OPTIONAL: manager GitHub login; can be NULL if not tracked
>
> consumption_tier ENUM(\'low\',\'medium\',\'high\',\'extreme\')
>
> value_tier ENUM(\'critical\',\'normal\',\'low_priority\')
>
> bucket_updated_at TIMESTAMP
>
> seat_created_at TIMESTAMP
>
> last_activity_at TIMESTAMP

+-----------------------------------------------------------------------+
| **New: Two-Tier Classification**                                      |
|                                                                       |
| Users are classified on two independent axes: consumption tier and    |
| business value tier.                                                  |
|                                                                       |
| Business value is sourced from an org-provided config file (job title |
| or team mapping)                                                      |
|                                                                       |
| since GitHub has no concept of role criticality. See Section 4 for    |
| classification logic.                                                 |
+-----------------------------------------------------------------------+

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
> acceptance_rate NUMERIC(5,4) \-- computed: accepted/suggested
>
> credits_per_acc_loc NUMERIC(10,4) \-- computed: credits/accepted_lines
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
> reason VARCHAR \-- \'weekly_recalc\',\'mid_month\',\'manual\'
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
> forecast_7d NUMERIC(12,2) \-- 7-day moving avg projection
>
> forecast_30d NUMERIC(12,2) \-- 30-day moving avg projection
>
> pct_elapsed NUMERIC(5,2)
>
> PRIMARY KEY (snapshot_date)

**3.2 Raw Payload Storage (New)**

+-----------------------------------------------------------------------+
| **Never Discard Raw Payloads**                                        |
|                                                                       |
| Store the raw JSON downloaded from signed URLs before any parsing.    |
|                                                                       |
| GitHub\'s report schema has changed before and will change again.     |
|                                                                       |
| Raw storage means a schema change never corrupts your history ---     |
| reparse from raw.                                                     |
+-----------------------------------------------------------------------+

**raw_reports**

> id BIGSERIAL PRIMARY KEY
>
> report_date DATE
>
> report_type VARCHAR \-- \'users-1-day\',\'enterprise-1-day\',\'user-teams-1-day\',etc.
>
> source_url VARCHAR \-- the signed URL (for audit trail)
>
> payload JSONB
>
> fetched_at TIMESTAMP DEFAULT NOW()

**4. Two-Dimensional User Classification**

The original single-axis bucket system (Light / Standard / Power) treats heavy usage as deserving more budget. The 2D system adds business value as a second axis, enabling smarter automation decisions.

**4.1 Consumption Tier (Data-Driven)**

Calculated from 30-day rolling credit consumption using percentiles. Self-adjusts as org adoption grows. The percentile thresholds (P85, P60, P25) are BurnRate design decisions, not GitHub-defined cutoffs. They can be adjusted in burnrate.yml to match your organization\'s usage distribution.

  ------------- ---------------- ----------------------------------------------------
  **Tier**      **Percentile**   **Description**

  Extreme       Top 15%          Power agentic users; heavy model usage

  High          P60--P85         Active daily users with significant chat/agent use

  Medium        P25--P60         Regular completions + occasional chat

  Low           Bottom 25%       Infrequent or completions-only usage
  ------------- ---------------- ----------------------------------------------------

**Percentile SQL**

> SELECT github_login,
>
> SUM(credits) AS total_30d,
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

**4.2 Business Value Tier (Config-Driven)**

Sourced from a value_config.yml file in the repo. Org admins maintain mappings. GitHub has no concept of role criticality, so this must be externally provided. The value tiers and their mapping rules are entirely BurnRate-defined --- GitHub has no built-in concept of user criticality. The default config (critical, normal, low_priority) is a starting point; self-hosted deployments can define additional tiers or change the naming scheme.

> \# value_config.yml
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
>
> \# Everyone else defaults to: normal

**4.3 Automation Decision Matrix**

Cross the two tiers to determine automated action:

  ----------------------------- --------------------------- ---------------------------- ----------------------------
  **Consumption ↓ / Value →**   **Critical**                **Normal**                   **Low Priority**

  Extreme                       Increase ULB proactively    Monitor; notify manager      Flag for review queue

  High                          Monitor; efficiency check   Standard treatment           Efficiency review

  Medium                        Fine --- no action          Fine --- no action           Fine --- no action

  Low                           Fine --- no action          Candidate for pool reclaim   Candidate for seat removal
  ----------------------------- --------------------------- ---------------------------- ----------------------------

+-----------------------------------------------------------------------+
| **Key Insight: Heavy Usage ≠ Deserves More Budget**                   |
|                                                                       |
| Extreme + Critical → increase budget. These users are delivering high |
| value.                                                                |
|                                                                       |
| Extreme + Low Priority → investigate before spending more. May be     |
| misuse or runaway agents.                                             |
|                                                                       |
| Low + Critical → completely fine. Not every critical engineer is an   |
| AI power user.                                                        |
|                                                                       |
| Low + Low Priority → primary candidates for seat reclamation.         |
+-----------------------------------------------------------------------+

**4.4 Efficiency Metrics (New)**

Collect these alongside credit consumption. They distinguish high-value usage from high-cost waste.

  -------------------------- ---------------------------------- -----------------------------------------------
  **Metric**                 **Formula**                        **What It Reveals**

  Acceptance Rate            accepted_lines / suggested_lines   Are suggestions actually useful to this user?

  Credits per Accepted LOC   credits / accepted_lines           Cost efficiency of completions usage

  Credits per Chat Session   credits / chat_requests            Average cost per conversation

  Credits per Agent Run      credits / agent_requests           Average cost per agentic task

  Model Mix %                credits by model / total credits   Identifies frontier model over-reliance
  -------------------------- ---------------------------------- -----------------------------------------------

Example: two users both spend 20,000 credits in a month. User A has 12,000 accepted lines. User B has 1,200 accepted lines. Same spend, 10x difference in value delivered. Efficiency metrics surface this; raw credit totals do not.

**5. Forecasting**

Use both a 7-day and 30-day moving average rather than simple linear extrapolation. Linear forecasts break around sprint ends, releases, and hackathons.

**5.1 Moving Average Forecast**

> \-- 7-day moving average daily burn rate
>
> SELECT AVG(daily_credits) AS rate_7d
>
> FROM (
>
> SELECT SUM(credits) AS daily_credits
>
> FROM daily_usage
>
> WHERE usage_date \>= CURRENT_DATE - INTERVAL \'7 days\'
>
> GROUP BY usage_date
>
> ) t;
>
> \-- Forecast = rate \* remaining days in month
>
> forecast_7d = mtd_credits + (rate_7d \* remaining_days)
>
> forecast_30d = mtd_credits + (rate_30d \* remaining_days)

Report both forecasts. When they diverge significantly (\>15%), flag it --- it usually means a recent usage spike or drop that the 30-day average hasn\'t absorbed yet.

**5.2 Alert Thresholds**

All alert thresholds (90% warning, 100% escalation, 110% immediate) are BurnRate recommendations, not GitHub-enforced limits. Self-hosted deployments should tune these based on their pool size, risk tolerance, and billing cycle. See Table 16 for the full threshold matrix.

  ------------------------------------- ----------------------------------------- --------------------------------
  **Condition**                         **Action**                                **Channel**

  Either forecast \> 90% of pool        Warning notification                      Slack / email

  Either forecast \> 100% of pool       Escalation --- metered charges imminent   Slack + manager

  Either forecast \> 110% of pool       Recommend immediate ULB tightening        PagerDuty / on-call

  User \> 80% of ULB by day 15          Promote to next consumption tier          Automated ULB write

  User \< 20% of ULB by day 20          Flag for demotion next cycle              Log only; apply at cycle start

  7d and 30d forecasts diverge \> 15%   Investigate spike or drop                 Dashboard flag
  ------------------------------------- ----------------------------------------- --------------------------------

**6. Automated Jobs**

All automated jobs in this section are implemented as GitHub Actions workflows, triggered on schedule (cron). Each job runs autonomously --- fetching API data, storing raw payloads, computing forecasts, and writing budget updates. The ETL pipeline, forecast engine, weekly recalculation, monthly reset, and budget sync are all managed through reusable GitHub Actions workflows. Self-hosted deployments may substitute cron, Docker, or any scheduler (see Section 10). The human-intervention checkpoints (Phase 2--3) are surfaced through GitHub Copilot Skills, described in Section 7.

**6.1 Nightly ETL --- 1:00 AM**

-   GET /enterprises/{e}/copilot/metrics/reports/users-1-day?day=YESTERDAY

-   GET /enterprises/{e}/copilot/metrics/reports/enterprise-1-day?day=YESTERDAY

-   GET /enterprises/{e}/copilot/metrics/reports/enterprise-user-teams-1-day?day=YESTERDAY

-   GET /enterprises/{e}/copilot/billing/seats

-   For each endpoint: store raw payload to raw_reports BEFORE parsing

-   Parse and upsert into daily_usage, team_usage, users, pool_snapshots

-   Compute derived columns: acceptance_rate, credits_per_acc_loc

**6.2 Daily Forecast --- 8:00 AM**

-   Calculate 7-day and 30-day moving average burn rates

-   Project both to month-end

-   Compare against pool total and (if configured) enterprise spending limit. For org-only deployments without enterprise billing access, compare against pool total only.

-   Trigger alert thresholds per Section 5.2

**6.3 Weekly Recalculation --- Sunday 2:00 AM**

-   Recalculate consumption tiers using 30-day rolling percentiles

-   Re-read value_config.yml to pick up any admin changes

-   Diff against current classification_history

-   For each change: write to classification_history, update users table

-   POST/DELETE Individual ULBs only for Extreme tier changes (delta only)

-   Send weekly digest: tier distribution, top 20 by credits, efficiency leaderboard, team breakdown

**6.4 Monthly Baseline Reset --- 1st of Month 3:00 AM**

-   Rerun full classification on prior month data

-   Recalibrate Universal ULB if pool utilization was consistently over/under

-   Generate chargeback report by team / cost center

-   Archive prior month raw_reports to cold storage

-   Update post-promo thresholds if applicable (critical on September 1, 2026)

**6.5 GET budgets sync --- Nightly**

-   GET /organizations/{org}/settings/billing/budgets

-   Reconcile against local ULB state

-   Alert on any budget that exists in GitHub but not in BurnRate (manual override detection)

**7. Implementation Phasing**

BurnRate uses GitHub Copilot Skills for all human-intervention layers. Skills handle Phase 2 recommendation review, Phase 3 human-approved write queues, and interactive workflows such as on-demand forecasts, ad-hoc classification re-runs, and manager approval flows. Unlike a traditional extension shell, each skill is a focused, discoverable capability surfaced through the GitHub Copilot chat interface --- admins interact with BurnRate through natural language commands rather than a custom control plane. The autonomous ETL and automation jobs run via GitHub Actions (Section 6), while Copilot Skills provide the human-in-the-loop decision layer.

+-----------------------------------------------------------------------+
| **Phase Gate Philosophy**                                             |
|                                                                       |
| Phase 1: Observe only. No automation. Build trust in the data.        |
|                                                                       |
| Phase 2: Recommendations with human approval. No auto-writes.         |
|                                                                       |
| Phase 3: Automation only after one full billing cycle of observation. |
|                                                                       |
| This is especially important for OSS users who deploy without         |
| historical data.                                                      |
+-----------------------------------------------------------------------+

The phase gates in Table 17 and Table 18 reflect this architecture: Phases 1 and 4--5 are fully automated (GitHub Actions). Phases 2--3 involve Copilot Skills for human review and approval before automation proceeds.

  ------------------------------ ----------------------------------------------------------------------------- ------------------------------------------------
  **Phase**                      **Scope**                                                                     **Gate to Proceed**

  1 --- Observe (Weeks 1--2)     ETL pipeline, raw storage, seats sync, dashboard, basic forecasting           Data quality validated across 2 weeks

  2 --- Classify (Week 3)        2D classification, efficiency metrics, weekly recalc, recommendation engine   One full week of classification diffs reviewed

  3 --- Recommend (Week 4)       Budget API reads, ULB state sync, human-approved write queue                  Budget CRUD validated in target enterprise

  4 --- Automate (Weeks 5--6)    Auto ULB writes for Extreme tier, pool alerts, mid-month triggers             One full billing cycle observed

  5 --- Optimize (August 2026)   Post-promo recalibration, model-cost analytics, chargeback reports            September cliff approaching
  ------------------------------ ----------------------------------------------------------------------------- ------------------------------------------------

**8. Dashboard Design**

**Executive Tab**

  ------------------------------ ---------------------------- ----------------------
  **Metric**                     **Source**                   **Cadence**

  Pool Used % this month         pool_snapshots               Daily

  7-day Forecast vs Pool         Forecast job                 Daily

  30-day Forecast vs Pool        Forecast job                 Daily

  Active Licensed Users          users table                  Nightly

  Users Blocked (ULB hit)        Budget API sync              Nightly

  Extreme + Low Priority count   Classification               Weekly

  Post-Promo Risk Score          Modeled from current usage   Weekly
  ------------------------------ ---------------------------- ----------------------

**Team View Tab**

-   Credits MTD and % of pool by team

-   Forecast to month-end per team

-   Average acceptance rate and credits-per-LOC by team

-   7-day trend vs prior week

**User View Tab**

-   github_login, consumption tier, value tier

-   Credits MTD, ULB cap, ULB used %

-   Acceptance rate, credits per accepted LOC, model mix

-   Last activity timestamp, IDE used

**FinOps Tab**

-   Top 20 consumers by credit spend

-   Efficiency ranking: credits per accepted LOC (ascending = most efficient)

-   Credit cost by model (GPT-5.x vs Claude vs MAI-Code vs others)

-   Cost by feature: chat vs agent vs code review vs completions

-   Inactive seat candidates: last_activity_at \> 30 days

-   Review queue: Extreme + Low Priority users flagged for manager action

**9. Corrections vs Prior Research**

Documented to prevent errors from propagating into the implementation.

  -------------------------------------------- ------------------------------------------------- --------------------------------------------
  **Incorrect Claim**                          **Correct Information**                           **Impact if Wrong**

  /users-28-day/latest exists                  No /latest suffix. Use /users-28-day              404 errors in ETL

  /enterprise-28-day/latest exists             No /latest suffix. Use /enterprise-28-day         404 errors in ETL

  GET /orgs/{org}/members/{username}/copilot   Not in docs. Filter seat list by login.           404 errors

  GitHub has no per-user hard caps             FALSE. ULBs ship June 1. Use Budget API.          Entire enforcement model wrong

  API version: 2022-11-28                      Current latest: 2026-03-10                        Silent failures or deprecated behavior

  Old /copilot/metrics endpoints work          Closed April 2, 2026. Use /metrics/reports/\*     All metrics calls fail

  Budget API is unverified/sparse              Confirmed in live docs with full CRUD + payload   Phase 3 blocked unnecessarily

  Linear extrapolation for forecasting         Use 7d + 30d moving averages                      Noisy forecasts around releases

  3-bucket system covers all cases             2D (consumption × value) prevents misallocation   Heavy user gets budget they don\'t deserve
  -------------------------------------------- ------------------------------------------------- --------------------------------------------

10\. Self-Hosting & Configuration (Open Source)

BurnRate is an open-source governance layer. The following guidance applies to self-hosted deployments.

Reference architecture: GitHub Actions orchestrates the autonomous ETL and automation jobs described in Section 6. GitHub Copilot Skills provide the human-intervention layer --- approval flows, recommendation reviews, and interactive queries (Section 7). Self-hosted deployments can substitute any scheduler for GitHub Actions and any chat interface for Copilot Skills.

Prerequisites:

\- GitHub Copilot subscription (Business or Enterprise) with admin access

\- GitHub Classic PAT or Fine-grained PAT with the scopes listed in Section 2.6

\- PostgreSQL 14+ (or SQLite for single-user evaluation)

\- Python 3.11+, Node.js 18+, or your preferred runtime for the ETL pipeline

\- (Optional) A Slack webhook or email relay for alert notifications

Minimal local dev setup:

1\. Clone the repository and copy config/burnrate.sample.yml to config/burnrate.yml

2\. Set GITHUB_TOKEN, GITHUB_ENTERPRISE, and GITHUB_ORG in your environment or .env file

3\. Run \'docker compose up -d db\' to start the database (or connect to an existing instance)

4\. Start the ETL pipeline: \'python -m burnrate.etl \--once\' to backfill the last 7 days

5\. Verify data in the dashboard or via \'python -m burnrate.check\'

Sample configuration (config/burnrate.sample.yml):

enterprise: your-enterprise-slug

org: your-org-name

api_base: https://api.github.com

api_version: \'2026-03-10\'

db:

host: localhost

port: 5432

database: burnrate

user: burnrate

password: \'\${DB_PASSWORD}\' \# from environment

storage:

raw_payload: s3://your-bucket/burnrate/raw/ \# or local path

alerts:

slack_webhook: \'\${SLACK_WEBHOOK}\'

email_smtp: smtp.example.com:587

User-provided secrets & config:

\- GITHUB_TOKEN: Classic PAT with manage_billing:copilot + read:org (org) or read:enterprise (enterprise)

\- DB_PASSWORD: Database connection password (never commit to version control)

\- SLACK_WEBHOOK: Incoming webhook URL for alert notifications

\- value_config.yml: Business value tier mappings (see Section 4.2)

\- All secrets can be provided via environment variables, a .env file, or your secret manager of choice.

Extensibility notes:

\- The users table includes employee_id and manager fields for HR integrations. These are OPTIONAL --- BurnRate works without them. Leave NULL if you don\'t have HR data.

\- The value_config.yml title_patterns and team mappings are also optional. Without them, all users default to the \'normal\' value tier.

\- For single-org deployments without enterprise access, all endpoints have org-level equivalents (see Section 2.2). You will not have enterprise-level team mapping or 28-day rolling reports.

Load testing recommendation:

Before deploying automation (Phase 3+), run a dry cycle against a staging environment. The Budget API has rate limits that vary by plan tier. Start with conservative backoff.

*BurnRate Reference v2.0 --- Verified against GitHub Docs June 13, 2026. Incorporates corrections and improvements from multi-source audit. API endpoints subject to change; validate against docs.github.com/en/rest/copilot before implementing.*
