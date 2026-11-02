import { supabase } from "@/integrations/supabase/client";
import { SKIN_BY } from "@/lib/skins";
import { electHost } from "@/lib/game-state";
import { Arena, STEP_MS, MAX_PLAYERS, type Input, type Snapshot } from "./engine";
import { packSnapshot, unpackSnapshot } from "./protocol";

export type ConnectionEvents = {
  snapshot: (state: Snapshot, selfId: string) => void;
  status: (status: "connecting" | "online" | "reconnecting" | "offline") => void;
  rejected: (reason: string) => void;
  count: (n: number) => void;
};
export interface ArenaConnection {
  play(name: string, skin: string): void;
  input(angle: number, boost: boolean): void;
  close(): void;
}

const validRoom = (room: string) => /^(eu-[1-4]|as-[1-2]|am-[1-2])$/.test(room);

export function connectArena(room: string, events: ConnectionEvents): ArenaConnection {
  if (!validRoom(room)) throw new Error("Invalid room");
  const configured = import.meta.env["VITE_ARENA_URL"] as string | undefined;
  if (configured || import.meta.env.DEV) return new SocketConnection(room, events, configured);
  return new RealtimeConnection(room, events);
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
          if (this.snapshot && next.tick <= this.snapshot.tick) return;
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
      if (!this.snapshot?.snakes.some((s) => s.id === this.id)) this.pending = undefined;
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
  input(angle: number, boost: boolean): void {
    this.send({
      type: "input",
      seq: ++this.seq,
      angle,
      boost,
      radius: Math.min(2200, Math.max(800, Math.hypot(innerWidth, innerHeight) + 100)),
    });
  }
  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }
}

/**
 * Compatibility transport for existing Lovable deployments without an arena URL.
 * Exactly one elected peer runs the same authoritative engine; everyone else sends inputs.
 * A dedicated SocketConnection is preferred for competitive play and untrusted clients.
 */
