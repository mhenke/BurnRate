export type ReportType =
  | 'enterprise-1-day'
  | 'enterprise-28-day'
  | 'users-1-day'
  | 'users-28-day'
  | 'enterprise-user-teams-1-day';

export function buildReportUrls(
  enterprise: string,
  reportType: ReportType,
  day?: string
): string[] {
  const base = `/enterprises/${enterprise}/copilot/metrics/reports/${reportType}`;
  if (reportType.endsWith('-1-day')) {
    if (!day) throw new Error('day is required for 1-day report types');
    return [`${base}?day=${day}`];
  }
  // 28-day reports have no suffix or query params
  return [base];
}

export async function fetchReport(
  client: { octokit: any; enterprise: string; fetchSignedUrl: <T>(url: string) => Promise<T> },
  reportType: ReportType,
  day: string
): Promise<{ download_links: string[]; report_day: string }> {
  const urls = buildReportUrls(client.enterprise, reportType, day);
  const response = await client.octokit.request(`GET ${urls[0]}`);
  return response.data as { download_links: string[]; report_day: string };
}
