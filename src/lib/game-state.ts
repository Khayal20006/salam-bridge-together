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
  grid: true,
  glow: true,
  boostFx: true,
  names: true,
  minimap: true,
  showFps: false,
};

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

export function normalizeConfig(value: unknown): GameConfig {
  const config = { ...DEFAULT_CONFIG };
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
  return normalizeConfig(parse(readStorage("neon-cfg")));
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

export function electHost(presence: Record<string, { at?: number }[]>): string | null {
  let host: string | null = null,
    first = Infinity;
  for (const [key, entries] of Object.entries(presence)) {
    const at = entries[0]?.at;
    if (typeof at !== "number" || !Number.isFinite(at) || at < 0) continue;
    if (at < first || (at === first && (host === null || key < host))) {
      first = at;
      host = key;
    }
  }
  return host;
}
