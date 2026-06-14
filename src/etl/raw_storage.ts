export type RawReportRow = {
  report_date: string;
  report_type: string;
  source_url: string;
  payload: Record<string, unknown>;
  fetched_at?: string;
};

/**
 * Normalize a raw report payload into a standard row format with timestamp.
 */
export function normalizeRawReport(input: Omit<RawReportRow, 'fetched_at'>): RawReportRow {
  return { ...input, fetched_at: new Date().toISOString() };
}
