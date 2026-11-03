import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadProgress,
  normalizeConfig,
  normalizeProgress,
  saveProgress,
  writeStorage,
  electHost,
} from "./game-state";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
describe("saved game data", () => {
  it("validates graphics options instead of creating a NaN-sized canvas", () => {
    expect(normalizeConfig({ quality: "ultra", glow: "false", names: false })).toEqual({
      ...DEFAULT_CONFIG,
      names: false,
    });
    localStorage.setItem("neon-cfg", "{");
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
  it("normalizes corrupt coins, unknown skins and invalid ownership", () => {
    expect(
      normalizeProgress({
        coins: Infinity,
        owned: ["__proto__", "fire", "rgb", "fire"],
        skin: "bad",
      }),
    ).toEqual({ coins: 0, owned: ["hue", "fire"], skin: "hue" });
    expect(normalizeProgress({ coins: -10, owned: 3 })).toEqual({
      coins: 0,
      owned: ["hue"],
      skin: "hue",
    });
  });
  it("keeps account A, account B and guest data separate", () => {
    saveProgress({ coins: 500, owned: ["hue", "fire"], skin: "fire" }, "a");
    saveProgress({ coins: 40, owned: ["hue"], skin: "hue" }, "b");
    expect(loadProgress("a").coins).toBe(500);
    expect(loadProgress("b").coins).toBe(40);
    expect(loadProgress().coins).toBe(0);
  });
  it("migrates legacy progress only to its recorded owner", () => {
    localStorage.setItem("neon-synced", "a");
    localStorage.setItem("neon-coins", "999");
    expect(loadProgress("a").coins).toBe(999);
    expect(loadProgress("b").coins).toBe(0);
    expect(loadProgress().coins).toBe(0);
  });
  it("keeps playing possible when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeStorage("key", "value")).not.toThrow();
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
});
describe("host election", () => {
  it("hands authority to a visible peer and keeps deterministic ordering", () => {
    const presence = { first: [{ at: 0, visible: false }], second: [{ at: 1, visible: true }] };
    expect(electHost(presence)).toBe("second");
    expect(electHost({ second: presence.second, first: presence.first })).toBe("second");
    expect(electHost({ first: presence.first })).toBe("first");
  });
  it("uses a deterministic tie break and ignores invalid timestamps", () => {
    expect(electHost({ b: [{ at: 10 }], a: [{ at: 10 }], bad: [{ at: NaN }] })).toBe("a");
    expect(electHost({ invalid: [{}] })).toBeNull();
    expect(electHost({ first: [{ at: 0 }], later: [{ at: 1 }] })).toBe("first");
  });
});
