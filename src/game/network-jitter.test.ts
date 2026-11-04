import { expect, it } from "vitest";
import { ClientWorld } from "./client-world";
import type { Snapshot } from "./engine";
it("keeps moving between 300 ms Render packets, but still stops after a real outage", () => {
  const world = new ClientWorld();
  let tick = 0;
  const snapshot = (): Snapshot => ({
    tick,
    snakes: [
      {
        id: "self",
        name: "self",
        skin: "hue",
        angle: 0,
        target: 0,
        len: 10,
        hue: 0,
        bot: false,
        boost: false,
        spawnTick: 0,
        pts: Array.from({ length: 10 }, (_, i) => ({ x: tick * 5.2 - i * 8, y: 0 })),
      },
    ],
    foods: [],
    deaths: [],
  });
  world.receive(snapshot(), "self", 0);
  for (let now = 16; now <= 2400; now += 16) {
    if (now % 304 === 0) {
      tick += 6;
      world.receive(snapshot(), "self", now);
    }
    world.sample(now);
  }
  let before = world.pool[0]!.x[0]!;
  // This is over 250 ms after the last publication; the old predictor froze here.
  world.sample(2448);
  expect(world.pool[0]!.x[0]!).toBeGreaterThan(before);
  for (let now = 2464; now < 4000; now += 16) world.sample(now);
  before = world.pool[0]!.x[0]!;
  world.sample(5000);
  expect(world.pool[0]!.x[0]).toBe(before);
});
