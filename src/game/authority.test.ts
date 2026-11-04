import { describe, expect, it } from "vitest";
import { Authority, type AuthorityEvent } from "./authority";
import { Arena, STEP_MS } from "./engine";
import { packSnapshot, unpackSnapshot } from "./protocol";

function setup() {
  const events: AuthorityEvent[] = [];
  const authority = new Authority((event) => events.push(event));
  authority.command({ type: "members", ids: ["a", "b"] });
  authority.command({ type: "start" });
  const last = () => events.filter((e) => e.type === "state").at(-1)!;
  return { authority, events, last };
}
describe("browser authority", () => {
  it("publishes after catch-up steps even when the final tick is not divisible by three", () => {
    const { authority, last } = setup();
    authority.advance(STEP_MS * 4);
    expect(last().snapshot.tick).toBe(4);
    authority.advance(STEP_MS * 4);
    expect(last().snapshot.tick).toBe(8);
    authority.advance(60_000);
    expect(last().snapshot.tick).toBe(13);
  });
  it("does not respawn a dead player when a previously accepted join is retried", () => {
    const { authority, last } = setup();
    const join = { type: "join", id: "a", name: "Alpha", skin: "hue", nonce: 1 } as const;
    authority.command(join);
    authority.command({ type: "members", ids: ["b"] });
    authority.command({ type: "sync" });
    expect(last().snapshot.snakes.some((s) => s.id === "a")).toBe(false);
    authority.command(join);
    authority.command({ type: "sync" });
    expect(last().snapshot.snakes.some((s) => s.id === "a")).toBe(false);
  });
  it("releases boost if control packets stop and rejects non-members", () => {
    const { authority, last } = setup();
    authority.command({ type: "join", id: "forged", name: "Bad", skin: "hue", nonce: 1 });
    authority.command({ type: "join", id: "a", name: "Alpha", skin: "hue", nonce: 1 });
    const state = last().snapshot;
    state.snakes.find((s) => s.id === "a")!.len = 30;
    authority.command({ type: "start", snapshot: state });
    authority.command({ type: "input", id: "a", input: { seq: 1, angle: 0, boost: true } });
    authority.advance(100);
    expect(last().snapshot.snakes.find((s) => s.id === "a")?.boost).toBe(true);
    authority.advance(600);
    expect(last().snapshot.snakes.find((s) => s.id === "a")?.boost).toBe(false);
    expect(last().snapshot.snakes.some((s) => s.id === "forged")).toBe(false);
  });
  it("keeps the inherited world and identifies a bot's new life after respawning", () => {
    const arena = new Arena();
    arena.step();
    const original = arena.snakes.get("bot-0")!.spawnTick;
    arena.leave("bot-0");
    while (arena.tick < 15) arena.step();
    expect(arena.snakes.get("bot-0")!.spawnTick).toBeGreaterThan(original!);
    const state = unpackSnapshot(packSnapshot(arena.snapshot()))!;
    expect(state.snakes.find((s) => s.id === "bot-0")!.spawnTick).toBe(15);
    const { authority, last } = setup();
    authority.command({ type: "start", snapshot: state });
    expect(last().snapshot).toEqual(state);
  });
});
