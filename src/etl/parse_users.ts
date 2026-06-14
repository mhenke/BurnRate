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
  return report.data.map((userRow: any) => ({
    githubLogin: userRow.github_login,
    enterprise,
    org,
    displayName: userRow.display_name ?? null,
    email: userRow.email ?? null,
    team: userRow.team ?? null,
    seatCreatedAt: userRow.seat_created_at ?? null,
    lastActivityAt: userRow.last_activity_at ?? null,
    consumptionTier: userRow.consumption_tier ?? null,
    valueTier: userRow.value_tier ?? null,
  }));
}
