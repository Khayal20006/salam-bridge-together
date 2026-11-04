import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
import { ArenaClient, arenaUrl } from "./arena-client";
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  onmessage: ((event: { data: string }) => void) | undefined;
  onclose: (() => void) | undefined;
  onerror: (() => void) | undefined;
  constructor(public url: string) {
    Socket.instances.push(this);
  }
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
class LocalWorker {
  static instances: LocalWorker[] = [];
  sent: unknown[] = [];
  terminated = false;
  constructor() {
    LocalWorker.instances.push(this);
  }
  postMessage(message: unknown) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  LocalWorker.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("Worker", LocalWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const events = () => ({ state: vi.fn(), mode: vi.fn(), count: vi.fn(), rejected: vi.fn() });
it("handles template, base path and concrete-room URLs without duplicating rooms", () => {
  for (const base of [
    "wss://example.com/arena/{room}",
    "https://example.com/arena/",
    "wss://example.com/arena/eu-1",
  ])
    expect(arenaUrl(base, "eu-2", "http://localhost")).toBe("wss://example.com/arena/eu-2");
});
it("sends only compact input and never starts local bots during a healthy connection", () => {
  const e = events(),
    c = new ArenaClient("eu-1", e, "ws://localhost/arena");
  c.input(1, true, 1600);
  const msg = JSON.parse(Socket.instances[0]!.sent[0]!);
  expect(msg).toEqual({ type: "input", seq: 1, angle: 1, boost: true, radius: 1600 });
  expect(LocalWorker.instances).toHaveLength(0);
  c.close();
});
it("falls back after a silent handshake, preserves pending join and shuts down all resources", () => {
  const e = events(),
    c = new ArenaClient("eu-1", e, "ws://localhost/arena");
  c.play("Player", "hue");
  vi.advanceTimersByTime(6500);
  expect(e.mode).toHaveBeenLastCalledWith("offline");
  expect(LocalWorker.instances).toHaveLength(1);
  expect(LocalWorker.instances[0]!.sent[0]).toEqual({ type: "join", name: "Player", skin: "hue" });
  Socket.instances[0]!.onerror?.();
  expect(LocalWorker.instances).toHaveLength(1);
  c.close();
  expect(LocalWorker.instances[0]!.terminated).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
