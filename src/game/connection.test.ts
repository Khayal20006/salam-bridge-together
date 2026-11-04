import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectArena, type ConnectionEvents } from "./connection";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

const opened: string[] = [];
class TestWebSocket {
  static OPEN = 1;
  readonly close = vi.fn();
  constructor(url: string | URL) {
    opened.push(String(url));
  }
}
const events = (): ConnectionEvents => ({
  snapshot: vi.fn(),
  status: vi.fn(),
  rejected: vi.fn(),
  count: vi.fn(),
});

describe("arena transport selection", () => {
  beforeEach(() => {
    opened.length = 0;
    vi.stubGlobal("WebSocket", TestWebSocket);
    vi.stubEnv("VITE_ARENA_URL", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("connects both production players to Render when the build omits the arena variable", () => {
    vi.stubEnv("DEV", false);
    const a = connectArena("eu-2", events());
    const b = connectArena("eu-2", events());
    expect(opened).toEqual([
      "wss://salam-bridge-together.onrender.com/arena/eu-2",
      "wss://salam-bridge-together.onrender.com/arena/eu-2",
    ]);
    a.close();
    b.close();
  });

  it("keeps a configured endpoint and appends the selected room", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_ARENA_URL", "https://arena.example/game/");
    const connection = connectArena("as-1", events());
    expect(opened).toEqual(["wss://arena.example/game/as-1"]);
    connection.close();
  });

  it("uses the same-origin development proxy without a hosted endpoint", () => {
    vi.stubEnv("DEV", true);
    const connection = connectArena("eu-1", events());
    const expected = new URL("/arena/eu-1", window.location.origin);
    expected.protocol = expected.protocol === "https:" ? "wss:" : "ws:";
    expect(opened).toEqual([String(expected)]);
    connection.close();
  });

  it("rejects invalid rooms before opening a socket", () => {
    expect(() => connectArena("eu-99", events())).toThrow("Invalid room");
    expect(opened).toEqual([]);
  });
});
