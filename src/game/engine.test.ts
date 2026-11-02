import { describe, expect, it } from "vitest";
import {
  Arena,
  BOT_COUNT,
  STEP_MS,
  segmentCount,
  snakeWidth,
  segmentsDistanceSquared,
  type Snake,
} from "./engine";
import { packSnapshot, unpackSnapshot } from "./protocol";

function random(seed = 12345) {
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
function snake(id: string, x: number, y: number, angle = 0): Snake {
  return {
    id,
    name: id,
    len: 20,
    hue: 100,
    angle,
    target: angle,
    bot: false,
    boost: false,
    skin: "hue",
    pts: Array.from({ length: 10 }, (_, i) => ({
      x: x - Math.cos(angle) * i * 8,
      y: y - Math.sin(angle) * i * 8,
    })),
  };
}

describe("authoritative arena", () => {
  it("uses a fixed 33.333ms tick", () => {
    expect(STEP_MS).toBeCloseTo(33.33333, 4);
  });
  it("spawns one set of 18 bots, clear of other bodies and the boundary", () => {
    const arena = new Arena(random());
    expect([...arena.snakes.values()].filter((s) => s.bot)).toHaveLength(BOT_COUNT);
    for (const s of arena.snakes.values()) {
      expect(s.pts.every((p) => Math.hypot(p.x, p.y) < 2920)).toBe(true);
      for (const other of arena.snakes.values()) {
        if (s === other) continue;
        const r = snakeWidth(s) + snakeWidth(other);
        expect(
          s.pts.every((p) => other.pts.every((q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 > r ** 2)),
        ).toBe(true);
      }
    }
  });
  it("resolves a head-on collision in the same tick, regardless of insertion order", () => {
    function run(reverse: boolean) {
      const arena = new Arena(random(), false);
      const pair = [snake("a", -9, 0), snake("b", 9, 0, Math.PI)];
      for (const s of reverse ? pair.reverse() : pair) arena.snakes.set(s.id, s);
      arena.step();
      expect(arena.snakes.size).toBe(0);
      return arena.deaths.sort((a, b) => a.id.localeCompare(b.id));
    }
    expect(run(false)).toEqual(run(true));
  });
  it("detects the swept head path crossing a body, even when endpoints miss", () => {
    expect(
      segmentsDistanceSquared({ x: -40, y: 0 }, { x: 40, y: 0 }, { x: 0, y: -40 }, { x: 0, y: 40 }),
    ).toBe(0);
    expect(
      segmentsDistanceSquared({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }),
    ).toBe(4);
    const arena = new Arena(random(), false);
    const moving = snake("player", -28, 0);
    moving.len = 50;
    moving.boost = true;
    const body = snake("wall", 0, -180, -Math.PI / 2);
    body.pts = Array.from({ length: 50 }, (_, i) => ({ x: 0, y: -180 + i * 8 }));
    arena.snakes.set(moving.id, moving);
    arena.snakes.set(body.id, body);
    arena.step();
    expect(arena.deaths.some((d) => d.id === "player")).toBe(true);
  });
  it("lets food be eaten by exactly one snake", () => {
    const arena = new Arena(random(), false);
    arena.snakes.set("a", snake("a", -25, 0));
    arena.snakes.set("b", snake("b", 25, 0, Math.PI));
    arena.foods.set(9001, { id: 9001, x: 0, y: 0, v: 10, hue: 0, r: 4 });
    arena.step();
    expect([...arena.snakes.values()].map((s) => s.len).sort()).toEqual([20, 36]);
    expect(arena.foods.has(9001)).toBe(false);
  });
  it("ignores malformed and out-of-order input instead of accepting positions", () => {
    const arena = new Arena(random(), false);
    const s = snake("a", 0, 0);
    arena.snakes.set(s.id, s);
    arena.input("a", { seq: 10, angle: 1, boost: true });
    arena.input("a", { seq: 9, angle: 2, boost: false });
    arena.input("a", { seq: 11, angle: NaN, boost: false });
    expect(s.target).toBe(1);
    expect(s.boost).toBe(true);
  });
  it("caps body detail as length increases", () => {
    expect(segmentCount(10)).toBe(10);
    expect(segmentCount(1_000_000)).toBe(240);
    expect(snakeWidth({ len: 1_000_000 })).toBe(41);
  });
  it("transfers the exact simulation when authority changes", () => {
    const original = new Arena(random());
    original.join("player", "Test", "aurora");
    for (let i = 0; i < 6; i++) original.step();
    const next = new Arena(random(2), false);
    next.restore(original.snapshot());
    expect(next.snapshot()).toEqual(original.snapshot());
  });
});

describe("replication protocol", () => {
  it("gives two clients identical bots, bodies, food and deaths for the same tick", () => {
    const arena = new Arena(random());
    arena.join("player-a", "A", "fire");
    arena.join("player-b", "B", "ice");
    let previous, a, b;
    for (let frame = 0; frame < 12; frame++) {
      const state = arena.snapshot();
      const packet = JSON.parse(JSON.stringify(packSnapshot(state, previous)));
      a = unpackSnapshot(packet, a ?? undefined);
      b = unpackSnapshot(packet, b ?? undefined);
      expect(a).not.toBeNull();
      expect(a).toEqual(b);
      expect(a!.snakes.map((s) => s.id)).toEqual(state.snakes.map((s) => s.id));
      previous = state;
      for (let i = 0; i < 3; i++) arena.step();
    }
  });
  it("rejects a missing delta and recovers from a keyframe", () => {
    const arena = new Arena(random());
    const initial = arena.snapshot();
    const client = unpackSnapshot(packSnapshot(initial))!;
    arena.step();
    const dropped = arena.snapshot();
    arena.step();
    expect(unpackSnapshot(packSnapshot(arena.snapshot(), dropped), client)).toBeNull();
    expect(unpackSnapshot(packSnapshot(arena.snapshot()), client)).not.toBeNull();
  });
  it("rejects corrupt or oversized snapshots without mutating the current state", () => {
    const packet = packSnapshot(new Arena(random()).snapshot());
    expect(unpackSnapshot({ ...packet, snakes: Array(69).fill(packet.snakes[0]) })).toBeNull();
    const invalid = structuredClone(packet);
    invalid.snakes[0]![8][0] = Infinity;
    expect(unpackSnapshot(invalid)).toBeNull();
    expect(unpackSnapshot(null)).toBeNull();
  });
  it("sends food changes after a keyframe rather than resending every food item", () => {
    const arena = new Arena(random());
    const previous = arena.snapshot();
    arena.step();
    expect(packSnapshot(arena.snapshot(), previous).foods.length).toBeLessThan(100);
  });
});
