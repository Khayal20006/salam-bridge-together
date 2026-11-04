import { describe, expect, it } from "vitest";
import type { Food, Snake, Snapshot } from "./engine";
import { packSnapshot, unpackSnapshot } from "./protocol";

const food = (id: number, x: number): Food => ({ id, x, y: 0, r: 4, hue: 1, v: 0.3 });
const snake = (id: string, x: number): Snake => ({
  id,
  name: id,
  skin: "hue",
  hue: 0,
  len: 20,
  angle: 0,
  target: 0,
  turnVelocity: 0,
  inputSeq: 3,
  bot: false,
  boost: false,
  spawnTick: 0,
  pts: [
    { x, y: 0 },
    { x: x - 8, y: 0 },
    { x: x - 16, y: 0 },
  ],
});
const state = (tick: number, foods: Food[]): Snapshot => ({
  tick,
  foods,
  snakes: [snake("a", 0), snake("b", 2200)],
  deaths: [],
});

describe("shared packet preparation", () => {
  it("keeps each peer's food baseline separate even when baselines have the same tick", () => {
    const a = state(0, [food(1, 0), food(2, 20)]),
      b = state(0, [food(1, 10), food(3, 30)]);
    const current = state(3, [food(1, 10), food(2, 20)]);
    const packetA = packSnapshot(current, a),
      saved = structuredClone(packetA);
    const packetB = packSnapshot(current, b);
    expect(packetA.foods.map((f) => f[0])).toEqual([1]);
    expect(packetA.removed).toEqual([]);
    expect(packetB.foods.map((f) => f[0])).toEqual([2]);
    expect(packetB.removed).toEqual([3]);
    expect(unpackSnapshot(packetA, a)).toEqual(unpackSnapshot(packetB, b));
    const full = packSnapshot(current);
    expect(full.foods).toHaveLength(2);
    expect(full.base).toBeNull();
    expect(packetA).toEqual(saved);
    expect(packSnapshot(current, a)).toEqual(saved);
  });
  it("does not mix near bodies or input acknowledgements between peer views", () => {
    const current = state(3, []),
      saved = structuredClone(current);
    const a = packSnapshot(current, undefined, { id: "a", radius: 800 }),
      savedA = structuredClone(a);
    const b = packSnapshot(current, undefined, { id: "b", radius: 800 });
    expect(a.snakes.map((s) => s[8].length)).toEqual([6, 2]);
    expect(b.snakes.map((s) => s[8].length)).toEqual([2, 6]);
    expect(a.motion?.map((m) => m[0])).toEqual(["a"]);
    expect(b.motion?.map((m) => m[0])).toEqual(["b"]);
    expect(packSnapshot(current).snakes.map((s) => s[8].length)).toEqual([6, 6]);
    expect(a).toEqual(savedA);
    expect(current).toEqual(saved);
  });
  it("decimates long fallback bodies while keeping both endpoints", () => {
    const current = state(3, []);
    current.snakes[0] = {
      ...snake("a", 0),
      pts: Array.from({ length: 480 }, (_, i) => ({ x: i, y: 0 })),
    };
    const packet = packSnapshot(current, undefined, undefined, true),
      points = packet.snakes.find((s) => s[0] === "a")![8];
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.length).toBeLessThan(480);
    expect(points.length % 2).toBe(0);
    expect(points.slice(0, 2)).toEqual([0, 0]);
    expect(points.slice(-2)).toEqual([479, 0]);
    expect(unpackSnapshot(packet)).not.toBeNull();
    expect(packSnapshot(current).snakes.find((s) => s[0] === "a")![8]).toHaveLength(960);
  });
  it("keeps a nearby tail visible and checks points after a bounding-box overlap", () => {
    const current = state(3, []);
    current.snakes.push({
      ...snake("tail", 1500),
      pts: [
        { x: 1500, y: 0 },
        { x: 100, y: 0 },
      ],
    });
    current.snakes.push({
      ...snake("diagonal", 1500),
      pts: [
        { x: 1500, y: 0 },
        { x: 0, y: 1500 },
      ],
    });
    const packet = packSnapshot(current, undefined, { id: "a", radius: 800 });
    expect(packet.snakes.find((s) => s[0] === "tail")![8]).toHaveLength(4);
    expect(packet.snakes.find((s) => s[0] === "diagonal")![8]).toHaveLength(2);
  });
});
