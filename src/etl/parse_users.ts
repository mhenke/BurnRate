export type UserRow = {
  githubLogin: string;
  enterprise: string;
  org: string;
  displayName?: string | null;
  email?: string | null;
  team?: string | null;
  seatCreatedAt?: string | null;
  lastActivityAt?: string | null;
  consumptionTier?: string | null;
  valueTier?: string | null;
};

/** Parse enterprise-1-day report into user rows (status/activity snapshot). */
export function parseEnterpriseReportToUsers(
  enterprise: string,
  org: string,
  report: { report_day: string; data: Array<{ github_login: string } & Record<string, unknown>> },
): UserRow[] {
  if (!report || !Array.isArray(report.data)) return [];
  return report.data.map((entry: any) => ({
    githubLogin: entry.github_login,
    enterprise,
    org,
    displayName: entry.display_name ?? null,
    email: entry.email ?? null,
    team: entry.team ?? null,
    seatCreatedAt: entry.seat_created_at ?? null,
    lastActivityAt: entry.last_activity_at ?? null,
    consumptionTier: entry.consumption_tier ?? null,
    valueTier: entry.value_tier ?? null,
  }));
}
