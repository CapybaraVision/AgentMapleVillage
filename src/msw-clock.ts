/**
 * MapleStory Worlds DateTime.Elapsed is documented as "an integer in milliseconds"
 * (Creator Center DateTime, postId 695, and Utilizing Date and Time, postId 691).
 * Those pages do not say the integer is Unix epoch milliseconds.
 * The examples round-trip Elapsed through DateTime(elapsed) for a calendar date.
 *
 * If Elapsed is any continuous millisecond counter, one sample against the relay
 * clock converts it: unix = elapsed + (relayUnix - elapsedAtSample).
 * This does not guess the epoch. A counter that is not milliseconds will not
 * stay inside the relay's acceptance window, and the world must stop sending it.
 */

export interface ClockSample {
  /** DateTime.UtcNow.Elapsed at the moment serverUnixMillis was observed. */
  elapsed: number;
  /** Relay clock, Unix milliseconds. */
  serverUnixMillis: number;
}

export function unixMillisFromMswElapsed(elapsed: number, sample: ClockSample): number {
  if (!Number.isFinite(elapsed) || !Number.isFinite(sample.elapsed) || !Number.isFinite(sample.serverUnixMillis)) {
    throw new Error('MSW clock values must be finite numbers');
  }
  return elapsed + (sample.serverUnixMillis - sample.elapsed);
}
