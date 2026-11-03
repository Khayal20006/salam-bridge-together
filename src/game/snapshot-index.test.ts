import { expect, it } from "vitest";
import { Arena } from "./engine";
import { snapshotIndex } from "./snapshot-index";
import { packSnapshot } from "./protocol";

it("shares indexes across recipients and retains separate indexes for interpolation frames", () => {
  const arena = new Arena();
  const before = arena.snapshot();
  const index = snapshotIndex(before);
  expect(snapshotIndex(before)).toBe(index);
  const packet = packSnapshot(before);
  for (let i = 0; i < 50; i++) expect(packSnapshot(before)).toEqual(packet);
  arena.step();
  const after = arena.snapshot();
  expect(snapshotIndex(after)).not.toBe(index);
  expect(index.snakes.get(before.snakes[0]!.id)?.pts).toBe(before.snakes[0]!.pts);
  expect(snapshotIndex(before)).toBe(index);
});
