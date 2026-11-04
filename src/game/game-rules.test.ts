import { describe, expect, it } from "vitest";
import {
  Arena,
  snakeWidth,
  segmentCount,
  isSpawnProtected,
  SPAWN_PROTECTION_TICKS,
  type Snake,
} from "./engine";

const snake = (id: string, y = 0, spawnTick = 0): Snake => ({
  id,
  name: id,
  skin: "hue",
  len: 10,
  angle: 0,
  target: 0,
  hue: 150,
  bot: false,
  boost: false,
  spawnTick,
  pts: Array.from({ length: 10 }, (_, i) => ({ x: -i * 8, y })),
});

describe("classic shared game rules", () => {
  it("grows both the visible width and travelled body after eating shared food", () => {
    const arena = new Arena(() => 0.25, false),
      player = snake("player");
    arena.snakes.set(player.id, player);
    const beforeWidth = snakeWidth(player),
      beforePoints = player.pts.length;
    arena.foods.set(99999, { id: 99999, x: 18, y: 0, r: 5, hue: 0, v: 8 });
    arena.step();
    expect(arena.foods.has(99999)).toBe(false);
    expect(snakeWidth(player)).toBeGreaterThan(beforeWidth);
    expect(segmentCount(player.len)).toBeGreaterThan(beforePoints);
    // Keep the test focused on growth rather than bot spawning.
    for (let i = 0; i < 100; i++) {
      arena.tick = 1;
      arena.step();
    }
    expect(player.pts.length).toBeGreaterThan(beforePoints);
  });
  it("forgives a shallow visual overlap but detects a deep collision", () => {
    const check = (distance: number) => {
      const arena = new Arena(() => 0.25, false);
      arena.tick = 100;
      arena.snakes.set("one", snake("one"));
      arena.snakes.set("two", snake("two", distance));
      arena.step();
      return arena.snakes;
    };
    expect(check(13).has("one")).toBe(true);
    expect(check(4).has("one")).toBe(false);
  });
  it("protects a newborn and its opponent for the three-second spawn period", () => {
    const arena = new Arena(() => 0.25, false);
    arena.tick = 100;
    arena.snakes.set("new", snake("new", 0, 100));
    arena.snakes.set("old", snake("old", 0, 0));
    arena.step();
    expect(arena.snakes.has("new")).toBe(true);
    expect(arena.snakes.has("old")).toBe(true);
    expect(SPAWN_PROTECTION_TICKS).toBe(90);
    expect(isSpawnProtected(snake("new", 0, 100), 189)).toBe(true);
    expect(isSpawnProtected(snake("new", 0, 100), 190)).toBe(false);
  });
});
