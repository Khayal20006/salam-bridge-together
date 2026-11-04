import { describe, expect, it } from "vitest";
import { LocalPrediction } from "./prediction";
import { Arena, cloneSnake, type Snake } from "./engine";
import { packSnapshot, unpackSnapshot } from "./protocol";

const player = (): Snake => ({
  id: "player",
  spawnTick: 0,
  inputSeq: 0,
  name: "Player",
  skin: "hue",
  len: 20,
  angle: 0,
  target: 0,
  turnVelocity: 0,
  hue: 0,
  bot: false,
  boost: false,
  pts: Array.from({ length: 24 }, (_, i) => ({ x: -i * 8, y: 0 })),
});

describe("local movement prediction", () => {
  it("keeps authority bodies immutable across repeated pooled reconciliations and growth", () => {
    const prediction = new LocalPrediction(),
      source = player(),
      shown = cloneSnake(source);
    prediction.steer(0, false);
    for (let frame = 0; frame < 20; frame++) {
      const authority = cloneSnake(source);
      authority.len += frame * 0.75;
      for (const p of authority.pts) p.x += frame * 15.6;
      const saved = structuredClone(authority);
      prediction.reconcile(authority, frame * 100);
      for (let at = frame * 100; at < (frame + 1) * 100; at += 16) prediction.renderInto(shown, at);
      expect(authority).toEqual(saved);
      expect(shown.pts[0]!.x).toBeGreaterThanOrEqual(authority.pts[0]!.x);
    }
  });
  it("does not kick a stationary tail sideways when reconciling a turn at the head", () => {
    const prediction = new LocalPrediction(),
      source = player(),
      shown = cloneSnake(source);
    prediction.reconcile(source, 0);
    prediction.steer(Math.PI / 2, false);
    for (let at = 16; at <= 96; at += 16) prediction.renderInto(shown, at);
    const tailBefore = { ...shown.pts.at(-1)! };
    const delayed = player();
    for (const p of delayed.pts) p.x += 5;
    prediction.reconcile(delayed, 96);
    prediction.renderInto(shown, 96);
    expect(Math.abs(shown.pts.at(-1)!.y - tailBefore.y)).toBeLessThan(0.01);
  });
  it("keeps moving at constant speed on the exact frame an authority packet arrives", () => {
    const prediction = new LocalPrediction(),
      source = player(),
      shown = cloneSnake(source);
    prediction.reconcile(source, 0);
    prediction.steer(0, false);
    let previous = shown.pts[0]!.x;
    for (let at = 16; at <= 960; at += 16) {
      if (at % 96 === 0) {
        const state = player();
        for (const p of state.pts) p.x += (156 * at) / 1000;
        prediction.reconcile(state, at);
      }
      prediction.renderInto(shown, at);
      const travelled = shown.pts[0]!.x - previous;
      expect(travelled).toBeGreaterThan(2.1);
      expect(travelled).toBeLessThan(3);
      previous = shown.pts[0]!.x;
    }
  });
  it("responds within the next frame while authority input can still be in flight", () => {
    const source = player(),
      saved = structuredClone(source),
      prediction = new LocalPrediction();
    prediction.reconcile(source, 0);
    prediction.steer(Math.PI / 2, false);
    prediction.command(1, 0);
    const shown = cloneSnake(source);
    expect(prediction.renderInto(shown, 16)).toBe(true);
    expect(shown.angle).toBeGreaterThan(0);
    expect(shown.pts[0]!.x).toBeGreaterThan(0);
    expect(source).toEqual(saved);
  });
  it("corrects a returning authority frame without teleporting the visible head", () => {
    const prediction = new LocalPrediction(),
      source = player(),
      shown = cloneSnake(source);
    prediction.reconcile(source, 0);
    prediction.steer(Math.PI / 2, false);
    prediction.command(1, 0);
    for (let t = 16; t <= 96; t += 16) prediction.renderInto(shown, t);
    const previous = { ...shown.pts[0]! };
    const authority = player();
    authority.inputSeq = 1;
    authority.angle = 0.1;
    authority.pts[0] = { x: 4, y: 1 };
    prediction.reconcile(authority, 100);
    prediction.renderInto(shown, 100);
    expect(Math.hypot(shown.pts[0]!.x - previous.x, shown.pts[0]!.y - previous.y)).toBeLessThan(2);
  });
  it("stops predicting during a stalled connection and clears immediately when removed", () => {
    const prediction = new LocalPrediction(),
      source = player(),
      shown = cloneSnake(source);
    prediction.reconcile(source, 0);
    prediction.steer(0, false);
    for (let t = 16; t < 400; t += 16) prediction.renderInto(shown, t);
    const stopped = { ...shown.pts[0]! };
    prediction.renderInto(shown, 1000);
    expect(shown.pts[0]).toEqual(stopped);
    prediction.clear();
    expect(prediction.renderInto(shown, 1016)).toBe(false);
  });
  it("disables itself for an older authority and never predicts a different snake", () => {
    const prediction = new LocalPrediction(),
      source = player();
    delete source.inputSeq;
    prediction.reconcile(source, 0);
    expect(prediction.renderInto(cloneSnake(source), 16)).toBe(false);
    prediction.reconcile(player(), 32);
    const bot = player();
    bot.id = "bot-0";
    bot.bot = true;
    expect(prediction.renderInto(bot, 48)).toBe(false);
  });
  it("replicates applied input acknowledgement and retains ordering after host restore", () => {
    const arena = new Arena(Math.random, false);
    arena.snakes.set("player", player());
    arena.input("player", { seq: 4, angle: 1, boost: true });
    const packed = packSnapshot(arena.snapshot()),
      decoded = unpackSnapshot(packed)!;
    expect(decoded.snakes[0]!.inputSeq).toBe(4);
    expect(decoded.snakes[0]!.target).toBe(1);
    const next = new Arena(Math.random, false);
    next.restore(decoded);
    next.input("player", { seq: 3, angle: 2, boost: false });
    expect(next.snakes.get("player")!.target).toBe(1);
    const old = structuredClone(packed);
    delete old.motion;
    expect(unpackSnapshot(old)).not.toBeNull();
    expect(unpackSnapshot({ ...packed, motion: [["player", NaN, 1, 0]] })).toBeNull();
  });
});
