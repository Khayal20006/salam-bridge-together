import type { Point } from "./engine.ts";

export const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

export const interpolateAngle = (from: number, to: number, alpha: number) =>
  from + angleDelta(from, to) * alpha;

/** Dense visual spine; authority/collision points and packet sizes stay unchanged. */
export function smoothSpine(
  points: Point[],
  output: Point[],
  divisions = 4,
  headAngle?: number,
): Point[] {
  if (points.length < 2) {
    output.length = 0;
    return output;
  }
  let count = 0;
  const write = (x: number, y: number) => {
    const p = output[count] ?? (output[count] = { x: 0, y: 0 });
    p.x = x;
    p.y = y;
    count++;
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)]!,
      b = points[i]!,
      c = points[i + 1]!,
      d = points[Math.min(points.length - 1, i + 2)]!;
    const samples = i === 0 && headAngle !== undefined ? Math.max(8, divisions) : divisions;
    for (let step = 0; step < samples; step++) {
      const t = step / samples,
        t2 = t * t,
        t3 = t2 * t;
      const aa = (-t3 + 2 * t2 - t) * 0.5,
        bb = (3 * t3 - 5 * t2 + 2) * 0.5,
        cc = (-3 * t3 + 4 * t2 + t) * 0.5,
        dd = (t3 - t2) * 0.5;
      if (i === 0 && headAngle !== undefined) {
        const distance = Math.hypot(c.x - b.x, c.y - b.y);
        const h00 = 2 * t3 - 3 * t2 + 1,
          h10 = t3 - 2 * t2 + t,
          h01 = -2 * t3 + 3 * t2,
          h11 = t3 - t2;
        write(
          h00 * b.x - h10 * Math.cos(headAngle) * distance + h01 * c.x + h11 * (d.x - b.x) * 0.5,
          h00 * b.y - h10 * Math.sin(headAngle) * distance + h01 * c.y + h11 * (d.y - b.y) * 0.5,
        );
      } else
        write(a.x * aa + b.x * bb + c.x * cc + d.x * dd, a.y * aa + b.y * bb + c.y * cc + d.y * dd);
    }
  }
  const tail = points.at(-1)!;
  write(tail.x, tail.y);
  output.length = count;
  return output;
}

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
  traceBodyRange(pen, points, start, end + 1);
}

/** Fractional curve ranges keep flowing colors continuous between frames and at seams. */
export function traceBodyRange(pen: CurvePen, points: Point[], start: number, end: number): void {
  start = Math.max(0, start);
  end = Math.min(points.length, end);
  if (start >= end) return;
  const first = Math.floor(start),
    last = Math.ceil(end);
  for (let i = first; i < last; i++) {
    const p = points[i]!,
      before = points[Math.max(0, i - 1)]!,
      next = points[Math.min(points.length - 1, i + 1)]!;
    const ax = (before.x + p.x) / 2,
      ay = (before.y + p.y) / 2;
    const cx = (p.x + next.x) / 2,
      cy = (p.y + next.y) / 2;
    const t0 = Math.max(0, start - i),
      t1 = Math.min(1, end - i);
    if (t0 === 0 && t1 === 1) {
      if (i === first) pen.moveTo(ax, ay);
      pen.quadraticCurveTo(p.x, p.y, cx, cy);
      continue;
    }
    const u0 = 1 - t0,
      u1 = 1 - t1;
    const x0 = u0 * u0 * ax + 2 * u0 * t0 * p.x + t0 * t0 * cx;
    const y0 = u0 * u0 * ay + 2 * u0 * t0 * p.y + t0 * t0 * cy;
    if (i === first) pen.moveTo(x0, y0);
    const span = t1 - t0;
    pen.quadraticCurveTo(
      x0 + span * (u0 * (p.x - ax) + t0 * (cx - p.x)),
      y0 + span * (u0 * (p.y - ay) + t0 * (cy - p.y)),
      u1 * u1 * ax + 2 * u1 * t1 * p.x + t1 * t1 * cx,
      u1 * u1 * ay + 2 * u1 * t1 * p.y + t1 * t1 * cy,
    );
  }
}
