---
name: etl
description: Ingest daily Copilot metrics reports and seat allocation details from GitHub API, preserving raw payloads before aggregation.
---

# Instructions

You are a Copilot Agent Skill for BurnRate. Use this skill when the user asks on-demand to fetch new Copilot usage reports, backfill historical data, or trigger the data ingestion pipeline.

## Workflow

1. Run the ETL ingestion command:
   - Execute the shell command `npm run etl` (which runs `npx tsx src/index.ts etl`).
2. Parse the command output:
   - The command outputs a completion statement containing the count of raw reports stored and usage records upserted.
3. Format the response:
   - Summarize the pipeline status:
     - Number of raw JSON reports stored (for schema drift preservation).
     - Number of daily/team usage records parsed and upserted.
     - Highlight any critical warnings or connection issues that prevented complete ingestion.
