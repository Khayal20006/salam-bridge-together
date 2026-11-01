export type Skin = { id: string; name: string; type: "hue" | "stripes" | "bands"; colors: string[]; price: number; tier: "free" | "classic" | "flag" | "premium" };
export const SKINS: Skin[] = [
  { id: "hue", name: "Neon", type: "hue", colors: ["#2ee88a"], price: 0, tier: "free" },
  { id: "fire", name: "Alov", type: "stripes", colors: ["#ff3b3b", "#ffd23b"], price: 50, tier: "classic" },
  { id: "jungle", name: "Cəngəllik", type: "stripes", colors: ["#3bff8a", "#147a3e"], price: 50, tier: "classic" },
  { id: "ice", name: "Buz", type: "stripes", colors: ["#3bc8ff", "#ffffff"], price: 80, tier: "classic" },
  { id: "candy", name: "Konfet", type: "stripes", colors: ["#ff5fc8", "#ffffff", "#7a5cff"], price: 120, tier: "classic" },
  { id: "rainbow", name: "Göy qurşağı", type: "stripes", colors: ["#ff3b3b", "#ff9a3b", "#ffe93b", "#3bff6a", "#3bb8ff", "#9a5cff"], price: 250, tier: "classic" },
  { id: "az", name: "Azərbaycan", type: "bands", colors: ["#00b5e2", "#ef3340", "#509e2f"], price: 100, tier: "flag" },
  { id: "tr", name: "Türkiyə", type: "bands", colors: ["#e30a17", "#ffffff", "#e30a17"], price: 100, tier: "flag" },
  { id: "ua", name: "Ukrayna", type: "bands", colors: ["#0057b7", "#ffd700"], price: 100, tier: "flag" },
  { id: "de", name: "Almaniya", type: "bands", colors: ["#111111", "#dd0000", "#ffce00"], price: 100, tier: "flag" },
  { id: "br", name: "Braziliya", type: "bands", colors: ["#009c3b", "#ffdf00", "#002776"], price: 100, tier: "flag" },
  { id: "fr", name: "Fransa", type: "bands", colors: ["#0055a4", "#ffffff", "#ef4135"], price: 100, tier: "flag" },
  { id: "gold", name: "Qızıl Əjdaha 👑", type: "stripes", colors: ["#ffd23b", "#1a1405", "#ffb000"], price: 600, tier: "premium" },
  { id: "lava", name: "Lava 👑", type: "bands", colors: ["#2a0500", "#ff4500", "#ffd000"], price: 700, tier: "premium" },
  { id: "cosmos", name: "Kosmos 👑", type: "stripes", colors: ["#1b0b4a", "#7a3bff", "#ff5fe0", "#3bd8ff"], price: 900, tier: "premium" },
  { id: "toxic", name: "Toksik 👑", type: "bands", colors: ["#0a1a00", "#7dff00", "#eaff8a"], price: 1000, tier: "premium" },
];
export const SKIN_BY: Record<string, Skin> = Object.fromEntries(SKINS.map((s) => [s.id, s]));
export const coinsFor = (len: number) => Math.floor(len / 5);
