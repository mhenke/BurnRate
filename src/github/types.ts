export type CopilotReportResponse = {
  report_day: string;
  download_links: string[];
};

export type CopilotSeat = {
  assignee: { login: string };
  last_activity_at: string | null;
  last_activity_editor: string | null;
  created_at: string;
  plan_type: string;
};