class RealtimeConnection implements ArenaConnection {
  private readonly id = crypto.randomUUID();
  private readonly joined = Date.now();
  private channel;
  private arena: Arena | undefined;
  private current: Snapshot | undefined;
  private published: Snapshot | undefined;
  private host: string | null = null;
  private closed = false;
  private seq = 0;
  private lastSync = -Infinity;
  private lastJoin = new Map<string, number>();
  private pending: { name: string; skin: string; nonce: number } | undefined;
  private acknowledgedNonce = new Map<string, number>();
  private clock = performance.now();
  private accumulator = 0;
  private interval: ReturnType<typeof setInterval>;
  private retry: ReturnType<typeof setInterval>;
  constructor(
    room: string,
    private events: ConnectionEvents,
  ) {
    events.status("connecting");
    this.channel = supabase.channel(`neon-arena-v2-${room}`, {
      config: { broadcast: { self: false }, presence: { key: this.id } },
    });
    this.channel.on("presence", { event: "sync" }, () => this.elect());
    this.channel.on("broadcast", { event: "state" }, ({ payload }) => {
      if (this.closed || payload?.host !== this.host || this.host === this.id) return;
      const next = unpackSnapshot(payload.state, this.current);
      if (!next) {
        this.requestSync();
        return;
      }
      if (this.current && next.tick <= this.current.tick) return;
      this.current = next;
      this.events.status("online");
      this.events.snapshot(next, this.id);
      if (next.snakes.some((s) => s.id === this.id)) this.pending = undefined;
    });
    this.channel.on("broadcast", { event: "rejected" }, ({ payload }) => {
      if (payload?.host === this.host && payload?.id === this.id) {
        this.pending = undefined;
        this.events.rejected("Otaq doludur və ya təhlükəsiz başlanğıc yeri yoxdur.");
      }
    });
    this.channel.on("broadcast", { event: "command" }, ({ payload }) => this.command(payload));
    this.channel.subscribe((status) => {
      if (this.closed) return;
      if (status === "SUBSCRIBED")
        void this.channel.track({ at: this.joined }).then(() => this.elect());
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        // Never create a second world during a network partition. Freeze and reconnect.
        this.events.status("reconnecting");
        this.host = null;
        this.arena = undefined;
      }
    });
    this.interval = setInterval(() => this.update(), 10);
    this.retry = setInterval(() => {
      if (this.pending) this.sendJoin();
    }, 1000);
  }
  private broadcast(event: string, payload: unknown): void {
    if (!this.closed)
      void this.channel.send({ type: "broadcast", event, payload }).catch(console.error);
  }
  private elect(): void {
    if (this.closed) return;
    const presence = this.channel.presenceState() as Record<string, { at?: number }[]>;
    this.events.count(Object.keys(presence).length);
    const next = electHost(presence);
    if (this.arena)
      for (const s of this.arena.snakes.values())
        if (!s.bot && !(s.id in presence)) this.arena.leave(s.id);
    if (next === this.host) return;
    this.host = next;
    this.published = undefined;
    this.lastJoin.clear();
    if (next === this.id) {
      this.arena = new Arena(Math.random, !this.current);
      if (this.current) this.arena.restore(this.current);
      for (const s of this.arena.snakes.values())
        if (!s.bot && !(s.id in presence)) this.arena.leave(s.id);
      this.clock = performance.now();
      this.accumulator = 0;
      this.publish(true);
      this.events.status("online");
    } else {
      this.arena = undefined;
      this.events.status("connecting");
      this.requestSync();
    }
    if (this.pending) this.sendJoin();
  }
  private publish(full = false): void {
    if (!this.arena || this.closed) return;
    const snapshot = this.arena.snapshot();
    this.broadcast("state", {
      host: this.id,
      state: packSnapshot(snapshot, full ? undefined : this.published),
    });
    this.published = snapshot;
    this.current = snapshot;
    this.events.snapshot(snapshot, this.id);
    if (snapshot.snakes.some((s) => s.id === this.id)) this.pending = undefined;
  }
  private update(): void {
    if (!this.arena || this.closed || this.host !== this.id) return;
    const now = performance.now();
    this.accumulator += Math.min(170, now - this.clock);
    this.clock = now;
    let count = 0;
    while (this.accumulator >= STEP_MS && count++ < 5) {
      this.arena.step();
      this.accumulator -= STEP_MS;
    }
    if (this.arena.tick !== this.published?.tick && this.arena.tick % 3 === 0) this.publish();
  }
  private command(value: unknown): void {
    if (!this.arena || !value || typeof value !== "object") return;
    const m = value as Record<string, unknown>,
      key = m["id"];
    if (typeof key !== "string" || !(key in this.channel.presenceState())) return;
    if (m["type"] === "sync") {
      const now = performance.now();
      if (now - this.lastSync > 500) {
        this.lastSync = now;
        this.publish(true);
      }
    } else if (m["type"] === "input") {
      this.arena.input(key, m as unknown as Input);
    } else if (m["type"] === "join") {
      if (
        typeof m["name"] !== "string" ||
        typeof m["skin"] !== "string" ||
        !Object.hasOwn(SKIN_BY, m["skin"]) ||
        typeof m["nonce"] !== "number" ||
        !Number.isSafeInteger(m["nonce"])
      )
        return;
      if (this.acknowledgedNonce.get(key) === m["nonce"]) return;
      const now = performance.now();
      if (now - (this.lastJoin.get(key) ?? -Infinity) < 750) return;
      this.lastJoin.set(key, now);
      if (this.arena.join(key, m["name"], m["skin"])) {
        this.acknowledgedNonce.set(key, m["nonce"]);
        this.publish(true);
      } else if (key === this.id) {
        this.pending = undefined;
        this.events.rejected(`Otaq doludur (${MAX_PLAYERS} oyunçu) və ya təhlükəsiz yer yoxdur.`);
      } else this.broadcast("rejected", { host: this.id, id: key });
    }
  }
  private requestSync(): void {
    const now = performance.now();
    if (now - this.lastSync < 500) return;
    this.lastSync = now;
    this.broadcast("command", { type: "sync", id: this.id });
  }
  private sendJoin(): void {
    if (!this.pending || !this.host) return;
    const message = { type: "join", id: this.id, ...this.pending };
    if (this.host === this.id) this.command(message);
    else this.broadcast("command", message);
  }
  play(name: string, skin: string): void {
    this.pending = { name, skin, nonce: Date.now() };
    this.sendJoin();
  }
  input(angle: number, boost: boolean): void {
    const message = { type: "input", id: this.id, seq: ++this.seq, angle, boost };
    if (this.host === this.id) this.command(message);
    else this.broadcast("command", message);
  }
  close(): void {
    this.closed = true;
    clearInterval(this.interval);
    clearInterval(this.retry);
    void supabase.removeChannel(this.channel);
  }
}
