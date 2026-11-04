import { expect, it } from "vitest";
import { snapshotForView } from "./view-snapshot";
import { packSnapshot, unpackSnapshot } from "./protocol";
import type { Snapshot, Snake } from "./engine";

it("adds and removes foods as the player moves, without changing the shared world", () => {
  const player: Snake = {
    id: "player",
    name: "p",
    skin: "hue",
    len: 10,
    angle: 0,
    target: 0,
    hue: 0,
    bot: false,
    boost: false,
    pts: [{ x: 0, y: 0 }],
  };
  const world: Snapshot = {
    tick: 1,
    snakes: [player],
    deaths: [],
    foods: [
      { id: 1, x: 0, y: 0, r: 3, hue: 0, v: 1 },
      { id: 2, x: 500, y: 0, r: 3, hue: 0, v: 1 },
    ],
  };
  const first = snapshotForView(world, player.id, 100);
  const initial = unpackSnapshot(packSnapshot(first))!;
  const moved = { ...world, tick: 2, snakes: [{ ...player, pts: [{ x: 500, y: 0 }] }] };
  const second = snapshotForView(moved, player.id, 100);
  const decoded = unpackSnapshot(packSnapshot(second, first), initial)!;
  expect(initial.foods.map((f) => f.id)).toEqual([1]);
  expect(decoded.foods.map((f) => f.id)).toEqual([2]);
  expect(world.foods).toHaveLength(2);
});
