import type { Point } from "./engine";
import type { Skin } from "../lib/skins";
import { traceBodyCurve, traceBodyRange } from "./movement";

/** One continuous skin surface. Uses pooled spine points; no per-segment gradients or shadows. */
export function drawSnakeSurface(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  radius: number,
  skin: Skin,
  hue: number,
  now: number,
  low: boolean,
  divisions: number,
  boost: boolean,
): void {
  if (points.length < 2) return;
  const colors = skin.colors,
    first = colors[0]!,
    // Long snakes are the most expensive to stripe. Keep their surface cheap;
    // the outline, undercoat and one highlight still read well at gameplay zoom.
    plain = low || points.length > 320;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  traceBodyCurve(ctx, points);
  if (boost) {
    ctx.strokeStyle = `${first}44`;
    ctx.lineWidth = radius * 2 + 14;
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = radius * 2 + 4;
  ctx.stroke();
  if (skin.type === "hue") {
    ctx.strokeStyle = `hsl(${hue | 0},90%,42%)`;
    ctx.lineWidth = radius * 2;
    ctx.stroke();
    ctx.strokeStyle = `hsl(${hue | 0},90%,64%)`;
    ctx.lineWidth = radius;
    ctx.stroke();
  } else if (!plain && (skin.type === "bands" || skin.type === "pulse")) {
    for (let i = 0; i < colors.length; i++) {
      ctx.strokeStyle = colors[i]!;
      ctx.lineWidth = radius * 2 * (1 - i / colors.length);
      ctx.stroke();
    }
  } else {
    // A solid undercoat removes dark seams. Butt ends meet on exactly the same curve.
    ctx.strokeStyle = first;
    ctx.lineWidth = radius * 2;
    ctx.stroke();
    if (!plain) {
      const stride = 4 * divisions,
        period = stride * colors.length;
      const shift = skin.type === "stripes" ? 0 : ((now / 90) * divisions) % period;
      const color = (j: number) =>
        skin.type === "anim"
          ? `hsl(${(now / 12 + (j * 360) / colors.length) % 360},100%,64%)`
          : colors[j]!;
      ctx.lineCap = "butt";
      for (let j = 0; j < colors.length; j++) {
        ctx.beginPath();
        for (let i = j * stride + shift - period; i < points.length; i += period)
          traceBodyRange(ctx, points, i, i + stride);
        ctx.strokeStyle = color(j);
        ctx.stroke();
      }
      ctx.lineCap = "round";
      for (const index of [0, points.length - 1]) {
        const j =
          ((Math.floor((index - shift) / stride) % colors.length) + colors.length) % colors.length;
        const p = points[index]!;
        ctx.fillStyle = color(j);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // A few shared strokes give volume without allocating a gradient for every body piece.
  ctx.beginPath();
  traceBodyCurve(ctx, points);
  if (!plain) {
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = radius * 1.3;
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = radius * 0.42;
  ctx.stroke();
  if (!plain) {
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(0.8, radius * 0.1);
    ctx.stroke();
  }
}
