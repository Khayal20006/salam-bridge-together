import { describe, expect, it } from "vitest";
import {
  Arena,
  BOT_COUNT,
  STEP_MS,
  segmentCount,
  snakeWidth,
  segmentsDistanceSquared,
  pointSegmentDistanceSquared,
  isSpawnProtected,
  SPAWN_PROTECTION_TICKS,
  advanceHead,
  BASE_SPEED,
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
  it.each([20, 100, 500])(
    "forgives a shallow graze at length %i but still kills a deep crossing",
    (len) => {
      for (const penetration of [1.05, 0.77, 0.55]) {
        const arena = new Arena(random(), false),
          player = snake("player", 0, 0),
          wall = snake("wall", 0, -1000, -Math.PI / 2);
        player.len = len;
        wall.len = len;
        const count = segmentCount(len),
          top = -(count - 1) * 4;
        wall.pts = Array.from({ length: count }, (_, i) => ({ x: 0, y: top + i * 8 }));
        const gap = (snakeWidth(player) + snakeWidth(wall)) * penetration;
        for (const p of player.pts) p.x -= gap + (BASE_SPEED * STEP_MS) / 1000;
        arena.snakes.set(player.id, player);
        arena.snakes.set(wall.id, wall);
        arena.step();
        expect(arena.deaths.some((d) => d.id === player.id)).toBe(penetration === 0.55);
      }
    },
  );
  it("keeps normal travel steady and limits boost to about twice normal speed", () => {
    const normal = snake("normal", 0, 0),
      boosted = snake("boosted", 0, 0);
    boosted.boost = true;
    const a = advanceHead(normal, 1),
      b = advanceHead(boosted, 1);
    expect(a.x).toBeCloseTo(156);
    expect(b.x / a.x).toBeGreaterThan(1.9);
    expect(b.x / a.x).toBeLessThan(2.2);
    expect(a.y).toBe(0);
    expect(b.y).toBe(0);
  });
  it("leaves large pellets from a large snake and small pellets from a small snake for all peers", () => {
    const arena = new Arena(random(), false),
      small = snake("small", 2998, -300),
      large = snake("large", 2998, 300);
    small.len = 10;
    large.len = 500;
    for (const s of [small, large]) {
      s.pts = Array.from({ length: segmentCount(s.len) }, (_, i) => ({
        x: 2998 - i * 8,
        y: s.pts[0]!.y,
      }));
      arena.snakes.set(s.id, s);
    }
    arena.step();
    expect(arena.deaths.map((d) => d.id)).toEqual(["small", "large"]);
    const smallFood = [...arena.foods.values()].filter((f) => f.y === -300);
    const largeFood = [...arena.foods.values()].filter((f) => f.y === 300);
    expect(smallFood).toHaveLength(Math.ceil(small.pts.length / 3));
    expect(largeFood).toHaveLength(Math.ceil(large.pts.length / 3));
    expect(Math.min(...largeFood.map((f) => f.r))).toBeGreaterThan(
      Math.max(...smallFood.map((f) => f.r)) * 2,
    );
    expect(Math.max(...largeFood.map((f) => f.r))).toBeLessThanOrEqual(16);
    expect(largeFood.reduce((sum, f) => sum + f.v * 2.5, 0)).toBeLessThan(large.len * 0.6);
    expect(Math.max(...largeFood.map((f) => f.v * 2.5))).toBeLessThanOrEqual(20);
    const packet = packSnapshot(arena.snapshot());
    expect(unpackSnapshot(packet)).toEqual(unpackSnapshot(JSON.parse(JSON.stringify(packet))));
  });
  it("protects a newborn against bodies for exactly 1500ms, then enables collisions", () => {
    const arena = new Arena(random(), false);
    arena.tick = SPAWN_PROTECTION_TICKS - 2;
    const player = snake("player", -12, 0);
    player.spawnTick = 0;
    const wall = snake("wall", 0, -180, -Math.PI / 2);
    wall.len = 40;
    wall.pts = Array.from({ length: 50 }, (_, i) => ({ x: 0, y: -180 + i * 8 }));
    arena.snakes.set(player.id, player);
    arena.snakes.set(wall.id, wall);
    arena.step();
    expect(isSpawnProtected(player, arena.tick)).toBe(true);
    expect(arena.snakes.has(player.id)).toBe(true);
    arena.step();
    expect(isSpawnProtected(player, arena.tick)).toBe(false);
    expect(arena.deaths.some((d) => d.id === player.id)).toBe(true);
    expect(SPAWN_PROTECTION_TICKS * STEP_MS).toBeCloseTo(1500);
  });
  it("does not let a protected newborn kill an unprotected opponent", () => {
    const arena = new Arena(random(), false);
    const newborn = snake("a", -9, 0),
      opponent = snake("b", 9, 0, Math.PI);
    newborn.spawnTick = 0;
    for (const s of [newborn, opponent]) arena.snakes.set(s.id, s);
    arena.step();
    expect(arena.snakes.has(newborn.id)).toBe(true);
    expect(arena.snakes.has(opponent.id)).toBe(true);
    expect(arena.deaths).toHaveLength(0);
  });
  it("forgives a light edge graze while killing a deeper body collision", () => {
    const arena = new Arena(random(), false);
    const player = snake("player", 0, 0),
      wall = snake("wall", 0, -180, -Math.PI / 2);
    wall.len = 40;
    wall.pts = Array.from({ length: 50 }, (_, i) => ({ x: 0, y: -180 + i * 8 }));
    const start = (snakeWidth(player) + snakeWidth(wall)) * 0.9 + (BASE_SPEED * STEP_MS) / 1000;
    for (const p of player.pts) p.x -= start;
    arena.snakes.set(player.id, player);
    arena.snakes.set(wall.id, wall);
    arena.step();
    expect(arena.deaths.some((d) => d.id === player.id)).toBe(false);
    arena.step();
    expect(arena.deaths.some((d) => d.id === player.id)).toBe(true);
  });
  it("does not renew protection on repeated join or disable the world boundary", () => {
    const arena = new Arena(random(), false);
    const player = arena.join("player", "Player", "hue")!;
    arena.tick = 10;
    expect(arena.join("player", "Player", "hue")!.spawnTick).toBe(0);
    player.pts = Array.from({ length: 10 }, (_, i) => ({ x: 2999 - i * 8, y: 0 }));
    player.angle = player.target = 0;
    arena.step();
    expect(arena.deaths.some((d) => d.id === player.id)).toBe(true);
  });
  it("replicates the same protection expiry to every client", () => {
    const arena = new Arena(random(), false);
    const player = arena.join("player", "Player", "hue")!;
    const first = unpackSnapshot(packSnapshot(arena.snapshot()))!;
    const second = unpackSnapshot(packSnapshot(arena.snapshot()))!;
    for (const tick of [0, 44, 45, 46]) {
      expect(isSpawnProtected(first.snakes[0]!, tick)).toBe(isSpawnProtected(player, tick));
      expect(isSpawnProtected(second.snakes[0]!, tick)).toBe(isSpawnProtected(player, tick));
    }
  });
  it("pulls nearby food toward the mouth before eating it", () => {
    const arena = new Arena(random(), false),
      player = snake("a", 0, 0);
    arena.snakes.set(player.id, player);
    arena.foods.set(9001, { id: 9001, x: 64, y: 0, v: 0.3, hue: 0, r: 4 });
    arena.step();
    expect(arena.foods.get(9001)!.x).toBeLessThan(64);
    expect(arena.foods.get(9001)!.x).toBeGreaterThan(player.pts[0]!.x);
    expect(player.len).toBe(20);
  });
  it("leaves food outside the attraction range stationary", () => {
    const arena = new Arena(random(), false);
    arena.snakes.set("a", snake("a", 0, 0));
    arena.foods.set(9001, { id: 9001, x: 200, y: 0, v: 0.3, hue: 0, r: 4 });
    arena.step();
    expect(arena.foods.get(9001)!.x).toBe(200);
  });
  it("pulls contested food toward one mouth regardless of player iteration order", () => {
    const run = (reverse: boolean) => {
      const arena = new Arena(random(), false),
        pair = [snake("a", -50, 0), snake("b", 50, 0, Math.PI)];
      for (const s of reverse ? pair.reverse() : pair) arena.snakes.set(s.id, s);
      arena.foods.set(9001, { id: 9001, x: 0, y: 0, v: 0.3, hue: 0, r: 4 });
      arena.step();
      return arena.foods.get(9001)!.x;
    };
    expect(run(false)).toBeLessThan(0);
    expect(run(false)).toBeCloseTo(run(true));
  });
  it("keeps the moving body on the head's route instead of pulling its joints across a turn", () => {
    const arena = new Arena(random(), false),
      player = snake("player", 0, 0);
    player.len = 10;
    const route = player.pts.map((p) => ({ ...p }));
    arena.snakes.set(player.id, player);
    for (let tick = 0; tick < 12; tick++) {
      arena.input(player.id, { seq: tick, angle: Math.PI / 2, boost: false });
      arena.step();
      route.unshift({ ...player.pts[0]! });
      for (const p of player.pts) {
        const distance = Math.min(
          ...route.slice(1).map((b, i) => pointSegmentDistanceSquared(p, route[i]!, b)),
        );
        expect(distance).toBeLessThan(0.00000001);
      }
    }
    expect(player.pts[4]!.y).toBeGreaterThan(0);
  });
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
  it("selects one head-on survivor in the same tick, regardless of insertion order", () => {
    function run(reverse: boolean) {
      const arena = new Arena(random(), false);
      const pair = [snake("a", -9, 0), snake("b", 9, 0, Math.PI)];
      for (const s of reverse ? pair.reverse() : pair) arena.snakes.set(s.id, s);
      arena.step();
      expect([...arena.snakes.keys()]).toEqual(["a"]);
      expect(arena.deaths.map((d) => d.id)).toEqual(["b"]);
      return arena.deaths.sort((a, b) => a.id.localeCompare(b.id));
    }
    expect(run(false)).toEqual(run(true));
  });
  it("lets the larger snake win head-on without being killed again by the defeated snake's neck", () => {
    for (const reverse of [false, true]) {
      const arena = new Arena(random(), false);
      const a = snake("a", -9, 0),
        b = snake("b", 9, 0, Math.PI);
      b.len = 40;
      for (const s of reverse ? [b, a] : [a, b]) arena.snakes.set(s.id, s);
      arena.step();
      expect([...arena.snakes.keys()]).toEqual(["b"]);
      expect(arena.deaths.map((d) => d.id)).toEqual(["a"]);
    }
  });
  it("still checks the head-on winner against unrelated bodies", () => {
    const arena = new Arena(random(), false);
    const a = snake("a", -9, 0),
      b = snake("b", 9, 0, Math.PI);
    b.len = 40;
    const wall = snake("wall", 20, -100, -Math.PI / 2);
    wall.pts = Array.from({ length: 26 }, (_, i) => ({ x: 20, y: -100 + i * 8 }));
    for (const s of [a, b, wall]) arena.snakes.set(s.id, s);
    arena.step();
    expect(arena.deaths.some((d) => d.id === "b")).toBe(true);
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
    body.len = 40;
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
    expect([...arena.snakes.values()].map((s) => s.len).sort()).toEqual([20, 45]);
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
  });
  it("grows in length with only gradual thickening", () => {
    expect(segmentCount(10.3) - segmentCount(10)).toBeLessThanOrEqual(1);
    expect(segmentCount(13) - segmentCount(10)).toBeLessThanOrEqual(5);
    expect(snakeWidth({ len: 13 })).toBeGreaterThan(snakeWidth({ len: 10 }));
    expect(snakeWidth({ len: 13 }) - snakeWidth({ len: 10 })).toBeGreaterThan(0.5);
    expect(snakeWidth({ len: 13 }) - snakeWidth({ len: 10 })).toBeLessThan(0.7);
    expect(snakeWidth({ len: 10.75 }) - snakeWidth({ len: 10 })).toBeLessThan(0.2);
  });
  it("keeps thickening past the old radius limit without making large meals cause a width jump", () => {
    const widths = [10, 50, 100, 170, 200, 500, 1_000, 10_000].map((len) => snakeWidth({ len }));
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]!);
    expect(snakeWidth({ len: 200 })).toBeGreaterThan(18);
    expect(snakeWidth({ len: 200.75 }) - snakeWidth({ len: 200 })).toBeLessThan(0.02);
    expect(snakeWidth({ len: 10_000 })).toBeLessThan(45);
  });
  it("makes repeated normal meals visibly extend the body and gently increase thickness", () => {
    const arena = new Arena(random(), false),
      player = snake("player", 0, 0);
    player.len = 10;
    arena.snakes.set(player.id, player);
    const originalPoints = player.pts.length;
    for (let i = 0; i < 15; i++) {
      const head = player.pts[0]!;
      arena.foods.set(100000 + i, {
        id: 100000 + i,
        x: head.x + 14,
        y: head.y,
        r: 4,
        hue: 0,
        v: 0.3,
      });
      arena.step();
    }
    expect(player.len).toBeGreaterThanOrEqual(21.2);
    expect(player.pts.length).toBeGreaterThan(originalPoints + 8);
    expect(snakeWidth(player)).toBeGreaterThan(12.8);
    expect(snakeWidth(player)).toBeLessThan(13.3);
    const packet = packSnapshot(arena.snapshot());
    for (const client of [
      unpackSnapshot(packet)!,
      unpackSnapshot(JSON.parse(JSON.stringify(packet)))!,
    ]) {
      expect(snakeWidth(client.snakes.find((s) => s.id === player.id)!)).toBe(snakeWidth(player));
    }
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
  it("keeps retained frames unchanged while sharing stable paths and food", () => {
    const arena = new Arena(random());
    const first = arena.snapshot();
    const saved = structuredClone(first);
    const again = arena.snapshot();
    expect(again.snakes[0]!.pts).toBe(first.snakes[0]!.pts);
    expect(again.foods[0]).toBe(first.foods[0]);
    const liveFood = arena.foods.get(first.foods[0]!.id)!;
    liveFood.x += 10;
    const changed = arena.snapshot();
    expect(changed.foods[0]).not.toBe(first.foods[0]);
    for (let i = 0; i < 60; i++) arena.step();
    expect(first).toEqual(saved);
    expect(arena.snapshot().snakes[0]!.pts).not.toBe(first.snakes[0]!.pts);
  });
  it("reuses unchanged food through keyframes without mutating earlier deltas", () => {
    const arena = new Arena(random());
    const source = arena.snapshot();
    const first = unpackSnapshot(packSnapshot(source))!;
    const saved = structuredClone(first);
    const keyframe = unpackSnapshot(packSnapshot(source), first)!;
    expect(keyframe.foods[0]).toBe(first.foods[0]);
    const food = arena.foods.get(first.foods[0]!.id)!;
    food.x += 12;
    arena.tick++;
    const next = unpackSnapshot(packSnapshot(arena.snapshot(), source), first)!;
    expect(next.foods.find((f) => f.id === food.id)).not.toBe(first.foods[0]);
    expect(first).toEqual(saved);
  });
  it("replicates food movement in deltas to both clients", () => {
    const arena = new Arena(random()),
      before = arena.snapshot();
    const a = unpackSnapshot(packSnapshot(before))!,
      b = unpackSnapshot(packSnapshot(before))!;
    const food = arena.foods.values().next().value!;
    food.x += 8;
    food.y -= 5;
    arena.tick++;
    const packet = packSnapshot(arena.snapshot(), before);
    expect(packet.foods.some((f) => f[0] === food.id)).toBe(true);
    const first = unpackSnapshot(packet, a)!,
      second = unpackSnapshot(packet, b)!;
    expect(first).toEqual(second);
    expect(first.foods.find((f) => f.id === food.id)!.x).toBe(Math.round(food.x));
  });
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
