import type { GitHubClient, CopilotSeat } from './types.js';

export async function fetchAllSeats(
  client: GitHubClient,
): Promise<CopilotSeat[]> {
  const seats: CopilotSeat[] = [];
  for await (const response of client.octokit.paginate.iterator(
    client.octokit.rest.enterpriseAdmin.listCopilotSeatsForEnterprise as any,
    { enterprise: client.enterprise, per_page: 100 },
  )) {
    const data = response.data as { seats?: CopilotSeat[] };
    for (const seat of data.seats ?? []) {
      seats.push(seat);
    }
  }
  return seats;
}
