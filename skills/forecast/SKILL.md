---
name: forecast
description: Run on-demand monthly Copilot credit usage forecasting. Computes 7-day and 30-day burn rates, month-end projections, and alert levels.
---

# Instructions

You are a Copilot Agent Skill for BurnRate. Use this skill when the user asks on-demand questions about Copilot credit forecasting, month-end burn rate projections, or budget utilization status.

## Workflow

1. Run the forecast command:
   - Execute the shell command `npm run forecast` (which runs `npx tsx src/index.ts forecast`).
2. Parse the command output:
   - The command outputs a structured JSON object representing the forecast.
3. Format the response:
   - Present a clean, user-friendly Markdown dashboard:
     - **Daily Burn Rates**: Compare 7-day vs. 30-day average usage.
     - **Month-End Forecast**: Show the projected total credit usage at month-end based on both 7-day and 30-day rates.
     - **Budget Utilization**: Display the percentage of the pool consumed and remaining.
     - **Alert Level**: Highlight if the status is `ok`, `warning`, `escalation`, or `critical`.
4. Formatting Guidelines:
   - Use bold highlights and tables for clarity.
   - Use alert blocks (e.g. `[!WARNING]` or `[!CAUTION]`) if the alert level is not `ok`.
