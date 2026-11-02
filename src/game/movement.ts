import type { Point } from "./engine.ts";

export const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

export const interpolateAngle = (from: number, to: number, alpha: number) =>
  from + angleDelta(from, to) * alpha;

/** Sample the travelled head path by distance, so every bend travels all the way to the tail. */
export class BodyTrail {
  private points: Point[];

  constructor(body: Point[]) {
    this.points = body.map((p) => ({ ...p }));
  }

  advance(head: Point, count: number, spacing: number): Point[] {
    const first = this.points[0];
    if (!first || Math.hypot(head.x - first.x, head.y - first.y) > 0.000001) {
      this.points.unshift({ ...head });
    }
    const body: Point[] = [{ ...head }];
    let travelled = 0,
      nextSample = spacing;
    const keepDistance = (count + 2) * spacing;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1]!,
        b = this.points[i]!;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      if (length < 0.000001) continue;
      while (body.length < count && nextSample <= travelled + length + 0.000001) {
        const t = Math.max(0, Math.min(1, (nextSample - travelled) / length));
        body.push({ x: a.x + dx * t, y: a.y + dy * t });
        nextSample += spacing;
      }
      travelled += length;
      if (travelled >= keepDistance) {
        this.points.length = i + 1;
        break;
      }
    }
    // Growth extends as more real path is travelled; it never creates a stack of stationary joints.
    return body;
  }
}

/** Ease angular velocity so steering changes travel through a bend instead of forming a hinge. */
export function smoothTurn(
  angle: number,
  target: number,
  velocity: number,
  maxRate: number,
  dt: number,
) {
  const remaining = angleDelta(angle, target);
  const desired = Math.max(-maxRate, Math.min(maxRate, remaining * 14));
  const nextVelocity = velocity + (desired - velocity) * (1 - Math.exp(-dt / 0.065));
  const step = nextVelocity * dt;
  if (Math.sign(step) === Math.sign(remaining) && Math.abs(step) >= Math.abs(remaining)) {
    return { angle: angle + remaining, velocity: 0 };
  }
  return { angle: angle + step, velocity: nextVelocity };
}

type CurvePen = Pick<CanvasRenderingContext2D, "moveTo" | "lineTo" | "quadraticCurveTo">;

/** Full bodies and skin sections share the same continuous curve at every section boundary. */
export function traceBodyCurve(
  pen: CurvePen,
  points: Point[],
  start = 0,
  end = points.length - 1,
): void {
  if (!points.length || start > end) return;
  const first = points[start]!,
    before = points[Math.max(0, start - 1)]!;
  pen.moveTo((before.x + first.x) / 2, (before.y + first.y) / 2);
  for (let i = start; i <= end; i++) {
    const p = points[i]!,
      next = points[Math.min(points.length - 1, i + 1)]!;
    pen.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
}
