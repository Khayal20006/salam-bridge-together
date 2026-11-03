import { MAX_PLAYERS, BOT_COUNT, type Snapshot, type Snake, type Food } from "./engine.ts";
import { snapshotIndex } from "./snapshot-index.ts";

export const PROTOCOL = 2;
type PackedSnake = [
  string,
  string,
  string,
  number,
  number,
  number,
  boolean,
  boolean,
  number[],
  number,
];
type PackedFood = [number, number, number, number, number, number];
export type WireSnapshot = {
  v: 2;
  tick: number;
  base: number | null;
  snakes: PackedSnake[];
  foods: PackedFood[];
  removed: number[];
  deaths: [string, number, number][];
  motion?: [string, number, number, number][];
};

type FoodPacket = { foods: PackedFood[]; removed: number[] };
type PackedFrame = {
  snakes: {
    source: Snake;
    full: PackedSnake;
    head: PackedSnake;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }[];
  deaths: WireSnapshot["deaths"];
  motion: NonNullable<WireSnapshot["motion"]>;
  fullFood?: FoodPacket;
  deltas: WeakMap<Snapshot, FoodPacket>;
};
// Snapshot and packed contents are immutable while retained. Share only within
// that exact snapshot; weak keys release caches when the bounded history does.
const packedFrames = new WeakMap<Snapshot, PackedFrame>();
function packedFrame(snapshot: Snapshot): PackedFrame {
  let frame = packedFrames.get(snapshot);
  if (frame) return frame;
  frame = {
    snakes: snapshot.snakes.map((s) => {
      const points = new Array<number>(s.pts.length * 2);
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let i = 0; i < s.pts.length; i++) {
        const p = s.pts[i]!;
        points[i * 2] = Math.round(p.x);
        points[i * 2 + 1] = Math.round(p.y);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const full: PackedSnake = [
        s.id,
        s.name,
        s.skin,
        s.angle,
        s.len,
        Math.round(s.hue),
        s.bot,
        s.boost,
        points,
        s.spawnTick ?? 0,
      ];
      const head: PackedSnake = [...full];
      head[8] = points.slice(0, 2);
      return { source: s, full, head, minX, minY, maxX, maxY };
    }),
    deaths: snapshot.deaths.map((d) => [d.id, d.len, d.tick]),
    motion: snapshot.snakes
      .filter((s) => !s.bot)
      .map((s) => [s.id, s.inputSeq ?? 0, s.target, s.turnVelocity ?? 0]),
    deltas: new WeakMap(),
  };
  packedFrames.set(snapshot, frame);
  return frame;
}

function packedFood(
  current: Snapshot,
  previous: Snapshot | undefined,
  frame: PackedFrame,
): FoodPacket {
  if (!previous) {
    return (frame.fullFood ??= {
      foods: current.foods.map((f) => [f.id, Math.round(f.x), Math.round(f.y), f.r, f.hue, f.v]),
      removed: [],
    });
  }
  let packet = frame.deltas.get(previous);
  if (packet) return packet;
  const oldFoods = snapshotIndex(previous).foods;
  const currentFoods = snapshotIndex(current).foods;
  const foods: PackedFood[] = [];
  for (const f of current.foods) {
    const old = oldFoods.get(f.id);
    if (
      !old ||
      Math.round(old.x) !== Math.round(f.x) ||
      Math.round(old.y) !== Math.round(f.y) ||
      old.r !== f.r ||
      old.hue !== f.hue ||
      old.v !== f.v
    )
      foods.push([f.id, Math.round(f.x), Math.round(f.y), f.r, f.hue, f.v]);
  }
  const removed: number[] = [];
  for (const id of oldFoods.keys()) if (!currentFoods.has(id)) removed.push(id);
  packet = { foods, removed };
  frame.deltas.set(previous, packet);
  return packet;
}

