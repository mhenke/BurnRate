export type TeamUsageRow = {
  usageDate: string;
  team: string;
  credits: string;
  activeUsers: number;
  avgAcceptanceRate: string;
};

/** Parse enterprise-user-teams-1-day report into team_usage rows. */
export function parseTeamUsage(
  report: { report_day: string; data: Array<Record<string, unknown>> },
): TeamUsageRow[] {
  if (!report || !Array.isArray(report.data)) return [];
  return report.data.map((entry: any) => {
    const credits = entry.credits_used !== undefined ? Number(entry.credits_used) : 0;
    const avgAcceptanceRate = entry.avg_acceptance_rate !== undefined ? Number(entry.avg_acceptance_rate) : 0;
    
    return {
      usageDate: report.report_day,
      team: entry.team ?? 'unknown',
      credits: credits.toString(),
      activeUsers: Number(entry.active_users ?? 0),
      avgAcceptanceRate: avgAcceptanceRate.toFixed(4),
    };
  });
}
