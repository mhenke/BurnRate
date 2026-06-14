import type { DbClient } from '../db/client.js';
import type { GitHubClient } from '../github/client.js';
import { normalizeRawReport } from './raw_storage.js';
import { parseEnterpriseReportToUsers } from './parse_users.js';
import { parseDailyUsage } from './parse_enterprise.js';
import { parseTeamMembers, parseTeamUsage } from './parse_teams.js';
import { parseSeatsToUsers } from './parse_seats.js';
import { fetchAllSeats } from '../github/seats.js';
import { fetchReport } from '../github/reports.js';
import { sql } from 'drizzle-orm';
import { withRetry } from '../budget/retry.js';
import { runner, dialectTable, dialectNow } from '../db/adapter.js';
import {
  rawReportsPg, rawReportsSq,
  usersPg, usersSq,
  dailyUsagePg, dailyUsageSq,
  teamUsagePg, teamUsageSq,
} from '../db/schema.js';

export type PipelineResult = {
  rawStored: number;
  usageUpserted: number;
  errors: string[];
};

type PipelineCtx = {
  gh: GitHubClient;
  db: DbClient;
  r: ReturnType<typeof runner>;
  day: string;
  result: PipelineResult;
  now: ReturnType<typeof dialectNow>;
};

async function storeRawReport(ctx: PipelineCtx, reportType: string, sourceUrl: string, payload: unknown): Promise<void> {
  const rawRow = normalizeRawReport({
    report_type: reportType,
    report_date: ctx.day,
    source_url: sourceUrl,
    payload: payload as Record<string, unknown>,
  });

  const t = dialectTable(ctx.db, rawReportsPg, rawReportsSq);
  await ctx.r.insert(t)
    .values({
      reportType: rawRow.report_type,
      reportDay: rawRow.report_date,
      sourceUrl: rawRow.source_url,
      payload: rawRow.payload,
    })
    .onConflictDoNothing();
  ctx.result.rawStored++;
}

async function upsertUsers(ctx: PipelineCtx, userRows: Array<{
  githubLogin: string; enterprise: string; org: string;
  displayName?: string | null; email?: string | null; team?: string | null;
  seatCreatedAt?: string | null; lastActivityAt?: string | null;
  consumptionTier?: string | null; valueTier?: string | null;
}>) {
  if (userRows.length === 0) return;
  const t = dialectTable(ctx.db, usersPg, usersSq);
  await ctx.r.insert(t).values(userRows)
    .onConflictDoUpdate({
      target: t.githubLogin,
      set: {
        enterprise: sql`excluded.enterprise`,
        org: sql`excluded.org`,
        displayName: sql`excluded.display_name`,
        email: sql`excluded.email`,
        team: sql`excluded.team`,
        seatCreatedAt: sql`excluded.seat_created_at`,
        lastActivityAt: sql`excluded.last_activity_at`,
        consumptionTier: sql`excluded.consumption_tier`,
        valueTier: sql`excluded.value_tier`,
        updatedAt: ctx.now,
      }
    });
}

async function upsertSeatUsers(ctx: PipelineCtx, seatRows: Array<{
  githubLogin: string; enterprise: string; org: string;
  seatCreatedAt?: string | null; lastActivityAt?: string | null;
}>) {
  if (seatRows.length === 0) return;
  const t = dialectTable(ctx.db, usersPg, usersSq);
  await ctx.r.insert(t).values(seatRows)
    .onConflictDoUpdate({
      target: t.githubLogin,
      set: {
        enterprise: sql`excluded.enterprise`,
        org: sql`excluded.org`,
        seatCreatedAt: sql`excluded.seat_created_at`,
        lastActivityAt: sql`excluded.last_activity_at`,
        updatedAt: ctx.now,
      }
    });
}

async function upsertDailyUsageRows(ctx: PipelineCtx, usageRows: Array<{
  usageDate: string; githubLogin: string; credits: string;
  tokensInput: number; tokensOutput: number; chatRequests: number;
  agentRequests: number; acceptedLines: number; suggestedLines: number;
  acceptanceRate: string; creditsPerAccLoc: string;
  modelBreakdown: Record<string, unknown>; ideBreakdown: Record<string, unknown>;
  languageBreakdown: Record<string, unknown>;
}>) {
  if (usageRows.length === 0) return;
  const t = dialectTable(ctx.db, dailyUsagePg, dailyUsageSq);
  await ctx.r.insert(t).values(usageRows)
    .onConflictDoUpdate({
      target: [t.usageDate, t.githubLogin],
      set: {
        credits: sql`excluded.credits`,
        tokensInput: sql`excluded.tokens_input`,
        tokensOutput: sql`excluded.tokens_output`,
        chatRequests: sql`excluded.chat_requests`,
        agentRequests: sql`excluded.agent_requests`,
        acceptedLines: sql`excluded.accepted_lines`,
        suggestedLines: sql`excluded.suggested_lines`,
        acceptanceRate: sql`excluded.acceptance_rate`,
        creditsPerAccLoc: sql`excluded.credits_per_acc_loc`,
        modelBreakdown: sql`excluded.model_breakdown`,
        ideBreakdown: sql`excluded.ide_breakdown`,
        languageBreakdown: sql`excluded.language_breakdown`,
      }
    });
}

