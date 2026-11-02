export const WORLD = 3000;
export const STEP_MS = 1000 / 30;
export const SEG = 8;
export const MAX_PLAYERS = 50;
export const BOT_COUNT = 18;
export const BASE_SPEED = 156;
export const BOOST_SPEED = 420;
const FOOD_TARGET = 900,
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
  name: string;
  pts: Point[];
  angle: number;
  target: number;
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
  7 + Math.min(34, Math.sqrt(Math.max(0, s.len)) * 1.15);
export const segmentCount = (len: number) =>
  Math.floor(10 + Math.min(230, Math.sqrt(Math.max(0, len - 10)) * 11.5));
export const cloneSnake = (s: Snake): Snake => ({ ...s, pts: s.pts.map((p) => ({ ...p })) });

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

class SpatialGrid<T> {
  private cells = new Map<string, T[]>();
  private size: number;
  constructor(size: number) {
    this.size = size;
  }
  insert(minX: number, minY: number, maxX: number, maxY: number, value: T): void {
    for (let y = Math.floor(minY / this.size); y <= Math.floor(maxY / this.size); y++) {
      for (let x = Math.floor(minX / this.size); x <= Math.floor(maxX / this.size); x++) {
        const key = `${x}:${y}`,
          cell = this.cells.get(key);
        if (cell) cell.push(value);
        else this.cells.set(key, [value]);
      }
    }
  }
  query(minX: number, minY: number, maxX: number, maxY: number): Set<T> {
    const found = new Set<T>();
    for (let y = Math.floor(minY / this.size); y <= Math.floor(maxY / this.size); y++) {
      for (let x = Math.floor(minX / this.size); x <= Math.floor(maxX / this.size); x++) {
        for (const value of this.cells.get(`${x}:${y}`) ?? []) found.add(value);
      }
    }
    return found;
  }
}

