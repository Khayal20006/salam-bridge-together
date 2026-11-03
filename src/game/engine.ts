import { BodyTrail, smoothTurn } from "./movement.ts";
import { botGoal, botHeading, type BotMemory, type Obstacle } from "./bot-navigation.ts";
import { SpatialGrid } from "./spatial-grid.ts";

export const WORLD = 3000;
export const STEP_MS = 1000 / 30;
export const SEG = 8;
export const MAX_PLAYERS = 50;
export const BOT_COUNT = 18;
export const BASE_SPEED = 156;
export const BOOST_SPEED = 320;
export const SPAWN_PROTECTION_TICKS = 45;
const TURN_RATE = 8.4;
const BOOST_TURN_MULTIPLIER = 1.2;
const FOOD_GROWTH_MULTIPLIER = 2.5;
const COLLISION_SCALE = 0.8;
const FOOD_PULL_PER_TICK = 1 - Math.pow(0.88, STEP_MS / (1000 / 60));
const FOOD_TARGET = 1000,
  FOOD_LIMIT = 1800;
const NAMES = [
  "Nağı",
  "Leyla",
  "Viper",
  "Kobra",
  "Aysel",
  "Orxan",
  "Neon",
  "Zəhra",
  "Shadow",
  "Murad",
  "Toxic",
  "Elvin",
  "Rəşad",
  "Nova",
  "Fidan",
  "Blitz",
  "Kamran",
  "Ruby",
];
const BOT_SKINS = ["fire", "ice", "az", "lava", "dragon", "cosmos", "tiger", "kingaz"];

export type Point = { x: number; y: number };
export type Food = Point & { id: number; r: number; hue: number; v: number };
export type Snake = {
  id: string;
  inputSeq?: number;
  spawnTick?: number;
  name: string;
  pts: Point[];
  angle: number;
  target: number;
  turnVelocity?: number;
  len: number;
  hue: number;
  bot: boolean;
  boost: boolean;
  skin: string;
};
export type Death = { id: string; len: number; tick: number };
export type Snapshot = { tick: number; snakes: Snake[]; foods: Food[]; deaths: Death[] };
export type Input = { seq: number; angle: number; boost: boolean };
export const snakeWidth = (s: Pick<Snake, "len">) =>
  11 + Math.log2(1 + Math.max(0, s.len - 10) / 40) * 3;
export const isSpawnProtected = (s: Pick<Snake, "spawnTick">, tick: number) =>
  s.spawnTick !== undefined && tick < s.spawnTick + SPAWN_PROTECTION_TICKS;
export const segmentCount = (len: number) =>
  Math.floor(10 + Math.min(230, Math.max(0, len - 10) * 1.1));
export const cloneSnake = (s: Snake): Snake => ({ ...s, pts: s.pts.map((p) => ({ ...p })) });

/** Shared visual/authoritative kinematics; food and collision decisions stay in Arena. */
export function advanceHead(s: Snake, seconds: number): Point {
  s.boost = s.boost && s.len > 12;
  const speed = s.boost ? BOOST_SPEED : BASE_SPEED;
  const maxRate = Math.min(
    TURN_RATE * (s.boost ? BOOST_TURN_MULTIPLIER : 1),
    speed / (snakeWidth(s) * 1.6),
  );
  const steering = smoothTurn(s.angle, s.target, s.turnVelocity ?? 0, maxRate, seconds);
  s.angle = steering.angle;
  s.turnVelocity = steering.velocity;
  const head = s.pts[0]!;
  return {
    x: head.x + Math.cos(s.angle) * speed * seconds,
    y: head.y + Math.sin(s.angle) * speed * seconds,
  };
}

export function pointSegmentDistanceSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function segmentsDistanceSquared(a: Point, b: Point, c: Point, d: Point): number {
  // Strict intersection; collinear disjoint segments must use endpoint distances.
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(
    pointSegmentDistanceSquared(a, c, d),
    pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b),
    pointSegmentDistanceSquared(d, a, b),
  );
}

