export type ReportType =
  | 'enterprise-1-day'
  | 'enterprise-28-day'
  | 'users-1-day'
  | 'users-28-day'
  | 'enterprise-user-teams-1-day';

/**
 * Build the GitHub API URL for a Copilot usage report by type and date.
 */
export function buildReportUrl(
  enterprise: string,
  reportType: ReportType,
  day?: string
): string {
  const base = `/enterprises/${enterprise}/copilot/metrics/reports/${reportType}`;
  if (reportType.endsWith('-1-day')) {
    if (!day) throw new Error('day is required for 1-day report types');
    return `${base}?day=${day}`;
  }
  return base;
}

/**
 * Fetch a Copilot usage report from the GitHub API and return its data.
 */
export async function fetchReport(
  client: { octokit: any; enterprise: string; fetchSignedUrl: <T>(url: string) => Promise<T> },
  reportType: ReportType,
  day: string
): Promise<{ download_links: string[]; report_day: string }> {
  const url = buildReportUrl(client.enterprise, reportType, day);
  const response = await client.octokit.request(`GET ${url}`);
  return response.data as { download_links: string[]; report_day: string };
}
