export type DailyUsageRow = {
  usageDate: string;
  githubLogin: string;
  credits: string;
  tokensInput: number;
  tokensOutput: number;
  chatRequests: number;
  agentRequests: number;
  acceptedLines: number;
  suggestedLines: number;
  acceptanceRate: string;
  creditsPerAccLoc: string;
  modelBreakdown: Record<string, unknown>;
  ideBreakdown: Record<string, unknown>;
  languageBreakdown: Record<string, unknown>;
};

/** Parse users-1-day report into daily_usage rows. */
export function parseDailyUsage(
  report: { report_day: string; data: Array<Record<string, unknown>> },
): DailyUsageRow[] {
  if (!report || !Array.isArray(report.data)) return [];
  return report.data.map((usageRow: any) => {
    const credits = Number(usageRow.credits_used ?? 0);
    const acceptedLines = Number(usageRow.accepted_lines ?? 0);
    const suggestedLines = Number(usageRow.suggested_lines ?? 0);

    const acceptanceRate = suggestedLines > 0 ? (acceptedLines / suggestedLines).toFixed(4) : '0.0000';
    const creditsPerAccLoc = acceptedLines > 0 ? (credits / acceptedLines).toFixed(4) : '0.0000';

    return {
      usageDate: report.report_day,
      githubLogin: usageRow.github_login ?? '',
      credits: credits.toString(),
      tokensInput: Number(usageRow.tokens_input ?? 0),
      tokensOutput: Number(usageRow.tokens_output ?? 0),
      chatRequests: Number(usageRow.chat_requests ?? 0),
      agentRequests: Number(usageRow.agent_requests ?? 0),
      acceptedLines,
      suggestedLines,
      acceptanceRate,
      creditsPerAccLoc,
      modelBreakdown: usageRow.model_breakdown ?? {},
      ideBreakdown: usageRow.ide_breakdown ?? {},
      languageBreakdown: usageRow.language_breakdown ?? {},
    };
  });
}
