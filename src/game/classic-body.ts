import type { Point } from "./engine.ts";

/** Original Lovable chain: a joint moves only when its predecessor pulls it taut. */
export function followClassicBody(head: Point, points: Point[], count: number, spacing: number, output: Point[] = []): Point[] {
  const sourceCount = points.length;
  for (let i = 0; i < count; i++) {
    const source = i < sourceCount ? points[i] : output[i - 1];
    let x = i === 0 ? head.x : (source?.x ?? head.x);
    let y = i === 0 ? head.y : (source?.y ?? head.y);
    if (i > 0) {
      const previous = output[i - 1]!;
      const dx = x - previous.x, dy = y - previous.y, distance = Math.hypot(dx, dy);
      if (distance > spacing) {
        x = previous.x + dx * spacing / distance;
        y = previous.y + dy * spacing / distance;
      }
    }
    const point = output[i] ?? (output[i] = {x:0,y:0});
    point.x=x; point.y=y;
  }
  output.length=count;
  return output;
}
