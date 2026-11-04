import { describe, expect, it } from "vitest";
import { SnapshotPlayback } from "./playback";

const STEP = 1000 / 30;
describe("remote snapshot playback", () => {
  it("plays simulation ticks at an even speed when packets alternate between early and late arrival", () => {
    const playback = new SnapshotPlayback();
    const packets = [0, 60, 200, 260, 400, 460, 600, 660, 800, 860, 1000, 1060, 1200];
    let packet = 0,
      previous = 0;
    const movement: number[] = [];
    for (let now = 0; now <= 1200; now += 10) {
      while (packet < packets.length && packets[packet]! <= now) {
        playback.receive(30 + packet * 3, packets[packet]!, STEP);
        packet++;
      }
      const tick = playback.sample(now, 0, STEP);
      if (now >= 300) movement.push((tick - previous) * STEP);
      previous = tick;
    }
    expect(Math.min(...movement)).toBeGreaterThanOrEqual(9 - 1e-6);
    expect(Math.max(...movement)).toBeLessThanOrEqual(11 + 1e-6);
  });
  it("holds at the latest authority during a stall and resumes without reversing", () => {
    const playback = new SnapshotPlayback();
    playback.receive(30, 0, STEP);
    for (let now = 0; now <= 2000; now += 10)
      expect(playback.sample(now, 0, STEP)).toBeLessThanOrEqual(30);
    const before = playback.sample(2010, 0, STEP);
    playback.receive(36, 2020, STEP);
    expect(playback.sample(2020, 0, STEP)).toBeGreaterThan(before);
    playback.receive(33, 2025, STEP); // Duplicate or out-of-order authority cannot rewind playback.
    expect(playback.sample(2030, 0, STEP)).toBeGreaterThan(before);
  });
  it("discards the old world's timeline on reconnect", () => {
    const playback = new SnapshotPlayback();
    playback.receive(900, 0, STEP);
    playback.sample(10, 890, STEP);
    playback.clear();
    playback.receive(6, 1000, STEP);
    expect(playback.sample(1000, 0, STEP)).toBeCloseTo(3);
  });
});
