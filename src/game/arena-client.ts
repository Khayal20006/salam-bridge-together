import OfflineWorker from "./offline.worker?worker&inline";
import { supabase } from "@/integrations/supabase/client";
import { unpackSnapshot } from "./protocol";
import type { Snapshot } from "./engine";
export type ArenaMode = "connecting" | "online" | "offline";
export type ArenaEvents = {
  state: (snapshot: Snapshot, id: string) => void;
  mode: (mode: ArenaMode) => void;
  count: (count: number) => void;
  rejected: (reason: string) => void;
};
export function arenaUrl(base: string, room: string, origin: string): string {
  if (!/^(eu-[1-4]|as-[1-2]|am-[1-2])$/.test(room)) throw new Error("Invalid room");
  const template = base.includes("{room}");
  const url = new URL(template ? base.replace("{room}", room) : base, origin);
  if (!["https:", "http:", "ws:", "wss:"].includes(url.protocol))
    throw new Error("Invalid arena protocol");
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  if (!template)
    url.pathname =
      url.pathname.replace(/\/$/, "").replace(/\/(eu-[1-4]|as-[1-2]|am-[1-2])$/, "") + "/" + room;
  return url.href;
}

/**
 * Only input is uploaded. The worker world is a temporary fallback while the
 * shared arena is cold-starting or reconnecting; the client keeps retrying the
 * server and switches back as soon as an authoritative snapshot arrives.
 */
export class ArenaClient {
  private socket: WebSocket | undefined;
  private worker: Worker | undefined;
  private closed = false;
  private id = "";
  private baseline: Snapshot | undefined;
  private seq = 0;
  private lastState = performance.now();
  private mode: ArenaMode = "connecting";
  private pending: { name: string; skin: string } | undefined;
  private watchdog: ReturnType<typeof setInterval>;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private connectingSince = 0;
  private readonly origin: string;
  private readonly room: string;
  private readonly base: string;
  constructor(
    room: string,
    private events: ArenaEvents,
    base = import.meta.env["VITE_ARENA_URL"] ||
      "wss://salam-bridge-together.fly.dev/arena/{room}",
  ) {
    this.room = room;
    this.base = base;
    this.origin = location.origin;
    events.mode("connecting");
    this.watchdog = setInterval(() => {
      const now = performance.now();
      if (this.mode !== "offline" && now - this.lastState > 6000) this.fallback();
      // A retry can also hang during a Render cold start. Never leave it pending forever.
      if (this.mode === "offline" && this.socket && now - this.connectingSince > 45000) {
        const stalled = this.socket;
        this.socket = undefined;
        stalled.close();
        this.scheduleReconnect();
      }
    }, 500);
    this.connect();
  }
  private connect(): void {
    if (this.closed || this.socket) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(arenaUrl(this.base, this.room, this.origin));
    } catch {
      this.fallback();
      return;
    }
    this.socket = socket;
    this.connectingSince = performance.now();
    this.id = "";
    this.baseline = undefined;
    socket.onmessage = (event) => {
      if (
        this.closed ||
        this.socket !== socket ||
        typeof event.data !== "string" ||
        event.data.length > 512000
      )
        return;
      try {
        const m = JSON.parse(event.data);
        if (m.type === "hello" && typeof m.id === "string") {
          this.id = m.id;
          if (this.pending) void this.join();
        } else if (m.type === "state" && this.id) {
          const state = unpackSnapshot(m.state, this.baseline);
          if (!state) {
            this.send({ type: "sync" });
            return;
          }
          if (this.baseline && state.tick < this.baseline.tick) return;
          this.baseline = state;
          this.lastState = performance.now();
          this.attempt = 0;
          if (this.mode !== "online") {
            // Commit the switch only after decoding a valid authoritative snapshot.
            this.worker?.terminate();
            this.worker = undefined;
            this.mode = "online";
            this.events.mode("online");
          }
          this.events.state(state, this.id);
          this.events.count(typeof m.count === "number" ? m.count : 1);
          if (
            state.deaths.some((d) => d.id === this.id) &&
            !state.snakes.some((s) => s.id === this.id)
          )
            this.pending = undefined;
        } else if (m.type === "rejected") {
          this.pending = undefined;
          this.events.rejected(typeof m.reason === "string" ? m.reason : "Otağa giriş alınmadı.");
        }
      } catch {
        /* Malformed packets cannot reach the renderer. */
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.closed || this.socket !== socket) return;
      this.socket = undefined;
      this.id = "";
      this.baseline = undefined;
      this.fallback();
      this.scheduleReconnect();
    };
  }
  private scheduleReconnect(): void {
    if (this.closed || this.reconnect) return;
    const delay = Math.min(10_000, 1_000 * 2 ** this.attempt++);
    this.reconnect = setTimeout(() => {
      this.reconnect = undefined;
      this.connect();
    }, delay);
  }
  private fallback(): void {
    if (this.closed) return;
    if (this.mode === "offline") {
      this.scheduleReconnect();
      return;
    }
    this.mode = "offline";
    const oldSocket = this.socket;
    this.socket = undefined;
    oldSocket?.close();
    this.id = "";
    this.baseline = undefined;
    this.events.mode("offline");
    this.events.count(1);
    try {
      const worker = (this.worker = new OfflineWorker());
      worker.onmessage = (event) => {
        if (this.closed || this.mode !== "offline" || this.worker !== worker) return;
        const state: Snapshot = event.data.state;
        this.events.state(state, event.data.id);
        if (
          state.deaths.some((d) => d.id === event.data.id) &&
          !state.snakes.some((s) => s.id === event.data.id)
        )
          this.pending = undefined;
      };
      worker.onerror = () => this.events.rejected("Lokal oyun açıla bilmədi. Səhifəni yenilə.");
      if (this.pending) worker.postMessage({ type: "join", ...this.pending });
    } catch {
      this.events.rejected("Lokal oyun açıla bilmədi. Səhifəni yenilə.");
    }
    // Keep trying the shared arena even while the offline world is playable.
    if (!this.socket) this.scheduleReconnect();
  }
  play(name: string, skin: string): void {
    this.pending = { name, skin };
    if (this.mode === "offline") this.worker?.postMessage({ type: "join", name, skin });
    else if (this.id) void this.join();
  }
  private async join(): Promise<void> {
    const pending = this.pending,
      socket = this.socket;
    if (!pending) return;
    let token: string | undefined;
    if (["rgb", "plasma", "legend"].includes(pending.skin)) {
      try {
        token = (await supabase.auth.getSession()).data.session?.access_token;
      } catch {
        this.events.rejected("Hesaba giriş alınmadı.");
        return;
      }
    }
    if (!this.closed && this.socket === socket && this.pending === pending && !!this.id)
      this.send({ type: "join", ...pending, token });
  }
  input(angle: number, boost: boolean, radius: number): void {
    if (this.mode === "offline") this.worker?.postMessage({ type: "input", angle, boost });
    else this.send({ type: "input", seq: ++this.seq, angle, boost, radius });
  }
  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 8192)
      this.socket.send(JSON.stringify(message));
  }
  close(): void {
    this.closed = true;
    clearInterval(this.watchdog);
    clearTimeout(this.reconnect);
    this.reconnect = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.worker?.terminate();
    this.worker = undefined;
  }
}
