export type DailyUsageRow = {
  usageDate: string;
  githubLogin: string;
  credits: string;
  tokensInput: bigint;
  tokensOutput: bigint;
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
  return report.data.map((entry: any) => {
    const credits = Number(entry.credits_used ?? 0);
    const acceptedLines = Number(entry.accepted_lines ?? 0);
    const suggestedLines = Number(entry.suggested_lines ?? 0);

    const acceptanceRate = suggestedLines > 0 ? (acceptedLines / suggestedLines).toFixed(4) : '0.0000';
    const creditsPerAccLoc = acceptedLines > 0 ? (credits / acceptedLines).toFixed(4) : '0.0000';

    return {
      usageDate: report.report_day,
      githubLogin: entry.github_login ?? '',
      credits: credits.toString(),
      tokensInput: BigInt(entry.tokens_input ?? 0),
      tokensOutput: BigInt(entry.tokens_output ?? 0),
      chatRequests: Number(entry.chat_requests ?? 0),
      agentRequests: Number(entry.agent_requests ?? 0),
      acceptedLines,
      suggestedLines,
      acceptanceRate,
      creditsPerAccLoc,
      modelBreakdown: entry.model_breakdown ?? {},
      ideBreakdown: entry.ide_breakdown ?? {},
      languageBreakdown: entry.language_breakdown ?? {},
    };
  });
}
