import type { Point } from "./engine.ts";

/** First contact of a moving head and moving body segment, on the same tick clock.
 * Conservative advancement uses a bound on relative endpoint speed; it cannot
 * jump over an intersection even when both snakes boost in opposite directions.
 */
export function contactTime(
  h0: Point,
  h1: Point,
  a0: Point,
  a1: Point,
  b0: Point,
  b1: Point,
  radius: number,
): number {
  const vx = h1.x - h0.x,
    vy = h1.y - h0.y;
  const avx = a1.x - a0.x - vx,
    avy = a1.y - a0.y - vy;
  const bvx = b1.x - b0.x - vx,
    bvy = b1.y - b0.y - vy;
  const speed = Math.max(Math.hypot(avx, avy), Math.hypot(bvx, bvy));
  let t = 0;
  for (let i = 0; i < 96; i++) {
    const ax = a0.x - h0.x + avx * t,
      ay = a0.y - h0.y + avy * t;
    const bx = b0.x - h0.x + bvx * t,
      by = b0.y - h0.y + bvy * t;
    const dx = bx - ax,
      dy = by - ay,
      length = dx * dx + dy * dy;
    const along = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    const gap = Math.hypot(ax + along * dx, ay + along * dy) - radius;
    if (gap <= 0.00001) return t;
    if (speed < 0.000001) return Infinity;
    t += gap / speed;
    if (t > 1) return Infinity;
  }
  return Infinity;
}
export type Contact = { time: number; victim: string; obstacle: string };
/** Resolve earlier impacts first. A snake already killed cannot kill its cutter later. */
export function resolveContacts(contacts: Contact[], dead: Set<string>): void {
  contacts.sort((a, b) => a.time - b.time);
  const simultaneous = new Set<string>();
  for (let i = 0; i < contacts.length;) {
    const time = contacts[i]!.time;
    simultaneous.clear();
    do {
      const hit = contacts[i++]!;
      if (!dead.has(hit.victim) && !dead.has(hit.obstacle)) {
        simultaneous.add(hit.victim);
      }
    } while (i < contacts.length && contacts[i]!.time - time < 0.00001);
    for (const id of simultaneous) dead.add(id);
  }
}
