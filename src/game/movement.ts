import type { Point } from "./engine.ts";

export const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

export const interpolateAngle = (from: number, to: number, alpha: number) =>
  from + angleDelta(from, to) * alpha;

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
