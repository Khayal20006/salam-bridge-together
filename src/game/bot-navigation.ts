import type { Food, Point, Snake } from "./engine.ts";
import { angleDelta, smoothTurn } from "./movement.ts";

export type BotMemory = {
  goal: Point;
  food: number | null;
  until: number;
  anchor: Point;
  anchorTick: number;
};
export type Obstacle = { id: string; a: Point; b: Point; radius: number };

export function botGoal(
  snake: Snake,
  foods: Iterable<Food>,
  allFoods: Map<number, Food>,
  previous: BotMemory | undefined,
  tick: number,
): BotMemory {
  const head = snake.pts[0]!;
  let memory = previous;
  if (memory && tick - memory.anchorTick >= 90) {
    const stuck = Math.hypot(head.x - memory.anchor.x, head.y - memory.anchor.y) < 110;
    memory = { ...memory, anchor: { ...head }, anchorTick: tick };
    if (stuck)
      return {
        ...memory,
        food: null,
        until: tick + 60,
        goal: { x: head.x + Math.cos(snake.angle) * 650, y: head.y + Math.sin(snake.angle) * 650 },
      };
  }
  if (memory && memory.until > tick) {
    const food = memory.food === null ? undefined : allFoods.get(memory.food);
    if (food) return { ...memory, goal: { x: food.x, y: food.y } };
    if (memory.food === null && Math.hypot(head.x - memory.goal.x, head.y - memory.goal.y) > 80)
      return memory;
  }
  let chosen: Food | undefined,
    best = Infinity;
  for (const food of foods) {
    const dx = food.x - head.x,
      dy = food.y - head.y;
    const angle = Math.abs(angleDelta(snake.angle, Math.atan2(dy, dx)));
    // Food behind the neck is not a reason to make a U-turn every AI update.
    if (angle > 1.65) continue;
    const score =
      (Math.hypot(dx, dy) * (1 + angle * angle * 1.8)) / Math.sqrt(Math.max(0.3, food.v));
    if (score < best) {
      best = score;
      chosen = food;
    }
  }
  return {
    goal: chosen
      ? { x: chosen.x, y: chosen.y }
      : {
          x: head.x + Math.cos(snake.angle) * 650,
          y: head.y + Math.sin(snake.angle) * 650,
        },
    food: chosen?.id ?? null,
    until: tick + (chosen ? 45 : 60),
    anchor: memory?.anchor ?? { ...head },
    anchorTick: memory?.anchorTick ?? tick,
  };
}

function distance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/** Score future curved paths. A body behind the bot cannot reverse its steering. */
export function botHeading(
  snake: Snake,
  goal: Point,
  obstacles: Iterable<Obstacle>,
  world: number,
  radius = 11,
): number {
  const head = snake.pts[0]!;
  const desired =
    Math.hypot(head.x, head.y) > world - 180
      ? Math.atan2(-head.y, -head.x)
      : Math.atan2(goal.y - head.y, goal.x - head.x);
  const nearby = [...obstacles].filter((body) => body.id !== snake.id);
  const candidates = [
    desired,
    snake.target,
    snake.angle,
    ...[-2, -1.4, -0.9, -0.45, 0.45, 0.9, 1.4, 2].map((turn) => snake.angle + turn),
  ];
  let chosen = snake.angle,
    best = Infinity;
  for (const target of candidates) {
    let score = angleDelta(target, desired) ** 2 * 7 + angleDelta(snake.angle, target) ** 2 * 2;
    let angle = snake.angle,
      velocity = snake.turnVelocity ?? 0;
    const projected = { ...head };
    for (let step = 0; step < 6; step++) {
      const turn = smoothTurn(angle, target, velocity, Math.min(8.4, 156 / (radius * 1.6)), 0.12);
      angle = turn.angle;
      velocity = turn.velocity;
      projected.x += Math.cos(angle) * 156 * 0.12;
      projected.y += Math.sin(angle) * 156 * 0.12;
      const wall = world - Math.hypot(projected.x, projected.y) - radius;
      if (wall < 80) score += (80 - wall) ** 2;
      for (const body of nearby) {
        const clearance = distance(projected, body.a, body.b) - body.radius - radius;
        if (clearance < 34) score += (34 - clearance) ** 2 * (clearance < 0 ? 15 : 0.6);
      }
    }
    if (score < best) {
      best = score;
      chosen = target;
    }
  }
  return chosen;
}
