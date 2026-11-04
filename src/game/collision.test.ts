import { expect, it } from "vitest";
import { contactTime, resolveContacts } from "./collision";
import { Arena, segmentsDistanceSquared, type Snake } from "./engine";
const p = (x: number, y: number) => ({ x, y });
it("does not collide paths that visit the same location at different times", () => {
  const h0 = p(0, 0),
    h1 = p(14, 0),
    a0 = p(0, -30),
    a1 = p(0, 0),
    b0 = p(0, -20),
    b1 = p(0, 10);
  // The old test intersected the head path with the FINAL body and killed it.
  expect(segmentsDistanceSquared(h0, h1, a1, b1)).toBe(0);
  expect(contactTime(h0, h1, a0, a1, b0, b1, 5)).toBe(Infinity);
});
it("detects a boosting head crossing a moving body between snapshots", () => {
  expect(contactTime(p(-14, 0), p(14, 0), p(0, -20), p(0, -6), p(0, 20), p(0, 34), 2)).toBeCloseTo(
    12 / 28,
    4,
  );
});
it("detects true head-on contact and ignores nearby parallel motion", () => {
  expect(contactTime(p(-14, 0), p(14, 0), p(14, 0), p(-14, 0), p(14, 0), p(-14, 0), 4)).toBeCloseTo(
    24 / 56,
    4,
  );
  expect(contactTime(p(0, 0), p(14, 0), p(0, 12), p(14, 12), p(-8, 12), p(6, 12), 10)).toBe(
    Infinity,
  );
});
it("kills only the head that hits a body, and a later impact with its dead owner cannot kill the cutter", () => {
  const dead = new Set<string>();
  resolveContacts(
    [
      { time: 0.7, victim: "cutter", obstacle: "follower", both: true },
      { time: 0.2, victim: "follower", obstacle: "cutter", both: false },
    ],
    dead,
  );
  expect([...dead]).toEqual(["follower"]);
});
it("resolves genuinely simultaneous impacts independently of insertion order", () => {
  const contacts = [
    { time: 0.5, victim: "a", obstacle: "b", both: false },
    { time: 0.5, victim: "b", obstacle: "a", both: false },
  ];
  const a = new Set<string>(),
    b = new Set<string>();
  resolveContacts(contacts, a);
  resolveContacts(contacts.reverse(), b);
  expect(a).toEqual(b);
  expect(a.size).toBe(2);
});
it("a player cutting across an opponent survives while the opponent dies and drops shared food", () => {
  const make = (id: string, x: number, y: number, angle: number): Snake => ({
    id,
    name: id,
    skin: "hue",
    spawnTick: 0,
    len: 10,
    hue: 0,
    angle,
    target: angle,
    bot: false,
    boost: false,
    pts: Array.from({ length: 10 }, (_, i) =>
      p(x - Math.cos(angle) * i * 8, y - Math.sin(angle) * i * 8),
    ),
  });
  for (const reversed of [false, true]) {
    const arena = new Arena(() => 0.25, false);
    arena.tick = 100;
    const cutter = make("cutter", 40, 0, 0),
      follower = make("follower", 0, -16, Math.PI / 2);
    for (const s of reversed ? [follower, cutter] : [cutter, follower]) arena.snakes.set(s.id, s);
    arena.step();
    arena.step();
    expect(arena.snakes.has("cutter")).toBe(true);
    expect(arena.snakes.has("follower")).toBe(false);
    expect(arena.deaths.map((d) => d.id)).toEqual(["follower"]);
    expect([...arena.foods.values()].some((f) => Math.abs(f.x) < 0.001 && f.y < 0)).toBe(true);
  }
});
