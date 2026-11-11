/** Stable floor seats. The X values sit on the official sideview template's tile row, x=-7..7. */

export const FLOOR_Y = 0;

export interface Seat {
  homeX: number;
  deskX: number;
  meetingX: number;
  approachOffset: number;
}

const NAMED: Record<string, Seat> = {
  ses_foreman: { homeX: -6.5, deskX: -5, meetingX: -1, approachOffset: -1.2 },
  ses_worker: { homeX: 6.5, deskX: -3, meetingX: 1, approachOffset: 1.2 },
};

export function seatFor(sessionId: string, index = 0): Seat {
  const named = NAMED[sessionId];
  if (named) return named;
  const column = index + 2;
  return {
    homeX: -6.5 + column,
    deskX: -5 + column,
    meetingX: -1 + column * 0.6,
    approachOffset: column % 2 === 0 ? -1.2 : 1.2,
  };
}
