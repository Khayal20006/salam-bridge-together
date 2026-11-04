export const FRAME_MS = 1000 / 60;

/**
 * Schedule the next 60 Hz paint from a 60/90/120/144/165/240 Hz display.
 * Returns null when this animation frame should be skipped; otherwise the
 * timestamp of the following paint. Using an accumulator avoids the ~48 fps
 * trap of testing a single raw interval on 144 Hz panels.
 */
export function nextPaintTime(now: number, scheduled: number): number | null {
  if (now + 0.5 < scheduled) return null;
  const base = now - scheduled > FRAME_MS * 2 ? now : scheduled;
  return base + FRAME_MS;
}