export class Arena {
  readonly snakes = new Map<string, Snake>();
  readonly foods = new Map<number, Food>();
  readonly deaths: Death[] = [];
  tick = 0;
  private foodId = 0;
  private inputs = new Map<string, number>();
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
  private food(p = this.position(), v = 0.3): void {
    if (this.foods.size >= FOOD_LIMIT) return;
    const id = ++this.foodId;
    this.foods.set(id, {
      ...p,
      id,
      v,
      hue: Math.floor(this.random() * 24),
      r: Math.min(12, 3 + Math.sqrt(v) * 1.4),
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
    const previous = new Map<string, Point>();
    const foodGrid = new SpatialGrid<Food>(120);
    for (const f of this.foods.values()) foodGrid.insert(f.x, f.y, f.x, f.y, f);
    for (const s of this.snakes.values()) {
      const head = s.pts[0]!;
      previous.set(s.id, { ...head });
      if (s.bot && this.tick % 6 === 0) {
        let nearest: Food | undefined,
          distance = Infinity;
        for (const f of foodGrid.query(head.x - 400, head.y - 400, head.x + 400, head.y + 400)) {
          const d = (head.x - f.x) ** 2 + (head.y - f.y) ** 2;
          if (d < distance) {
            nearest = f;
            distance = d;
          }
        }
        if (nearest) s.target = Math.atan2(nearest.y - head.y, nearest.x - head.x);
        for (const other of this.snakes.values()) {
          if (s === other) continue;
          const danger = other.pts.find(
            (p, i) =>
              i % 4 === 0 &&
              (p.x - head.x) ** 2 + (p.y - head.y) ** 2 < (snakeWidth(other) + 90) ** 2,
          );
          if (danger) {
            s.target = Math.atan2(head.y - danger.y, head.x - danger.x);
            break;
          }
        }
        if (Math.hypot(head.x, head.y) > WORLD - 300) s.target = Math.atan2(-head.y, -head.x);
      }
      const turn = Math.atan2(Math.sin(s.target - s.angle), Math.cos(s.target - s.angle));
      s.angle += Math.max(-0.18, Math.min(0.18, turn));
      s.boost = s.boost && s.len > 12;
      const speed = (s.boost ? BOOST_SPEED : BASE_SPEED) / 30;
      if (s.boost) {
        s.len = Math.max(10, s.len - 0.16);
        if (this.tick % 5 === 0) this.food({ ...s.pts.at(-1)! }, 0.5);
      }
      s.pts[0] = { x: head.x + Math.cos(s.angle) * speed, y: head.y + Math.sin(s.angle) * speed };
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1]!,
          b = s.pts[i]!,
          dx = b.x - a.x,
          dy = b.y - a.y,
          length = Math.hypot(dx, dy);
        if (length > SEG) {
          b.x = a.x + (dx / length) * SEG;
          b.y = a.y + (dy / length) * SEG;
        }
      }
    }
    // All deaths are decided from the same tick, then applied together.
    const dead = new Set<string>();
    type Body = { id: string; a: Point; b: Point; radius: number };
    const bodies = new SpatialGrid<Body>(100);
    for (const s of this.snakes.values()) {
      for (let i = 2; i < s.pts.length; i++) {
        const a = s.pts[i - 1]!,
          b = s.pts[i]!,
          radius = snakeWidth(s);
        bodies.insert(
          Math.min(a.x, b.x) - radius,
          Math.min(a.y, b.y) - radius,
          Math.max(a.x, b.x) + radius,
          Math.max(a.y, b.y) + radius,
          { id: s.id, a, b, radius },
        );
      }
    }
    const snakes = [...this.snakes.values()];
    for (let i = 0; i < snakes.length; i++) {
      const s = snakes[i]!,
        head = s.pts[0]!,
        old = previous.get(s.id)!,
        radius = snakeWidth(s) * 0.6;
      if (Math.hypot(head.x, head.y) + radius >= WORLD) dead.add(s.id);
      for (let j = i + 1; j < snakes.length; j++) {
        const other = snakes[j]!,
          a = previous.get(other.id)!,
          b = other.pts[0]!;
        // Relative swept motion prevents head-on tunnelling at boost speed.
        if (
          pointSegmentDistanceSquared(
            { x: 0, y: 0 },
            { x: old.x - a.x, y: old.y - a.y },
            { x: head.x - b.x, y: head.y - b.y },
          ) <
          (radius + snakeWidth(other) * 0.6) ** 2
        ) {
          dead.add(s.id);
          dead.add(other.id);
        }
      }
      for (const body of bodies.query(
        Math.min(old.x, head.x) - radius,
        Math.min(old.y, head.y) - radius,
        Math.max(old.x, head.x) + radius,
        Math.max(old.y, head.y) + radius,
      )) {
        if (
          body.id !== s.id &&
          segmentsDistanceSquared(old, head, body.a, body.b) < (radius + body.radius) ** 2
        ) {
          dead.add(s.id);
          break;
        }
      }
    }
    for (const s of snakes) {
      if (dead.has(s.id)) {
        this.deaths.push({ id: s.id, len: s.len, tick: this.tick });
        for (let i = 0; i < s.pts.length; i += 3)
          this.food({ ...s.pts[i]! }, Math.min(8, 2 + s.len / 60));
        this.leave(s.id);
        continue;
      }
      const head = s.pts[0]!,
        radius = snakeWidth(s) + 14;
      for (const f of foodGrid.query(
        head.x - radius,
        head.y - radius,
        head.x + radius,
        head.y + radius,
      )) {
        if (!this.foods.has(f.id)) continue;
        if ((f.x - head.x) ** 2 + (f.y - head.y) ** 2 < radius ** 2) {
          s.len += f.v * (s.bot ? 0.7 : 1);
          this.foods.delete(f.id);
        }
      }
      const want = segmentCount(s.len);
      while (s.pts.length < want) s.pts.push({ ...s.pts.at(-1)! });
      s.pts.length = want;
    }
    while (this.deaths.length && this.deaths[0]!.tick < this.tick - 300) this.deaths.shift();
    this.replenishFood();
    if (this.tick % 15 === 0) this.ensureBots();
  }
  snapshot(): Snapshot {
    return {
      tick: this.tick,
      snakes: [...this.snakes.values()].map(cloneSnake),
      foods: [...this.foods.values()].map((f) => ({ ...f })),
      deaths: this.deaths.map((d) => ({ ...d })),
    };
  }
  restore(snapshot: Snapshot): void {
    this.tick = snapshot.tick;
    this.snakes.clear();
    this.foods.clear();
    this.inputs.clear();
    for (const s of snapshot.snakes) this.snakes.set(s.id, cloneSnake(s));
    this.foodId = 0;
    for (const f of snapshot.foods) {
      this.foods.set(f.id, { ...f });
      this.foodId = Math.max(this.foodId, f.id);
    }
    this.deaths.splice(0, this.deaths.length, ...snapshot.deaths.map((d) => ({ ...d })));
  }
}
