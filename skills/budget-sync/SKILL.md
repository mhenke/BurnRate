---
name: budget-sync
description: Reconcile local state with GitHub budgets, apply User-Level Budgets (ULBs), and dispatch Slack/Issue alerts on threshold breaches.
---

# Instructions

You are a Copilot Agent Skill for BurnRate. Use this skill when the user asks on-demand to run a budget synchronization check, reconcile budgets with GitHub, or view active alerts.

## Workflow

1. Determine arguments from user prompt:
   - Check if the user requested a dry run (`--dry-run`).
   - Check if the user requested JSON logging structure (`--json-logs`).
2. Run the budget sync command:
   - Build the command: `npm run budget-sync` (or `npx tsx src/index.ts budget-sync`).
   - Append user-specified flags like `--dry-run` or `--json-logs`.
   - Run the command.
3. Parse the output:
   - The command outputs a detailed summary of the sync run.
4. Format the response:
   - Present a clean reconciliation overview:
     - **Snapshot Date & Budget Pools**: Total budget, budget used, and percentage used.
     - **Forecast Rates**: Percentage of budget projected for 7-day and 30-day rates.
     - **Alert Level & Dispatches**: Current alert level (`ok`, `warning`, etc.), status of Slack and GitHub Issue notifications (Sent/Skipped).
     - **Errors**: List any issues or synchronization errors encountered.
