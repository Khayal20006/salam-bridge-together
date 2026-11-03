import { MAX_PLAYERS, BOT_COUNT, type Snapshot, type Snake, type Food } from "./engine.ts";

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
};

export function packSnapshot(
  current: Snapshot,
  previous?: Snapshot,
  view?: { id: string; radius: number },
): WireSnapshot {
  const full = !previous || current.tick % 30 === 0;
  const oldFoods = new Map(previous?.foods.map((f) => [f.id, f]));
  const currentIds = new Set(current.foods.map((f) => f.id));
  const focus = view && current.snakes.find((s) => s.id === view.id)?.pts[0];
  return {
    v: PROTOCOL,
    tick: current.tick,
    base: full ? null : previous!.tick,
    snakes: current.snakes.map((s): PackedSnake => {
      // Far-away players remain on the minimap and leaderboard. Send full bodies only near the view.
      const visible =
        !view ||
        !focus ||
        s.id === view.id ||
        s.pts.some(
          (p) => Math.abs(p.x - focus.x) < view.radius && Math.abs(p.y - focus.y) < view.radius,
        );
      const points = visible ? s.pts : s.pts.slice(0, 1);
      return [
        s.id,
        s.name,
        s.skin,
        s.angle,
        s.len,
        Math.round(s.hue),
        s.bot,
        s.boost,
        points.flatMap((p) => [Math.round(p.x), Math.round(p.y)]),
        s.spawnTick ?? 0,
      ];
    }),
    foods: current.foods
      .filter((f) => {
        const old = oldFoods.get(f.id);
        return (
          full ||
          !old ||
          Math.round(old.x) !== Math.round(f.x) ||
          Math.round(old.y) !== Math.round(f.y) ||
          old.r !== f.r ||
          old.hue !== f.hue ||
          old.v !== f.v
        );
      })
      .map((f): PackedFood => [f.id, Math.round(f.x), Math.round(f.y), f.r, f.hue, f.v]),
    removed: full ? [] : [...oldFoods.keys()].filter((id) => !currentIds.has(id)),
    deaths: current.deaths.map((d) => [d.id, d.len, d.tick]),
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
  const nextFoods = new Map<number, Food>(
    base === null ? [] : previous?.foods.map((f) => [f.id, f]),
  );
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
    nextFoods.set(f[0], { id: f[0], x: f[1], y: f[2], r: f[3], hue: f[4], v: f[5] });
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
  return { tick, snakes: result, foods: [...nextFoods.values()], deaths: nextDeaths };
}
