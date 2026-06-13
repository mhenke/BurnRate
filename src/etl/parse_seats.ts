import type { CopilotSeat } from '../github/types.js';

export type SeatUserRow = {
  githubLogin: string;
  enterprise: string;
  org: string;
  seatCreatedAt: string | null;
  lastActivityAt: string | null;
};

/** Parse seat list into user upsert columns. */
export function parseSeatsToUsers(
  enterprise: string,
  org: string,
  seats: CopilotSeat[],
): SeatUserRow[] {
  if (!Array.isArray(seats)) return [];
  return seats.map((seat) => ({
    githubLogin: seat.assignee.login,
    enterprise,
    org,
    seatCreatedAt: seat.created_at ?? null,
    lastActivityAt: seat.last_activity_at ?? null,
  }));
}
