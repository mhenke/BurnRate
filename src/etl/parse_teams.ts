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

function hasAggregateMetrics(teamRow: Record<string, unknown>): boolean {
  return teamRow.credits_used !== undefined || teamRow.active_users !== undefined || teamRow.avg_acceptance_rate !== undefined;
}

function getLogin(userRow: Record<string, unknown>): string | null {
  const login = userRow.github_login ?? userRow.login;
  return typeof login === 'string' && login.trim().length > 0 ? login : null;
}

/** Parse enterprise-user-teams-1-day report into team_usage rows. */
export function parseTeamUsage(
  report: { report_day: string; data: Array<Record<string, unknown>> },
): TeamUsageRow[] {
  if (!report || !Array.isArray(report.data)) return [];
  return report.data
    .filter((teamRow) => hasAggregateMetrics(teamRow))
    .map((teamRow: Record<string, unknown>) => {
    const team = typeof teamRow.team === 'string' && teamRow.team.trim().length > 0 ? teamRow.team : 'unknown';
    const credits = teamRow.credits_used !== undefined ? Number(teamRow.credits_used) : 0;
    const avgAcceptanceRate = teamRow.avg_acceptance_rate !== undefined ? Number(teamRow.avg_acceptance_rate) : 0;

    return {
      usageDate: report.report_day,
      team,
      credits: credits.toString(),
      activeUsers: Number(teamRow.active_users ?? 0),
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
    .map((memberRow: Record<string, unknown>) => {
      const githubLogin = getLogin(memberRow);
      const team = memberRow.team;

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
