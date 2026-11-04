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
const frame = (tick = 0) => ({
  type: "state",
  count: 2,
  state: { v: 2, tick, base: null, snakes: [], foods: [], removed: [], deaths: [] },
});
const deliver = (socket: Socket, message: unknown) =>
  socket.onmessage?.({ data: JSON.stringify(message) });
it("rejoins the shared server after fallback and switches only on a valid snapshot", () => {
  const e = events(),
    c = new ArenaClient("eu-1", e, "ws://localhost/arena");
  c.play("Player", "hue");
  const old = Socket.instances[0]!;
  old.close();
  expect(e.mode).toHaveBeenLastCalledWith("offline");
  const worker = LocalWorker.instances[0]!;
  vi.advanceTimersByTime(1000);
  const next = Socket.instances[1]!;
  deliver(next, { type: "hello", id: "remote-1" });
  expect(next.sent.map((x) => JSON.parse(x)).filter((x) => x.type === "join")).toEqual([
    { type: "join", name: "Player", skin: "hue" },
  ]);
  deliver(next, { type: "state", state: { broken: true } });
  expect(worker.terminated).toBe(false);
  expect(e.mode).toHaveBeenLastCalledWith("offline");
  deliver(next, frame());
  expect(worker.terminated).toBe(true);
  expect(e.mode).toHaveBeenLastCalledWith("online");
  expect(e.count).toHaveBeenLastCalledWith(2);
  e.state.mockClear();
  deliver(old, frame(99));
  expect(e.state).not.toHaveBeenCalled();
  c.input(0.5, true, 1600);
  expect(JSON.parse(next.sent.at(-1)!)).toMatchObject({ type: "input", angle: 0.5, boost: true });
  c.close();
  expect(vi.getTimerCount()).toBe(0);
});
it("retries a stalled connection while offline instead of remaining isolated forever", () => {
  const e = events(),
    c = new ArenaClient("eu-1", e, "ws://localhost/arena");
  Socket.instances[0]!.close();
  vi.advanceTimersByTime(49000);
  expect(Socket.instances.length).toBeGreaterThanOrEqual(3);
  expect(LocalWorker.instances).toHaveLength(1);
  c.close();
  expect(vi.getTimerCount()).toBe(0);
});
it("does not let delayed worker messages replace an online shared world", () => {
  const e = events(),
    c = new ArenaClient("eu-1", e, "ws://localhost/arena");
  Socket.instances[0]!.close();
  const worker = LocalWorker.instances[0]! as LocalWorker & {
    onmessage: (event: { data: unknown }) => void;
  };
  vi.advanceTimersByTime(1000);
  const next = Socket.instances[1]!;
  deliver(next, { type: "hello", id: "remote-1" });
  deliver(next, frame());
  e.state.mockClear();
  worker.onmessage({
    data: { id: "offline-player", state: { tick: 5, snakes: [], deaths: [], foods: [] } },
  });
  expect(e.state).not.toHaveBeenCalled();
  c.close();
});