export class Arena {
  readonly snakes = new Map<string, Snake>();
  readonly foods = new Map<number, Food>();
  readonly deaths: Death[] = [];
  tick = 0;
  private foodId = 0;
  private inputs = new Map<string, number>();
  private trails = new Map<string, BodyTrail>();
  private botMemory = new Map<string, BotMemory>();
  private foodSnapshots = new WeakMap<Food, Food>();
  private foodGrid = new SpatialGrid<Food>(120);
  private navigationGrid = new SpatialGrid<Obstacle>(120);
  private bodyGrid = new SpatialGrid<Obstacle>(100);
  private foodCandidates = new Set<Food>();
  private navigationCandidates = new Set<Obstacle>();
  private bodyCandidates = new Set<Obstacle>();
  private navigationBodies: Obstacle[] = [];
  private collisionBodies: Obstacle[] = [];
  private previousHeads = new Map<string, Point>();
  private collisionWidths = new Map<string, number>();
  private relativeStart = { x: 0, y: 0 };
  private relativeEnd = { x: 0, y: 0 };
  private origin = { x: 0, y: 0 };
  private random: () => number;
  constructor(random: () => number = Math.random, initialize = true) {
    this.random = random;
    if (initialize) {
      this.replenishFood();
      this.ensureBots();
    }
  }
  private position(radius = WORLD - 250): Point {
    const angle = this.random() * Math.PI * 2,
      r = Math.sqrt(this.random()) * radius;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  }
  private food(p = this.position(), v = 0.3, radius = Math.min(12, 3 + Math.sqrt(v) * 1.4)): void {
    if (this.foods.size >= FOOD_LIMIT) return;
    const id = ++this.foodId;
    this.foods.set(id, {
      ...p,
      id,
      v,
      hue: Math.floor(this.random() * 24),
      r: radius,
    });
  }
  private replenishFood(): void {
    while (this.foods.size < FOOD_TARGET) this.food();
  }
  private spawn(id: string, name: string, skin: string, bot: boolean): Snake | null {
    // Check the entire new body against the world and every existing body.
    for (let attempt = 0; attempt < 160; attempt++) {
      const head = this.position(),
        angle = this.random() * Math.PI * 2;
      const len = bot ? 10 + this.random() * 25 : 10;
      const pts = Array.from({ length: segmentCount(len) }, (_, i) => ({
        x: head.x - Math.cos(angle) * i * SEG,
        y: head.y - Math.sin(angle) * i * SEG,
      }));
      if (pts.some((p) => Math.hypot(p.x, p.y) > WORLD - 80)) continue;
      const safe = [...this.snakes.values()].every((other) => {
        const clearance = snakeWidth(other) + snakeWidth({ len }) + 100;
        return pts.every(
          (p, i) =>
            i % 3 !== 0 ||
            other.pts.every(
              (q, j) => j % 3 !== 0 || (p.x - q.x) ** 2 + (p.y - q.y) ** 2 > clearance ** 2,
            ),
        );
      });
      if (!safe) continue;
      const s: Snake = {
        id,
        spawnTick: this.tick,
        name: name.slice(0, 14) || "Oyunçu",
        pts,
        angle,
        target: angle,
        len,
        hue: this.random() * 360,
        bot,
        boost: false,
        skin,
      };
      this.snakes.set(id, s);
      this.trails.set(id, new BodyTrail(s.pts));
      this.inputs.delete(id);
      return s;
    }
    return null; // A crowded arena retries instead of spawning inside a snake.
  }
  join(id: string, name: string, skin: string): Snake | null {
    if (this.snakes.has(id)) return this.snakes.get(id)!;
    if ([...this.snakes.values()].filter((s) => !s.bot).length >= MAX_PLAYERS) return null;
    return this.spawn(id, name, skin, false);
  }
  leave(id: string): void {
    this.snakes.delete(id);
    this.inputs.delete(id);
    this.trails.delete(id);
    this.botMemory.delete(id);
  }
  input(id: string, value: Input): void {
    const s = this.snakes.get(id);
    if (
      !s ||
      s.bot ||
      !Number.isSafeInteger(value.seq) ||
      value.seq <= (this.inputs.get(id) ?? -1) ||
      !Number.isFinite(value.angle) ||
      typeof value.boost !== "boolean"
    )
      return;
    this.inputs.set(id, value.seq);
    s.inputSeq = value.seq;
    s.target = Math.atan2(Math.sin(value.angle), Math.cos(value.angle));
    s.boost = value.boost;
  }
  private ensureBots(): void {
    for (let i = 0; i < BOT_COUNT; i++) {
      const id = `bot-${i}`;
      if (!this.snakes.has(id)) this.spawn(id, NAMES[i]!, BOT_SKINS[i % BOT_SKINS.length]!, true);
    }
  }
  step(): void {
    this.tick++;
    const previous = this.previousHeads;
    previous.clear();
    const foodGrid = this.foodGrid;
    foodGrid.reset();
    for (const f of this.foods.values()) foodGrid.insert(f.x, f.y, f.x, f.y, f);
    const navigation = this.tick % 6 === 0 ? this.navigationGrid : undefined;
    if (navigation) {
      navigation.reset();
      let count = 0;
      for (const s of this.snakes.values()) {
        const radius = snakeWidth(s);
        for (let i = 1; i < s.pts.length; i += 2) {
          const a = s.pts[i - 1]!,
            b = s.pts[Math.min(i + 1, s.pts.length - 1)]!;
          const obstacle =
            this.navigationBodies[count] ??
            (this.navigationBodies[count] = { id: s.id, a, b, radius });
          obstacle.id = s.id;
          obstacle.a = a;
          obstacle.b = b;
          obstacle.radius = radius;
          count++;
          navigation.insert(
            Math.min(a.x, b.x) - radius,
            Math.min(a.y, b.y) - radius,
            Math.max(a.x, b.x) + radius,
            Math.max(a.y, b.y) + radius,
            obstacle,
          );
        }
      }
    }
    for (const s of this.snakes.values()) {
      const head = s.pts[0]!;
      previous.set(s.id, head);
      if (s.bot && navigation) {
        const nearbyFood = foodGrid.query(
          head.x - 450,
          head.y - 450,
          head.x + 450,
          head.y + 450,
          this.foodCandidates,
        );
        const memory = botGoal(s, nearbyFood, this.foods, this.botMemory.get(s.id), this.tick);
        this.botMemory.set(s.id, memory);
        const obstacles = navigation.query(
          head.x - 200,
          head.y - 200,
          head.x + 200,
          head.y + 200,
          this.navigationCandidates,
        );
        s.target = botHeading(s, memory.goal, obstacles, WORLD, snakeWidth(s));
      }
      const nextHead = advanceHead(s, STEP_MS / 1000);
      if (s.boost) {
        s.len = Math.max(10, s.len - 0.16);
        if (this.tick % 5 === 0) this.food({ ...s.pts.at(-1)! }, 0.5);
      }
      let trail = this.trails.get(s.id);
      if (!trail) {
        trail = new BodyTrail(s.pts);
        this.trails.set(s.id, trail);
      }
      s.pts = trail.advance(nextHead, segmentCount(s.len), SEG);
    }
    // All deaths are decided from the same tick, then applied together.
    const dead = new Set<string>();
    const bodies = this.bodyGrid;
    bodies.reset();
    const widths = this.collisionWidths;
    widths.clear();
    let bodyCount = 0;
    for (const s of this.snakes.values()) {
      const width = snakeWidth(s);
      widths.set(s.id, width);
      if (isSpawnProtected(s, this.tick)) continue;
      const radius = width * COLLISION_SCALE;
      for (let i = 2; i < s.pts.length; i++) {
        const a = s.pts[i - 1]!,
          b = s.pts[i]!;
        const body =
          this.collisionBodies[bodyCount] ??
          (this.collisionBodies[bodyCount] = { id: s.id, a, b, radius });
        body.id = s.id;
        body.a = a;
        body.b = b;
        body.radius = radius;
        bodyCount++;
        bodies.insert(
          Math.min(a.x, b.x) - radius,
          Math.min(a.y, b.y) - radius,
          Math.max(a.x, b.x) + radius,
          Math.max(a.y, b.y) + radius,
          body,
        );
      }
    }
    const snakes = [...this.snakes.values()];
    const headDefeats = new Map<string, Set<string>>();
    for (let i = 0; i < snakes.length; i++) {
      const s = snakes[i]!,
        head = s.pts[0]!,
        old = previous.get(s.id)!,
        radius = widths.get(s.id)! * COLLISION_SCALE;
      if (Math.hypot(head.x, head.y) + widths.get(s.id)! >= WORLD) dead.add(s.id);
      if (isSpawnProtected(s, this.tick)) continue;
      for (let j = i + 1; j < snakes.length; j++) {
        const other = snakes[j]!,
          a = previous.get(other.id)!,
          b = other.pts[0]!;
        if (isSpawnProtected(other, this.tick)) continue;
        this.relativeStart.x = old.x - a.x;
        this.relativeStart.y = old.y - a.y;
        this.relativeEnd.x = head.x - b.x;
        this.relativeEnd.y = head.y - b.y;
        // Relative swept motion prevents head-on tunnelling at boost speed.
        if (
          pointSegmentDistanceSquared(this.origin, this.relativeStart, this.relativeEnd) <
          (radius + widths.get(other.id)! * COLLISION_SCALE) ** 2
        ) {
          const difference = s.len - other.len;
          const winner =
            difference > 0.000001 || (Math.abs(difference) <= 0.000001 && s.id < other.id)
              ? s
              : other;
          const loser = winner === s ? other : s;
          dead.add(loser.id);
          let defeated = headDefeats.get(winner.id);
          if (!defeated) {
            defeated = new Set();
            headDefeats.set(winner.id, defeated);
          }
          defeated.add(loser.id);
        }
      }
    }
    for (const s of snakes) {
      if (dead.has(s.id) || isSpawnProtected(s, this.tick)) continue;
      const head = s.pts[0]!,
        old = previous.get(s.id)!,
        radius = widths.get(s.id)! * COLLISION_SCALE;
      for (const body of bodies.query(
        Math.min(old.x, head.x) - radius,
        Math.min(old.y, head.y) - radius,
        Math.max(old.x, head.x) + radius,
        Math.max(old.y, head.y) + radius,
        this.bodyCandidates,
      )) {
        if (
          body.id !== s.id &&
          !headDefeats.get(s.id)?.has(body.id) &&
          segmentsDistanceSquared(old, head, body.a, body.b) < (radius + body.radius) ** 2
        ) {
          dead.add(s.id);
          break;
        }
      }
    }
    const foodTargets = new Map<
      number,
      { food: Food; snake: Snake; mouth: Point; distance: number }
    >();
    for (const s of snakes) {
      if (dead.has(s.id)) {
        this.deaths.push({ id: s.id, len: s.len, tick: this.tick });
        const drops = Math.ceil(s.pts.length / 3);
        // Visible remains scale with the dead snake; recovered growth is bounded
        // independently so a large-looking pellet cannot multiply mass on death.
        const value = Math.min(
          8,
          Math.max(0.3, (Math.max(0, s.len - 10) * 0.55) / (drops * FOOD_GROWTH_MULTIPLIER)),
        );
        const radius = Math.min(16, 3 + (snakeWidth(s) - 11) * 1.25);
        for (let i = 0; i < s.pts.length; i += 3) this.food({ ...s.pts[i]! }, value, radius);
        this.leave(s.id);
        continue;
      }
      const head = s.pts[0]!,
        width = widths.get(s.id)!;
      const mouth = {
        x: head.x + Math.cos(s.angle) * width * 0.8,
        y: head.y + Math.sin(s.angle) * width * 0.8,
      };
      const range = (width + 14) * 3;
      for (const f of foodGrid.query(
        mouth.x - range,
        mouth.y - range,
        mouth.x + range,
        mouth.y + range,
        this.foodCandidates,
      )) {
        if (!this.foods.has(f.id)) continue;
        const distance = (f.x - mouth.x) ** 2 + (f.y - mouth.y) ** 2;
        if (distance >= range * range) continue;
        const target = foodTargets.get(f.id);
        if (
          !target ||
          distance < target.distance - 0.000001 ||
          (Math.abs(distance - target.distance) <= 0.000001 && s.id < target.snake.id)
        ) {
          foodTargets.set(f.id, { food: f, snake: s, mouth, distance });
        }
      }
    }
    // Choose one nearest mouth per food, then move once; the spatial grid stays valid during queries.
    for (const { food, snake, mouth, distance } of foodTargets.values()) {
      const eatRadius = snakeWidth(snake) + food.r;
      if (distance < eatRadius * eatRadius) {
        snake.len += food.v * FOOD_GROWTH_MULTIPLIER * (snake.bot ? 0.7 : 1);
        this.foods.delete(food.id);
      } else {
        food.x += (mouth.x - food.x) * FOOD_PULL_PER_TICK;
        food.y += (mouth.y - food.y) * FOOD_PULL_PER_TICK;
      }
    }
    while (this.deaths.length && this.deaths[0]!.tick < this.tick - 300) this.deaths.shift();
    this.replenishFood();
    if (this.tick % 15 === 0) this.ensureBots();
  }
  snapshot(): Snapshot {
    const foods: Food[] = [];
    for (const food of this.foods.values()) {
      let saved = this.foodSnapshots.get(food);
      if (
        !saved ||
        saved.x !== food.x ||
        saved.y !== food.y ||
        saved.r !== food.r ||
        saved.hue !== food.hue ||
        saved.v !== food.v ||
        saved.id !== food.id
      ) {
        saved = { ...food };
        this.foodSnapshots.set(food, saved);
      }
      foods.push(saved);
    }
    return {
      tick: this.tick,
      // Movement replaces pts with a fresh travelled path; it never edits an old path.
      // Copy mutable metadata, while retaining the immutable path for older frames.
      snakes: [...this.snakes.values()].map((s) => ({ ...s })),
      foods,
      deaths: this.deaths.map((d) => ({ ...d })),
    };
  }
  restore(snapshot: Snapshot): void {
    this.tick = snapshot.tick;
    this.snakes.clear();
    this.foods.clear();
    this.inputs.clear();
    this.trails.clear();
    this.botMemory.clear();
    this.foodSnapshots = new WeakMap();
    for (const s of snapshot.snakes) {
      this.snakes.set(s.id, cloneSnake(s));
      if (s.inputSeq !== undefined) this.inputs.set(s.id, s.inputSeq);
      this.trails.set(s.id, new BodyTrail(s.pts));
    }
    this.foodId = 0;
    for (const f of snapshot.foods) {
      this.foods.set(f.id, { ...f });
      this.foodId = Math.max(this.foodId, f.id);
    }
    this.deaths.splice(0, this.deaths.length, ...snapshot.deaths.map((d) => ({ ...d })));
  }
}
