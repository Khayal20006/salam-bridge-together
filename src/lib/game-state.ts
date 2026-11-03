import { SKIN_BY } from "./skins";

export type GameConfig = {
  quality: "low" | "medium" | "high";
  grid: boolean;
  glow: boolean;
  boostFx: boolean;
  names: boolean;
  minimap: boolean;
  showFps: boolean;
};

export const DEFAULT_CONFIG: GameConfig = {
  quality: "medium",
  grid: false,
  glow: false,
  boostFx: false,
  names: true,
  minimap: true,
  showFps: false,
};

/** Visual effects are opt-in; plain surfaces keep the arena fast like slither.io. */
const CONFIG_REVISION = "2";

/** Phones get a cheap first-run preset; saved settings still win. */
export function deviceConfig(): GameConfig {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return DEFAULT_CONFIG;
  return window.matchMedia("(pointer: coarse)").matches
    ? { ...DEFAULT_CONFIG, quality: "low", grid: false, glow: false }
    : DEFAULT_CONFIG;
}

const PAID_IDS = new Set(["rgb", "plasma", "legend"]);
export type Progress = { coins: number; owned: string[]; skin: string };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Play still works without storage. */
  }
}

function parse(value: string | null): unknown {
  try {
    return value === null ? null : JSON.parse(value);
  } catch {
    return null;
  }
}

export function normalizeConfig(value: unknown, fallback: GameConfig = DEFAULT_CONFIG): GameConfig {
  const config = { ...fallback };
  if (!record(value)) return config;
  if (value["quality"] === "low" || value["quality"] === "medium" || value["quality"] === "high") {
    config.quality = value["quality"];
  }
  for (const key of ["grid", "glow", "boostFx", "names", "minimap", "showFps"] as const) {
    if (typeof value[key] === "boolean") config[key] = value[key];
  }
  return config;
}

export function loadConfig(): GameConfig {
  const saved = parse(readStorage("neon-cfg")),
    fallback = deviceConfig();
  if (readStorage("neon-cfg-rev") === CONFIG_REVISION) return normalizeConfig(saved, fallback);
  const config = normalizeConfig(saved, fallback);
  // One-time migration: older builds defaulted to glow, grid and boost effects,
  // which made weaker phones stutter. Keep the chosen quality but start plain.
  const migrated: GameConfig = {
    ...config,
    grid: false,
    glow: false,
    boostFx: false,
    quality: fallback.quality === "low" ? "low" : config.quality,
  };
  writeStorage("neon-cfg", JSON.stringify(migrated));
  writeStorage("neon-cfg-rev", CONFIG_REVISION);
  return migrated;
}

export function normalizeProgress(value: unknown): Progress {
  if (!record(value)) return { coins: 0, owned: ["hue"], skin: "hue" };
  const coins = value["coins"];
  const owned = ["hue", ...(Array.isArray(value["owned"]) ? value["owned"] : [])];
  const validOwned = [
    ...new Set(
      owned.filter(
        (id): id is string =>
          typeof id === "string" && Object.hasOwn(SKIN_BY, id) && !PAID_IDS.has(id),
      ),
    ),
  ];
  const skin = value["skin"];
  return {
    coins:
      typeof coins === "number" && Number.isFinite(coins)
        ? Math.max(0, Math.min(2_147_483_647, Math.floor(coins)))
        : 0,
    owned: validOwned,
    skin:
      typeof skin === "string" && (validOwned.includes(skin) || PAID_IDS.has(skin)) ? skin : "hue",
  };
}

const progressKey = (uid: string | null) => `neon-progress:${uid ?? "guest"}`;

export function loadProgress(uid: string | null = null): Progress {
  const saved = readStorage(progressKey(uid));
  if (saved !== null) return normalizeProgress(parse(saved));
  // Migrate old shared keys only to their recorded owner.
  const owner = readStorage("neon-synced");
  if (owner === uid || (!owner && uid === null)) {
    return normalizeProgress({
      coins: Number(readStorage("neon-coins") ?? 0),
      owned: parse(readStorage("neon-owned")),
      skin: readStorage("neon-skin"),
    });
  }
  return normalizeProgress(null);
}

export function saveProgress(value: Progress, uid: string | null): void {
  writeStorage(progressKey(uid), JSON.stringify(normalizeProgress(value)));
}

export function electHost(
  presence: Record<string, { at?: number; visible?: boolean; capable?: boolean }[]>,
): string | null {
  let host: string | null = null,
    first = Infinity,
    priority = Infinity;
  for (const [key, entries] of Object.entries(presence)) {
    const at = entries[0]?.at;
    if (typeof at !== "number" || !Number.isFinite(at) || at < 0) continue;
    // A hidden tab throttles timers, so visibility wins. Among visible peers,
    // prefer desktop-class hardware before falling back to join order.
    const rank = (entries[0]?.visible === false ? 2 : 0) + (entries[0]?.capable === false ? 1 : 0);
    if (
      rank < priority ||
      (rank === priority && (at < first || (at === first && (host === null || key < host))))
    ) {
      priority = rank;
      first = at;
      host = key;
    }
  }
  return host;
}
