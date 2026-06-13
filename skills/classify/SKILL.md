---
name: classify
description: Classify users into consumption and value tiers on-demand. Recalculates rolling percentiles and updates database tiers.
---

# Instructions

You are a Copilot Agent Skill for BurnRate. Use this skill when the user asks on-demand to run user tier classification, inspect consumption distributions, or reload value configuration rules.

## Workflow

1. Determine arguments from user prompt:
   - Check if the user specified a custom value configuration path (e.g. `--value-config <path>`).
   - Check if the user asked to see the changes report (e.g. `--report`).
2. Run the classify command:
   - Build the CLI command: `npm run classify` (or `npx tsx src/index.ts classify`).
   - Append flags based on user input, e.g. `--value-config <path>` or `--report`.
   - Run the command.
3. Parse the output:
   - The command outputs a JSON breakdown of the run.
4. Format the response:
   - Summarize the classification statistics:
     - Total users processed.
     - Number of users whose tiers changed.
     - Distribution counts for each tier (Low, Medium, High, Extreme).
     - Number of users missing team assignments.
   - If `--report` was specified, display the detailed list of changes.
