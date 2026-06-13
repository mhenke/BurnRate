import type { DbClient } from '../db/client.js';
import type { GitHubClient } from '../github/client.js';
import { normalizeRawReport } from './raw_storage.js';
import { parseEnterpriseReportToUsers } from './parse_users.js';
import { parseDailyUsage } from './parse_enterprise.js';
import { parseTeamUsage } from './parse_teams.js';
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
export async function runObserveOnlyPipeline(
  gh: GitHubClient,
  db: DbClient,
  day: string,
): Promise<PipelineResult> {
  const result: PipelineResult = { rawStored: 0, usageUpserted: 0 };
  const isSqlite = typeof db.run === 'function';

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

      if (isSqlite) {
        await db.insert(rawReportsSq)
          .values({
            reportType: rawRow.report_type,
            reportDay: rawRow.report_date,
            sourceUrl: rawRow.source_url,
            payload: rawRow.payload,
          })
          .onConflictDoNothing();
      } else {
        await db.insert(rawReportsPg)
          .values({
            reportType: rawRow.report_type,
            reportDay: rawRow.report_date,
            sourceUrl: rawRow.source_url,
            payload: rawRow.payload,
          })
          .onConflictDoNothing();
      }
      result.rawStored++;

      // Parse and upsert based on report type
      if (reportType === 'enterprise-1-day') {
        const userRows = parseEnterpriseReportToUsers(gh.enterprise, gh.org, rawPayload);
        if (userRows.length > 0) {
          if (isSqlite) {
            await db.insert(usersSq)
              .values(userRows)
              .onConflictDoUpdate({
                target: usersSq.githubLogin,
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
                  updatedAt: sql`CURRENT_TIMESTAMP`
                }
              });
          } else {
            await db.insert(usersPg)
              .values(userRows)
              .onConflictDoUpdate({
                target: usersPg.githubLogin,
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
                  updatedAt: sql`now()`
                }
              });
          }
        }
      } else if (reportType === 'users-1-day') {
        const usageRows = parseDailyUsage(rawPayload);
        if (usageRows.length > 0) {
          if (isSqlite) {
            await db.insert(dailyUsageSq)
              .values(usageRows)
              .onConflictDoUpdate({
                target: [dailyUsageSq.usageDate, dailyUsageSq.githubLogin],
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
                  languageBreakdown: sql`excluded.language_breakdown`
                }
              });
          } else {
            await db.insert(dailyUsagePg)
              .values(usageRows)
              .onConflictDoUpdate({
                target: [dailyUsagePg.usageDate, dailyUsagePg.githubLogin],
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
                  languageBreakdown: sql`excluded.language_breakdown`
                }
              });
          }
          result.usageUpserted += usageRows.length;
        }
      } else if (reportType === 'enterprise-user-teams-1-day') {
        const teamRows = parseTeamUsage(rawPayload);
        if (teamRows.length > 0) {
          if (isSqlite) {
            await db.insert(teamUsageSq)
              .values(teamRows)
              .onConflictDoUpdate({
                target: [teamUsageSq.usageDate, teamUsageSq.team],
                set: {
                  credits: sql`excluded.credits`,
                  activeUsers: sql`excluded.active_users`,
                  avgAcceptanceRate: sql`excluded.avg_acceptance_rate`
                }
              });
          } else {
            await db.insert(teamUsagePg)
              .values(teamRows)
              .onConflictDoUpdate({
                target: [teamUsagePg.usageDate, teamUsagePg.team],
                set: {
                  credits: sql`excluded.credits`,
                  activeUsers: sql`excluded.active_users`,
                  avgAcceptanceRate: sql`excluded.avg_acceptance_rate`
                }
              });
          }
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

    if (isSqlite) {
      await db.insert(rawReportsSq)
        .values({
          reportType: seatsRow.report_type,
          reportDay: seatsRow.report_date,
          sourceUrl: seatsRow.source_url,
          payload: seatsRow.payload,
        })
        .onConflictDoNothing();
    } else {
      await db.insert(rawReportsPg)
        .values({
          reportType: seatsRow.report_type,
          reportDay: seatsRow.report_date,
          sourceUrl: seatsRow.source_url,
          payload: seatsRow.payload,
        })
        .onConflictDoNothing();
    }
    result.rawStored++;

    const seatUserRows = parseSeatsToUsers(gh.enterprise, gh.org, seats);
    if (seatUserRows.length > 0) {
      if (isSqlite) {
        await db.insert(usersSq)
          .values(seatUserRows)
          .onConflictDoUpdate({
            target: usersSq.githubLogin,
            set: {
              enterprise: sql`excluded.enterprise`,
              org: sql`excluded.org`,
              seatCreatedAt: sql`excluded.seat_created_at`,
              lastActivityAt: sql`excluded.last_activity_at`,
              updatedAt: sql`CURRENT_TIMESTAMP`
            }
          });
      } else {
        await db.insert(usersPg)
          .values(seatUserRows)
          .onConflictDoUpdate({
            target: usersPg.githubLogin,
            set: {
              enterprise: sql`excluded.enterprise`,
              org: sql`excluded.org`,
              seatCreatedAt: sql`excluded.seat_created_at`,
              lastActivityAt: sql`excluded.last_activity_at`,
              updatedAt: sql`now()`
            }
          });
      }
    }
  }

  return result;
}