async function upsertTeamUsageRows(ctx: PipelineCtx, teamRows: Array<{
  usageDate: string; team: string; credits: string;
  activeUsers: number; avgAcceptanceRate: string;
}>) {
  if (teamRows.length === 0) return;
  const t = dialectTable(ctx.db, teamUsagePg, teamUsageSq);
  await ctx.r.insert(t).values(teamRows)
    .onConflictDoUpdate({
      target: [t.usageDate, t.team],
      set: {
        credits: sql`excluded.credits`,
        activeUsers: sql`excluded.active_users`,
        avgAcceptanceRate: sql`excluded.avg_acceptance_rate`,
      }
    });
}

async function upsertTeamMemberUsers(ctx: PipelineCtx, memberRows: Array<{ githubLogin: string; team: string }>) {
  if (memberRows.length === 0) return;
  const t = dialectTable(ctx.db, usersPg, usersSq);
  await ctx.r.insert(t)
    .values(memberRows.map((row) => ({
      githubLogin: row.githubLogin,
      enterprise: ctx.gh.enterprise,
      org: ctx.gh.org,
      team: row.team,
      updatedAt: ctx.now,
    })))
    .onConflictDoUpdate({
      target: t.githubLogin,
      set: { team: sql`excluded.team`, updatedAt: ctx.now }
    });
}

async function processReportPayload(ctx: PipelineCtx, reportType: string, payload: unknown): Promise<number> {
  let usageUpserted = 0;

  if (reportType === 'enterprise-1-day') {
    const userRows = parseEnterpriseReportToUsers(ctx.gh.enterprise, ctx.gh.org, payload as any);
    await upsertUsers(ctx, userRows);
  } else if (reportType === 'users-1-day') {
    const usageRows = parseDailyUsage(payload as any);
    if (usageRows.length > 0) {
      await upsertDailyUsageRows(ctx, usageRows);
      usageUpserted = usageRows.length;
    }
  } else if (reportType === 'enterprise-user-teams-1-day') {
    const teamRows = parseTeamUsage(payload as any);
    await upsertTeamUsageRows(ctx, teamRows);
    const teamMemberRows = parseTeamMembers(payload as any);
    await upsertTeamMemberUsers(ctx, teamMemberRows);
  }

  return usageUpserted;
}

/**
 * Phase 1 observe-only pipeline:
 * 1. Fetch reports from GitHub API
 * 2. Download raw payloads via signed URLs
 * 3. Store raw payloads in raw_reports
 * 4. Parse into normalized tables
 * 5. Upsert into daily_usage, team_usage, and users
 */
export async function runObserveOnlyPipeline(
  gh: GitHubClient,
  db: DbClient,
  day: string,
): Promise<PipelineResult> {
  const ctx: PipelineCtx = {
    gh,
    db,
    r: runner(db),
    day,
    result: { rawStored: 0, usageUpserted: 0, errors: [] },
    now: dialectNow(db),
  };

  // 1. Process standard 1-day reports
  const reportTypes = ['users-1-day', 'enterprise-1-day', 'enterprise-user-teams-1-day'] as const;
  let totalFetchAttempts = 0;
  let totalFetchFailures = 0;

  for (const reportType of reportTypes) {
    const reportData = await fetchReport(gh, reportType, day).catch((err) => {
      const errorMsg = `Failed to fetch report ${reportType}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(errorMsg);
      ctx.result.errors.push(errorMsg);
      totalFetchFailures++;
      return null;
    });

    totalFetchAttempts++;

    if (!reportData || !Array.isArray(reportData.download_links)) continue;

    for (const link of reportData.download_links) {
      const reportPayload = await withRetry(() => gh.fetchSignedUrl<any>(link), {
        onRetry: (attempt, err) => {
          console.warn(`Retry ${attempt} for ${link}: ${err.message}`);
        },
      }).catch((err) => {
        const errorMsg = `Failed to download report payload from ${link}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(errorMsg);
        ctx.result.errors.push(errorMsg);
        return null;
      });

      if (!reportPayload) continue;

      await storeRawReport(ctx, reportType, link, reportPayload);
      ctx.result.usageUpserted += await processReportPayload(ctx, reportType, reportPayload);
    }
  }

  // 2. Process active seat allocations
  const seats = await fetchAllSeats(gh).catch((err) => {
    const errorMsg = `Failed to fetch seats: ${err instanceof Error ? err.message : String(err)}`;
    console.error(errorMsg);
    ctx.result.errors.push(errorMsg);
    return null;
  });

  if (totalFetchAttempts > 0 && totalFetchFailures === totalFetchAttempts && !seats) {
    ctx.result.errors.unshift('CRITICAL: All report fetches failed. Check GitHub API connectivity and credentials.');
  }

  if (seats) {
    await storeRawReport(ctx, 'seats', `https://api.github.com/enterprises/${gh.enterprise}/billing/seats`, { seats });
    const seatUserRows = parseSeatsToUsers(gh.enterprise, gh.org, seats);
    await upsertSeatUsers(ctx, seatUserRows);
  }

  return ctx.result;
}
