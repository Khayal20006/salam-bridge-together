import { describe, expect, it } from "vitest";
import { ClientWorld } from "./client-world";
import type { Snapshot, Snake } from "./engine";
const snake = (id: string, x = 0): Snake => ({
  id,
  name: id,
  skin: "hue",
  len: 20,
  hue: 0,
  angle: 0,
  target: 0,
  bot: id === "bot",
  boost: false,
  spawnTick: 0,
  pts: Array.from({ length: 46 }, (_, i) => ({ x: x - i * 8, y: 0 })),
});
const state = (tick: number, x = 0): Snapshot => ({
  tick,
  snakes: [snake("self", x), snake("bot", x)],
  foods: [],
  deaths: [],
});
describe("pooled client movement", () => {
  it("responds on the next display frame, keeps buffers, and never mutates snapshots", () => {
    const world = new ClientWorld(),
      snapshot = state(0),
      saved = structuredClone(snapshot);
    world.receive(snapshot, "self", 0);
    world.angle = Math.PI / 2;
    world.boost = true;
    const objects = world.pool.slice(),
      buffers = objects.map((s) => s.x);
    world.sample(1000 / 120);
    expect(world.pool[0]!.angle).toBeGreaterThan(0);
    expect(world.pool[0]!.boost).toBe(true);
    for (let t = 16; t < 240; t += 8) world.sample(t);
    for (let i = 0; i < objects.length; i++) {
      expect(world.pool[i]).toBe(objects[i]);
      expect(world.pool[i]!.x).toBe(buffers[i]);
    }
    expect(snapshot).toEqual(saved);
  });
  it("does not rewind the current heading when an older server heading arrives", () => {
    const world = new ClientWorld();
    world.receive(state(0), "self", 0);
    world.angle = Math.PI / 2;
    world.sample(96);
    const angle = world.pool[0]!.angle,
      x = world.pool[0]!.x[0];
    world.receive(state(3, 10), "self", 96);
    world.sample(96);
    expect(world.pool[0]!.angle).toBe(angle);
    expect(world.pool[0]!.x[0]).toBe(x);
    world.sample(112);
    expect(world.pool[0]!.angle).toBeGreaterThan(angle);
  });
  it("interpolates remote bodies, includes an offscreen head with a visible tail, and removes dead snakes immediately", () => {
    const world = new ClientWorld();
    world.receive(state(0), "self", 0);
    world.sample(0);
    world.receive(state(3, 30), "self", 100);
    world.sample(150);
    const bot = world.pool[1]!;
    expect(bot.x[0]).toBeGreaterThan(0);
    expect(bot.x[0]).toBeLessThan(30);
    expect(bot.minX).toBeLessThan(bot.maxX);
    world.receive({ tick: 6, snakes: [], foods: [], deaths: [] }, "self", 200);
    world.sample(200);
    expect(world.count).toBe(0);
  });
  it("bounds speculation during network stalls and resets at a world transition", () => {
    const world = new ClientWorld();
    world.receive(state(0), "self", 0);
    world.sample(120);
    world.sample(240);
    world.sample(360);
    const x = world.pool[0]!.x[0];
    world.sample(1000);
    expect(world.pool[0]!.x[0]).toBe(x);
    world.reset();
    world.sample(1010);
    expect(world.count).toBe(0);
  });
});
