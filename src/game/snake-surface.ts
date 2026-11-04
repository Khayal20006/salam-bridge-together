import type { Point } from "./engine";
import type { Skin } from "../lib/skins";
import { traceBodyCurve, traceBodyRange } from "./movement";

// Precomputed color strings: no string allocation per frame for hue/animated skins.
const HUE_DARK = Array.from({ length: 360 }, (_, h) => `hsl(${h},90%,42%)`);
const HUE_LIGHT = Array.from({ length: 360 }, (_, h) => `hsl(${h},90%,64%)`);
const RGB = Array.from({ length: 360 }, (_, h) => `hsl(${h},100%,62%)`);
const hueIndex = (h: number) => (((h | 0) % 360) + 360) % 360;

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
    plain = low,
    long = points.length > 320;
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
    ctx.strokeStyle = HUE_DARK[hueIndex(hue)]!;
    ctx.lineWidth = radius * 2;
    ctx.stroke();
    ctx.strokeStyle = HUE_LIGHT[hueIndex(hue)]!;
    ctx.lineWidth = radius;
    ctx.stroke();
  } else if (skin.type === "bands" || skin.type === "pulse") {
    // Fixed number of full-path strokes: cost does not grow with extra pieces.
    const beat = skin.type === "pulse" && !plain ? 0.08 * Math.sin(now / 260) : 0;
    for (let i = 0; i < colors.length; i++) {
      ctx.strokeStyle = colors[i]!;
      ctx.lineWidth = radius * 2 * Math.max(0.12, 1 - i / colors.length + (i ? beat : 0));
      ctx.stroke();
    }
  } else {
    // A solid undercoat removes dark seams. Butt ends meet on exactly the same curve.
    ctx.strokeStyle = first;
    ctx.lineWidth = radius * 2;
    ctx.stroke();
    if (!plain) {
      // Long snakes get wider stripes so fewer sub-paths are traced.
      const stride = (long ? 8 : 4) * divisions,
        period = stride * colors.length;
      const shift = skin.type === "stripes" ? 0 : ((now / 90) * divisions) % period;
      const color = (j: number) =>
        skin.type === "anim"
          ? RGB[hueIndex(now / 12 + (j * 360) / colors.length)]!
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
  if (!plain && !long) {
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
