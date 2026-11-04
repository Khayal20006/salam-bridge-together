import type { Snapshot } from "./engine.ts";

/** Filtering affects replication only; the server always simulates the whole room. */
export function snapshotForView(snapshot: Snapshot, id: string, radius: number): Snapshot {
  const focus = snapshot.snakes.find((s) => s.id === id)?.pts[0] ?? { x: 0, y: 0 };
  return {
    ...snapshot,
    foods: snapshot.foods.filter(
      (f) => Math.abs(f.x - focus.x) <= radius && Math.abs(f.y - focus.y) <= radius,
    ),
  };
}
