import { supabase } from "@/integrations/supabase/client";
import type { Snapshot } from "./engine";
import { unpackSnapshot } from "./protocol";

export type ConnectionEvents = {
  snapshot: (state: Snapshot, selfId: string, world?: string) => void;
  status: (status: "connecting" | "online" | "reconnecting" | "offline") => void;
  rejected: (reason: string) => void;
  count: (n: number) => void;
};
export interface ArenaConnection {
  play(name: string, skin: string): void;
  input(angle: number, boost: boolean): number | undefined;
  resume(): void;
  close(): void;
}

const validRoom = (room: string) => /^(eu-[1-4]|as-[1-2]|am-[1-2])$/.test(room);
const HOSTED_ARENA_URL = "https://salam-bridge-together.onrender.com/arena";

export function connectArena(room: string, events: ConnectionEvents): ArenaConnection {
  if (!validRoom(room)) throw new Error("Invalid room");
  const configured = import.meta.env["VITE_ARENA_URL"] as string | undefined;
  // A hosted build can omit custom VITE_* values. It must still use the arena,
  // rather than silently electing one of the players' browsers as the server.
  const base = configured || (import.meta.env.DEV ? undefined : HOSTED_ARENA_URL);
  return new SocketConnection(room, events, base);
}

class SocketConnection implements ArenaConnection {
  private socket: WebSocket | undefined;
  private closed = false;
  private seq = 0;
  private snapshot: Snapshot | undefined;
  private id = "";
  private retries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: { name: string; skin: string } | undefined;
  constructor(
    private room: string,
    private events: ConnectionEvents,
    private base?: string,
  ) {
    this.open();
  }
  private open(): void {
    if (this.closed) return;
    this.events.status(this.retries ? "reconnecting" : "connecting");
    const url = new URL(this.base ?? "/arena", window.location.origin);
    url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${this.room}`;
    const socket = (this.socket = new WebSocket(url));
    socket.onopen = () => {
      this.retries = 0;
    };
    socket.onmessage = (event) => {
      if (this.closed || typeof event.data !== "string" || event.data.length > 512_000) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "hello" && typeof msg.id === "string") {
          this.id = msg.id;
          this.snapshot = undefined;
          this.events.status("online");
          if (this.pending) this.play(this.pending.name, this.pending.skin);
        } else if (msg.type === "state") {
          const next = unpackSnapshot(msg.state, this.snapshot);
          if (!next) {
            this.send({ type: "sync" });
            return;
          }
          if (this.snapshot && next.tick < this.snapshot.tick) return;
          if (next.tick === this.snapshot?.tick && msg.state.base !== null) return;
          this.snapshot = next;
          this.events.snapshot(next, this.id);
          if (
            next.deaths.some((d) => d.id === this.id) &&
            !next.snakes.some((s) => s.id === this.id)
          )
            this.pending = undefined;
          this.events.count(typeof msg.count === "number" ? msg.count : 1);
        } else if (msg.type === "rejected") {
          this.pending = undefined;
          this.events.rejected(
            typeof msg.reason === "string" ? msg.reason : "Otağa daxil olmaq alınmadı.",
          );
        }
      } catch {
        /* Ignore malformed messages without breaking rendering. */
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = (event) => {
      if (this.closed) return;
      if (event.code === 1008) {
        this.pending = undefined;
        this.events.status("offline");
        return;
      }
      this.events.status("reconnecting");
      // Rejoin only if the player was alive in the most recent authoritative snapshot.
      if (!this.snapshot?.snakes.some((s) => s.id === this.id) && this.pending) {
        this.pending = undefined;
        this.events.rejected("Bağlantı kəsildi. Qoşulandan sonra yenidən Oyna düyməsini bas.");
      }
      this.id = "";
      this.timer = setTimeout(
        () => this.open(),
        Math.min(10_000, 500 * 2 ** Math.min(5, this.retries++)),
      );
    };
  }
  private send(value: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }
  play(name: string, skin: string): void {
    const pending = (this.pending = { name, skin }),
      id = this.id;
    if (!id) return;
    if (!["rgb", "plasma", "legend"].includes(skin)) {
      this.send({ type: "join", name, skin });
      return;
    }
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (this.id === id && this.pending === pending)
          this.send({ type: "join", name, skin, token: data.session?.access_token });
      })
      .catch(() => this.events.rejected("Hesab məlumatı yüklənmədi. Yenidən daxil ol."));
  }
  input(angle: number, boost: boolean): number | undefined {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const seq = ++this.seq;
    this.send({
      type: "input",
      seq,
      angle,
      boost,
      radius: Math.min(2200, Math.max(800, Math.hypot(innerWidth, innerHeight) + 100)),
    });
    return seq;
  }
  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }
  resume(): void {
    this.send({ type: "sync" });
  }
}
