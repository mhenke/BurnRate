export type RawReportRow = {
  report_date: string;
  report_type: string;
  source_url: string;
  payload: Record<string, unknown>;
  fetched_at?: string;
};

/**
 * Stamp a raw report record with the current UTC fetch time.
 * Always call this before persisting to `raw_reports` so the ingestion
 * timestamp is set server-side rather than relying on database defaults.
 *
 * @param input Report fields without `fetched_at`.
 * @returns A new object with `fetched_at` set to the current ISO-8601 timestamp.
 */
export function normalizeRawReport(input: Omit<RawReportRow, 'fetched_at'>): RawReportRow {
  return { ...input, fetched_at: new Date().toISOString() };
}
