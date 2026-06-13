export type TeamUsageRow = {
  usageDate: string;
  team: string;
  credits: string;
  activeUsers: number;
  avgAcceptanceRate: string;
};

export type TeamMemberRow = {
  githubLogin: string;
  team: string;
};

function hasAggregateMetrics(entry: Record<string, unknown>): boolean {
  return entry.credits_used !== undefined || entry.active_users !== undefined || entry.avg_acceptance_rate !== undefined;
}

function getLogin(entry: Record<string, unknown>): string | null {
  const login = entry.github_login ?? entry.login;
  return typeof login === 'string' && login.trim().length > 0 ? login : null;
}

/** Parse enterprise-user-teams-1-day report into team_usage rows. */
export function parseTeamUsage(
  report: { report_day: string; data: Array<Record<string, unknown>> },
): TeamUsageRow[] {
  if (!report || !Array.isArray(report.data)) return [];
  return report.data
    .filter((entry) => hasAggregateMetrics(entry))
    .map((entry: Record<string, unknown>) => {
    const team = typeof entry.team === 'string' && entry.team.trim().length > 0 ? entry.team : 'unknown';
    const credits = entry.credits_used !== undefined ? Number(entry.credits_used) : 0;
    const avgAcceptanceRate = entry.avg_acceptance_rate !== undefined ? Number(entry.avg_acceptance_rate) : 0;

    return {
      usageDate: report.report_day,
      team,
      credits: credits.toString(),
      activeUsers: Number(entry.active_users ?? 0),
      avgAcceptanceRate: avgAcceptanceRate.toFixed(4),
    };
  });
}

/** Parse enterprise-user-teams-1-day report into per-user team mapping rows when present. */
export function parseTeamMembers(
  report: { report_day: string; data: Array<Record<string, unknown>> },
): TeamMemberRow[] {
  if (!report || !Array.isArray(report.data)) return [];

  return report.data
    .map((entry: Record<string, unknown>) => {
      const githubLogin = getLogin(entry);
      const team = entry.team;

      if (!githubLogin || typeof team !== 'string' || team.trim().length === 0) {
        return null;
      }

      return {
        githubLogin,
        team,
      } satisfies TeamMemberRow;
    })
    .filter((row): row is TeamMemberRow => row !== null);
}
