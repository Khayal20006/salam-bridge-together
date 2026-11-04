import { snakeWidth, type Point, type Snake } from "./engine";
import type { Skin } from "../lib/skins";

export type View = { minX: number; minY: number; maxX: number; maxY: number };

/** Keep crossing segments even when both endpoints are outside the viewport. */
export function visibleBodyRanges(points: Point[], view: View, padding: number): number[] {
  const ranges: number[] = [];
  let start = -1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const visible =
      Math.max(a.x, b.x) >= view.minX - padding &&
      Math.min(a.x, b.x) <= view.maxX + padding &&
      Math.max(a.y, b.y) >= view.minY - padding &&
      Math.min(a.y, b.y) <= view.maxY + padding;
    if (visible && start < 0) start = i - 1;
    if (!visible && start >= 0) {
      ranges.push(start, i - 1);
      start = -1;
    }
  }
  if (start >= 0) ranges.push(start, points.length - 1);
  return ranges;
}

/** Original Lovable skin strokes, restricted to the visible portions of a body. */
export function drawClassicSnake(
  ctx: CanvasRenderingContext2D,
  snake: Snake,
  skin: Skin,
  now: number,
  effects: boolean,
  view: View,
): void {
  const points = snake.pts,
    w = snakeWidth(snake),
    colors = skin.colors;
  const ranges = visibleBodyRanges(points, view, w + 18);
  if (!ranges.length) return;
  const trace = (start = 0, end = points.length - 1) => {
    for (let r = 0; r < ranges.length; r += 2) {
      const a = Math.max(start, ranges[r]!),
        b = Math.min(end, ranges[r + 1]!);
      if (b <= a) continue;
      ctx.moveTo(points[a]!.x, points[a]!.y);
      for (let i = a + 1; i <= b; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
    }
  };
  const stroke = (color: string, thickness: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.stroke();
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  trace();
  if (snake.boost && effects)
    stroke(
      skin.type === "hue" ? `hsla(${snake.hue | 0},100%,60%,0.25)` : colors[0] + "44",
      w * 2 + 16,
    );
  if (skin.type === "hue") {
    stroke(`hsl(${snake.hue | 0},90%,42%)`, w * 2);
    stroke(`hsl(${snake.hue | 0},90%,58%)`, w * 1.1);
  } else {
    stroke("rgba(0,0,0,0.5)", w * 2 + 4);
    // A continuous undercoat prevents gaps between colored pieces.
    stroke(colors[0]!, w * 2);
    if (skin.type === "bands" || skin.type === "pulse") {
      if (skin.type === "pulse" && effects) {
        ctx.globalAlpha = 0.18 + 0.14 * Math.sin(now / 220 + snake.hue);
        stroke(colors.at(-1)!, w * 2 + 10);
        ctx.globalAlpha = 1;
      }
      for (let j = 0; j < colors.length; j++) stroke(colors[j]!, w * 2 * (1 - j / colors.length));
    } else {
      const stride = 4,
        period = stride * colors.length;
      const shift =
        skin.type === "anim" || skin.type === "flow" ? Math.floor(now / 70) % period : 0;
      for (let j = 0; j < colors.length; j++) {
        ctx.beginPath();
        for (let i = j * stride + shift - period; i < points.length - 1; i += period)
          trace(Math.max(0, i), Math.min(i + stride, points.length - 1));
        stroke(
          skin.type === "anim"
            ? `hsl(${((now / 8 + (j * 360) / colors.length) % 360) | 0},100%,60%)`
            : colors[j]!,
          w * 2,
        );
      }
    }
    ctx.beginPath();
    trace();
    stroke("rgba(255,255,255,0.22)", w * 0.45);
  }
}
