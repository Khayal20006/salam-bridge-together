import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { SKIN_BY } from "@/lib/skins";
import { electHost } from "@/lib/game-state";
import type { Snapshot } from "./engine";
import type { ArenaConnection, ConnectionEvents } from "./connection";
import type { AuthorityWorker, AuthorityCommand, AuthorityEvent } from "./authority";
import { packSnapshot, unpackSnapshot } from "./protocol";
import { angleDelta } from "./movement";

type Options = {
  client?: SupabaseClient;
  worker?: () => AuthorityWorker;
  namespace?: string;
};
const createWorker = () =>
  new Worker(new URL("./simulation.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as AuthorityWorker;

/** Browser-host compatibility transport. A peer never simulates another host's world. */
export class RealtimeConnection implements ArenaConnection {
  private readonly id = crypto.randomUUID();
  private readonly joined = Date.now();
  private readonly client;
  private channel;
  private worker: AuthorityWorker | undefined;
  private current: Snapshot | undefined;
  private published: Snapshot | undefined;
  private host: string | null = null;
  private world = "";
  private closed = false;
  private connected = false;
  private seq = 0;
  private lastSync = -Infinity;
  private lastReceived = performance.now();
  private lastInput: { angle: number; boost: boolean; at: number } | undefined;
  private pending: { name: string; skin: string; nonce: number; tick: number } | undefined;
  private election: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval>;
  private sending = false;
  private generation = 0;
  private queued: { snapshot: Snapshot; full: boolean } | undefined;
  private forceFull = true;
  private visibility = () => {
    if (document.hidden) this.input(this.lastInput?.angle ?? 0, false);
    if (this.connected) void this.track();
  };

  constructor(
    room: string,
    private events: ConnectionEvents,
    private options: Options = {},
  ) {
    this.client = options.client ?? supabase;
    events.status("connecting");
    this.channel = this.client.channel(`${options.namespace ?? "neon-arena-v3"}-${room}`, {
      config: { broadcast: { self: false }, presence: { key: this.id } },
    });
    this.channel.on("presence", { event: "sync" }, () => this.elect());
    this.channel.on("broadcast", { event: "state" }, ({ payload }) => {
      if (this.closed || !this.connected || payload?.host !== this.host || this.host === this.id)
        return;
      if (typeof payload.world !== "string" || payload.world.length > 80) return;
      const changedWorld = this.world !== payload.world;
      const next = unpackSnapshot(payload.state, changedWorld ? undefined : this.current);
      if (!next) {
        this.requestSync();
        return;
      }
      if (!changedWorld && this.current && next.tick < this.current.tick) return;
      // An equal-tick keyframe can contain a join or leave. It must replace the old frame.
      if (!changedWorld && next.tick === this.current?.tick && payload.state.base !== null) return;
      this.world = payload.world;
      this.accept(next);
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
      if (status === "SUBSCRIBED") {
        this.connected = true;
        void this.track();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        this.connected = false;
        this.stopWorker();
        clearTimeout(this.election);
        this.host = null;
        this.events.status("reconnecting");
      }
    });
    document.addEventListener("visibilitychange", this.visibility);
    this.watchdog = setInterval(() => {
      if (!this.connected) return;
      if (this.pending) this.sendJoin();
      if (!this.worker && this.host && performance.now() - this.lastReceived > 1500) {
        this.events.status("reconnecting");
        this.requestSync();
      }
    }, 500);
  }

  private async track(): Promise<void> {
    await this.channel.track({ at: this.joined, visible: !document.hidden });
    if (!this.closed && this.connected) this.elect();
  }
  private broadcast(event: string, payload: unknown): Promise<string> {
    if (this.closed || !this.connected) return Promise.resolve("error");
    return this.channel.send({ type: "broadcast", event, payload }).catch(() => "error");
  }
  private stopWorker(): void {
    this.generation++;
    this.sending = false;
    this.worker?.terminate();
    this.worker = undefined;
    this.queued = undefined;
    this.published = undefined;
    this.forceFull = true;
  }
  private elect(): void {
    if (this.closed || !this.connected) return;
    const presence = this.channel.presenceState() as Record<
      string,
      { at?: number; visible?: boolean }[]
    >;
    this.events.count(Object.keys(presence).length);
    this.worker?.postMessage({ type: "members", ids: Object.keys(presence) });
    const next = electHost(presence);
    if (next === this.host) return;
    // Stop an old authority immediately, then allow presence to settle before starting a new one.
    this.stopWorker();
    clearTimeout(this.election);
    this.host = next;
    this.lastSync = -Infinity;
    this.lastInput = undefined;
    this.events.status("connecting");
    this.election = setTimeout(() => this.activate(next), 350);
  }
  private activate(host: string | null): void {
    if (this.closed || !this.connected || host !== this.host || !host) return;
    if (host === this.id) {
      const worker = (this.worker = (this.options.worker ?? createWorker)());
      if (!this.world) this.world = crypto.randomUUID();
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker || this.closed || !this.connected) return;
        this.onAuthority(data);
      };
      worker.onerror = () => {
        this.stopWorker();
        this.events.status("offline");
        this.events.rejected("Oyun mühərriki dayandı. Səhifəni yenilə.");
      };
      worker.postMessage({ type: "members", ids: Object.keys(this.channel.presenceState()) });
      worker.postMessage(
        this.current ? { type: "start", snapshot: this.current } : { type: "start" },
      );
    } else this.requestSync();
    if (this.pending) this.sendJoin();
  }
  private accept(snapshot: Snapshot): void {
    this.current = snapshot;
    this.lastReceived = performance.now();
    this.events.status("online");
    this.events.snapshot(snapshot, this.id, this.world);
    if (
      snapshot.snakes.some((s) => s.id === this.id) ||
      snapshot.deaths.some((d) => d.id === this.id && d.tick > (this.pending?.tick ?? Infinity))
    )
      this.pending = undefined;
  }
  private onAuthority(event: AuthorityEvent): void {
    if (event.type === "rejected") {
      if (event.id === this.id) {
        this.pending = undefined;
        this.events.rejected("Otaq doludur və ya təhlükəsiz başlanğıc yeri yoxdur.");
      } else void this.broadcast("rejected", { host: this.id, id: event.id });
      return;
    }
    // Give the host exactly the same quantized state as its peers, not a separate local world.
    this.accept(unpackSnapshot(packSnapshot(event.snapshot, this.current), this.current)!);
    this.queued = {
      snapshot: event.snapshot,
      full: event.full || this.forceFull || (this.queued?.full ?? false),
    };
    void this.flush();
  }
  private async flush(): Promise<void> {
    if (this.sending || !this.queued || !this.worker || !this.connected) return;
    this.sending = true;
    const pending = this.queued;
    const worker = this.worker;
    const generation = this.generation;
    this.queued = undefined;
    const status = await this.broadcast("state", {
      host: this.id,
      world: this.world,
      state: packSnapshot(pending.snapshot, pending.full ? undefined : this.published),
    });
    if (generation !== this.generation || worker !== this.worker) return;
    this.sending = false;
    this.forceFull = status !== "ok";
    if (status === "ok") this.published = pending.snapshot;
    const queued = this.queued as { snapshot: Snapshot; full: boolean } | undefined;
    if (queued && this.forceFull) queued.full = true;
    void this.flush();
  }
  private command(value: unknown): void {
    if (!this.worker || !value || typeof value !== "object" || !this.connected) return;
    const m = value as Record<string, unknown>,
      key = m["id"];
    if (typeof key !== "string" || !(key in this.channel.presenceState())) return;
    if (m["type"] === "sync") {
      const now = performance.now();
      if (now - this.lastSync >= 250) {
        this.lastSync = now;
        this.worker.postMessage({ type: "sync" });
      }
    } else if (m["type"] === "input") {
      if (
        Number.isSafeInteger(m["seq"]) &&
        typeof m["angle"] === "number" &&
        Number.isFinite(m["angle"]) &&
        typeof m["boost"] === "boolean"
      )
        this.worker.postMessage({
          type: "input",
          id: key,
          input: {
            seq: m["seq"] as number,
            angle: m["angle"],
            boost: m["boost"],
          },
        });
    } else if (
      m["type"] === "join" &&
      typeof m["name"] === "string" &&
      m["name"].length <= 80 &&
      typeof m["skin"] === "string" &&
      Object.hasOwn(SKIN_BY, m["skin"]) &&
      Number.isSafeInteger(m["nonce"])
    ) {
      this.worker.postMessage({
        type: "join",
        id: key,
        name: m["name"],
        skin: m["skin"],
        nonce: m["nonce"] as number,
      });
    }
  }
  private requestSync(): void {
    const now = performance.now();
    if (!this.connected || !this.host || now - this.lastSync < 250) return;
    this.lastSync = now;
    void this.broadcast("command", { type: "sync", id: this.id });
  }
  private sendJoin(): void {
    if (!this.pending || !this.host || !this.connected) return;
    const message = { type: "join", id: this.id, ...this.pending };
    if (this.host === this.id) this.command(message);
    else void this.broadcast("command", message);
  }
  play(name: string, skin: string): void {
    this.pending = {
      name,
      skin,
      nonce: (this.pending?.nonce ?? Date.now()) + 1,
      tick: this.current?.tick ?? -1,
    };
    this.sendJoin();
  }
  input(angle: number, boost: boolean): void {
    if (!Number.isFinite(angle) || !this.connected || !this.host) return;
    const at = performance.now(),
      previous = this.lastInput;
    if (previous && previous.boost === boost) {
      // Unchanged controls need only a heartbeat. Changed steering is capped at 20 Hz.
      if (
        at - previous.at < 50 ||
        (Math.abs(angleDelta(previous.angle, angle)) < 0.015 && at - previous.at < 200)
      )
        return;
    }
    this.lastInput = { angle, boost, at };
    const message = { type: "input", id: this.id, seq: ++this.seq, angle, boost };
    if (this.host === this.id) this.command(message);
    else void this.broadcast("command", message);
  }
  close(): void {
    this.closed = true;
    this.connected = false;
    this.stopWorker();
    clearTimeout(this.election);
    clearInterval(this.watchdog);
    document.removeEventListener("visibilitychange", this.visibility);
    void this.client.removeChannel(this.channel);
  }
}