export function packSnapshot(
  current: Snapshot,
  previous?: Snapshot,
  view?: { id: string; radius: number },
): WireSnapshot {
  const full = !previous || current.tick % 30 === 0;
  const frame = packedFrame(current);
  const { foods, removed } = packedFood(current, full ? undefined : previous, frame);
  const focus = view && current.snakes.find((s) => s.id === view.id)?.pts[0];
  return {
    v: PROTOCOL,
    tick: current.tick,
    base: full ? null : previous!.tick,
    snakes: frame.snakes.map((packed): PackedSnake => {
      const s = packed.source;
      // Far-away players remain on the minimap and leaderboard. Send full bodies only near the view.
      const visible =
        !view ||
        !focus ||
        s.id === view.id ||
        (packed.maxX > focus.x - view.radius &&
          packed.minX < focus.x + view.radius &&
          packed.maxY > focus.y - view.radius &&
          packed.minY < focus.y + view.radius &&
          s.pts.some(
            (p) => Math.abs(p.x - focus.x) < view.radius && Math.abs(p.y - focus.y) < view.radius,
          ));
      return visible ? packed.full : packed.head;
    }),
    foods,
    removed,
    deaths: frame.deaths,
    motion: view ? frame.motion.filter((m) => m[0] === view.id) : frame.motion,
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9-]{1,80}$/i.test(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const array = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;

/** A rejected delta leaves the previous snapshot untouched; request a keyframe. */
export function unpackSnapshot(value: unknown, previous?: Snapshot): Snapshot | null {
  if (!value || typeof value !== "object") return null;
  const w = value as Record<string, unknown>;
  const tick = w["tick"],
    base = w["base"],
    snakes = w["snakes"],
    foods = w["foods"],
    removed = w["removed"],
    deaths = w["deaths"];
  if (
    w["v"] !== PROTOCOL ||
    !integer(tick) ||
    (base !== null && (!integer(base) || base !== previous?.tick)) ||
    !array(snakes, MAX_PLAYERS + BOT_COUNT) ||
    !array(foods, 1800) ||
    !array(removed, 1800) ||
    !array(deaths, 4096)
  )
    return null;
  const result: Snake[] = [],
    seen = new Set<string>();
  for (const s of snakes) {
    if (
      !array(s, 10) ||
      s.length !== 10 ||
      !id(s[0]) ||
      seen.has(s[0]) ||
      !text(s[1], 14) ||
      !text(s[2], 40) ||
      !finite(s[3]) ||
      !finite(s[4]) ||
      s[4] < 0 ||
      s[4] > 10_000_000 ||
      !finite(s[5]) ||
      typeof s[6] !== "boolean" ||
      typeof s[7] !== "boolean" ||
      !integer(s[9]) ||
      s[9] > tick ||
      !array(s[8], 480) ||
      s[8].length < 2 ||
      s[8].length % 2
    )
      return null;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < s[8].length; i += 2) {
      const x = s[8][i],
        y = s[8][i + 1];
      if (!finite(x) || !finite(y) || Math.abs(x) > 6000 || Math.abs(y) > 6000) return null;
      pts.push({ x, y });
    }
    seen.add(s[0]);
    result.push({
      id: s[0],
      spawnTick: s[9],
      name: s[1],
      skin: s[2],
      angle: s[3],
      target: s[3],
      len: s[4],
      hue: s[5],
      bot: s[6],
      boost: s[7],
      pts,
    });
  }
  const oldFoods = previous ? snapshotIndex(previous).foods : undefined;
  const nextFoods = new Map<number, Food>(base === null ? undefined : oldFoods);
  for (const key of removed) {
    if (!integer(key)) return null;
    nextFoods.delete(key);
  }
  for (const f of foods) {
    if (
      !array(f, 6) ||
      f.length !== 6 ||
      !integer(f[0]) ||
      !finite(f[1]) ||
      !finite(f[2]) ||
      Math.abs(f[1]) > 6000 ||
      Math.abs(f[2]) > 6000 ||
      !finite(f[3]) ||
      f[3] <= 0 ||
      f[3] > 20 ||
      !integer(f[4]) ||
      f[4] >= 24 ||
      !finite(f[5]) ||
      f[5] < 0 ||
      f[5] > 100
    )
      return null;
    const old = oldFoods?.get(f[0]);
    nextFoods.set(
      f[0],
      old &&
        old.x === f[1] &&
        old.y === f[2] &&
        old.r === f[3] &&
        old.hue === f[4] &&
        old.v === f[5]
        ? old
        : { id: f[0], x: f[1], y: f[2], r: f[3], hue: f[4], v: f[5] },
    );
  }
  if (nextFoods.size > 1800) return null;
  const nextDeaths: Snapshot["deaths"] = [];
  for (const d of deaths) {
    if (
      !array(d, 3) ||
      d.length !== 3 ||
      !id(d[0]) ||
      !finite(d[1]) ||
      d[1] < 0 ||
      !integer(d[2]) ||
      d[2] > tick
    )
      return null;
    nextDeaths.push({ id: d[0], len: d[1], tick: d[2] });
  }
  const motion = w["motion"];
  if (motion !== undefined) {
    if (!array(motion, MAX_PLAYERS)) return null;
    const indexed = new Map(result.map((s) => [s.id, s])),
      seenMotion = new Set<string>();
    for (const m of motion) {
      if (
        !array(m, 4) ||
        m.length !== 4 ||
        !id(m[0]) ||
        !integer(m[1]) ||
        !finite(m[2]) ||
        !finite(m[3]) ||
        seenMotion.has(m[0])
      )
        return null;
      const snake = indexed.get(m[0]);
      if (!snake || snake.bot) return null;
      seenMotion.add(m[0]);
      snake.inputSeq = m[1];
      snake.target = m[2];
      snake.turnVelocity = m[3];
    }
  }
  return { tick, snakes: result, foods: [...nextFoods.values()], deaths: nextDeaths };
}
