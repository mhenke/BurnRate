export type RawReportRow = {
  report_date: string;
  report_type: string;
  source_url: string;
  payload: Record<string, unknown>;
  fetched_at?: string;
};

export function normalizeRawReport(input: Omit<RawReportRow, 'fetched_at'>): RawReportRow {
  return { ...input, fetched_at: new Date().toISOString() };
}
