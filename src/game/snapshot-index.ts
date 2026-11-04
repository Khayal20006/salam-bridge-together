import type { Food, Snake, Snapshot } from "./engine.ts";

// Snapshot contents are immutable while retained for replication/interpolation.
// Weak keys release these indexes together with their bounded history entries.
const indexes = new WeakMap<Snapshot, { foods: Map<number, Food>; snakes: Map<string, Snake> }>();
export function snapshotIndex(snapshot: Snapshot) {
  let index = indexes.get(snapshot);
  if (!index) {
    index = { foods: new Map(), snakes: new Map() };
    for (const food of snapshot.foods) index.foods.set(food.id, food);
    for (const snake of snapshot.snakes) index.snakes.set(snake.id, snake);
    indexes.set(snapshot, index);
  }
  return index;
}
