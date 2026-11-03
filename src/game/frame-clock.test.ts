import { describe, expect, it } from "vitest";
import { FRAME_MS, nextPaintTime } from "./frame-clock";

describe("60 Hz paint scheduler", () => {
  it.each([60, 90, 120, 144, 165, 240])("keeps a %i Hz display near 60 paints", (hz) => {
    let scheduled = 0,
      paints = 0;
    for (let now = 0; now <= 1000; now += 1000 / hz) {
      const next = nextPaintTime(now, scheduled);
      if (next !== null) {
        scheduled = next;
        paints++;
      }
    }
    expect(paints).toBeGreaterThanOrEqual(59);
    expect(paints).toBeLessThanOrEqual(61);
  });
  it("catches up after a long stall instead of building a backlog", () => {
    const next = nextPaintTime(2000, 100);
    expect(next).not.toBeNull();
    expect(next! - 2000).toBeLessThanOrEqual(FRAME_MS + 0.5);
  });
});
