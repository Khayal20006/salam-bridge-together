import { describe, expect, it } from "vitest";
import { botGoal, botHeading, type BotMemory, type Obstacle } from "./bot-navigation";
import { angleDelta } from "./movement";
import type { Food, Snake } from "./engine";

const snake = (): Snake => ({
  id: "bot-0",
  name: "Bot",
  pts: [{ x: 0, y: 0 }],
  angle: 0,
  target: 0,
  len: 20,
  hue: 0,
  bot: true,
  boost: false,
  skin: "hue",
});
const food = (id: number, x: number, y: number): Food => ({ id, x, y, r: 4, hue: 0, v: 0.3 });

describe("bot navigation", () => {
  it("chooses food ahead instead of repeatedly turning back toward a closer pellet", () => {
    const foods = new Map([food(1, -25, 0), food(2, 200, 0)].map((f) => [f.id, f]));
    const memory = botGoal(snake(), foods.values(), foods, undefined, 6);
    expect(memory.food).toBe(2);
    foods.set(3, food(3, 15, 40));
    expect(botGoal(snake(), foods.values(), foods, memory, 12).food).toBe(2);
  });
  it("does not steer away from a body behind its neck", () => {
    const obstacle: Obstacle = {
      id: "other",
      a: { x: -70, y: -30 },
      b: { x: -70, y: 30 },
      radius: 11,
    };
    expect(botHeading(snake(), { x: 500, y: 0 }, [obstacle], 3000)).toBeCloseTo(0);
  });
  it("chooses a curved detour before reaching a body directly ahead", () => {
    const obstacle: Obstacle = {
      id: "other",
      a: { x: 80, y: -100 },
      b: { x: 80, y: 100 },
      radius: 11,
    };
    expect(
      Math.abs(angleDelta(0, botHeading(snake(), { x: 500, y: 0 }, [obstacle], 3000))),
    ).toBeGreaterThan(0.4);
  });
  it("abandons a goal after circling instead of chasing it indefinitely", () => {
    const memory: BotMemory = {
      goal: { x: 5, y: 5 },
      food: 1,
      until: 200,
      anchor: { x: 0, y: 0 },
      anchorTick: 0,
    };
    const foods = new Map([[1, food(1, 5, 5)]]);
    const escape = botGoal(snake(), foods.values(), foods, memory, 90);
    expect(escape.food).toBeNull();
    expect(escape.goal.x).toBeGreaterThan(500);
    expect(escape.until).toBeGreaterThan(90);
  });
  it("heads back inside the boundary before hitting it", () => {
    const bot = snake();
    bot.pts[0] = { x: 2910, y: 0 };
    expect(Math.abs(angleDelta(0, botHeading(bot, { x: 3500, y: 0 }, [], 3000)))).toBeGreaterThan(
      1,
    );
  });
});
