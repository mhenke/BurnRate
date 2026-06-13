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
import {
  rawReportsPg,
  rawReportsSq,
  usersPg,
  usersSq,
  dailyUsagePg,
  dailyUsageSq,
  teamUsagePg,
  teamUsageSq
} from '../db/schema.js';

export type PipelineResult = {
  rawStored: number;
  usageUpserted: number;
};

/**
 * Phase 1 observe-only pipeline:
 * 1. Fetch reports from GitHub API -> signed URL
 * 2. Download raw payload
 * 3. Store raw payload in raw_reports
 * 4. Parse into normalized tables
 * 5. Upsert into daily_usage, team_usage, and users
 */
function getTables(isSqlite: boolean) {
  if (isSqlite) {
    return {
      rawReports: rawReportsSq,
      users: usersSq,
      dailyUsage: dailyUsageSq,
      teamUsage: teamUsageSq,
      now: sql`CURRENT_TIMESTAMP`,
    };
  }
  return {
    rawReports: rawReportsPg,
    users: usersPg,
    dailyUsage: dailyUsagePg,
    teamUsage: teamUsagePg,
    now: sql`now()`,
  };
}

export async function runObserveOnlyPipeline(
  gh: GitHubClient,
  db: DbClient,
  day: string,
): Promise<PipelineResult> {
  const result: PipelineResult = { rawStored: 0, usageUpserted: 0 };
  const isSqlite = typeof db.run === 'function';
  const T = getTables(isSqlite);

  // 1. Process standard 1-day reports
  const reportTypes = ['users-1-day', 'enterprise-1-day', 'enterprise-user-teams-1-day'] as const;

  for (const reportType of reportTypes) {
    const reportData = await fetchReport(gh, reportType, day).catch((err) => {
      console.error(`Failed to fetch report ${reportType}:`, err);
      return null;
    });

    if (!reportData || !Array.isArray(reportData.download_links)) {
      continue;
    }

    for (const link of reportData.download_links) {
      const rawPayload = await gh.fetchSignedUrl<any>(link).catch((err) => {
        console.error(`Failed to download report payload from ${link}:`, err);
        return null;
      });

      if (!rawPayload) continue;

      // Store raw report
      const rawRow = normalizeRawReport({
        report_type: reportType,
        report_date: day,
        source_url: link,
        payload: rawPayload,
      });

      await db.insert(T.rawReports)
        .values({
          reportType: rawRow.report_type,
          reportDay: rawRow.report_date,
          sourceUrl: rawRow.source_url,
          payload: rawRow.payload,
        })
        .onConflictDoNothing();
      result.rawStored++;

      // Parse and upsert based on report type
      if (reportType === 'enterprise-1-day') {
        const userRows = parseEnterpriseReportToUsers(gh.enterprise, gh.org, rawPayload);
        if (userRows.length > 0) {
          await db.insert(T.users)
            .values(userRows)
            .onConflictDoUpdate({
              target: T.users.githubLogin,
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
                updatedAt: T.now,
              }
            });
        }
      } else if (reportType === 'users-1-day') {
        const usageRows = parseDailyUsage(rawPayload);
        if (usageRows.length > 0) {
          await db.insert(T.dailyUsage)
            .values(usageRows)
            .onConflictDoUpdate({
              target: [T.dailyUsage.usageDate, T.dailyUsage.githubLogin],
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
          result.usageUpserted += usageRows.length;
        }
      } else if (reportType === 'enterprise-user-teams-1-day') {
        const teamRows = parseTeamUsage(rawPayload);
        if (teamRows.length > 0) {
          await db.insert(T.teamUsage)
            .values(teamRows)
            .onConflictDoUpdate({
              target: [T.teamUsage.usageDate, T.teamUsage.team],
              set: {
                credits: sql`excluded.credits`,
                activeUsers: sql`excluded.active_users`,
                avgAcceptanceRate: sql`excluded.avg_acceptance_rate`,
              }
            });
        }

        const teamMemberRows = parseTeamMembers(rawPayload);
        if (teamMemberRows.length > 0) {
          await db.insert(T.users)
            .values(teamMemberRows.map((row) => ({
              githubLogin: row.githubLogin,
              enterprise: gh.enterprise,
              org: gh.org,
              team: row.team,
              updatedAt: T.now,
            })))
            .onConflictDoUpdate({
              target: T.users.githubLogin,
              set: {
                team: sql`excluded.team`,
                updatedAt: T.now,
              }
            });
        }
      }
    }
  }

  // 2. Process active seat allocations
  const seats = await fetchAllSeats(gh).catch((err) => {
    console.error('Failed to fetch seats:', err);
    return null;
  });

  if (seats) {
    const seatsRow = normalizeRawReport({
      report_type: 'seats',
      report_date: day,
      source_url: `https://api.github.com/enterprises/${gh.enterprise}/billing/seats`,
      payload: { seats }
    });

    await db.insert(T.rawReports)
      .values({
        reportType: seatsRow.report_type,
        reportDay: seatsRow.report_date,
        sourceUrl: seatsRow.source_url,
        payload: seatsRow.payload,
      })
      .onConflictDoNothing();
    result.rawStored++;

    const seatUserRows = parseSeatsToUsers(gh.enterprise, gh.org, seats);
    if (seatUserRows.length > 0) {
      await db.insert(T.users)
        .values(seatUserRows)
        .onConflictDoUpdate({
          target: T.users.githubLogin,
          set: {
            enterprise: sql`excluded.enterprise`,
            org: sql`excluded.org`,
            seatCreatedAt: sql`excluded.seat_created_at`,
            lastActivityAt: sql`excluded.last_activity_at`,
            updatedAt: T.now,
          }
        });
    }
  }

  return result;
}
