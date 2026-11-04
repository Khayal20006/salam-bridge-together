import { Arena, STEP_MS, type Input, type Snapshot } from "./engine.ts";

export type AuthorityCommand =
  | { type: "start"; snapshot?: Snapshot }
  | { type: "join"; id: string; name: string; skin: string; nonce: number }
  | { type: "input"; id: string; input: Input }
  | { type: "members"; ids: string[] }
  | { type: "sync" };
export type AuthorityEvent =
  { type: "state"; snapshot: Snapshot; full: boolean } | { type: "rejected"; id: string };
export interface AuthorityWorker {
  postMessage(command: AuthorityCommand): void;
  onmessage: ((event: { data: AuthorityEvent }) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

/** Fixed simulation time is independent of paint time and network publication. */
export class Authority {
  private arena: Arena | undefined;
  private accumulator = 0;
  private lastPublished = -Infinity;
  private members = new Set<string>();
  private joined = new Map<string, number>();
  private inputAt = new Map<string, number>();
  private clock = 0;
  constructor(private emit: (event: AuthorityEvent) => void) {}

  command(command: AuthorityCommand): void {
    if (command.type === "start") {
      this.arena = new Arena(Math.random, !command.snapshot);
      if (command.snapshot) this.arena.restore(command.snapshot);
      this.publish(true);
      return;
    }
    if (command.type === "members") {
      this.members = new Set(command.ids);
      for (const snake of this.arena?.snakes.values() ?? []) {
        if (!snake.bot && !this.members.has(snake.id)) this.arena!.leave(snake.id);
      }
      for (const id of this.joined.keys()) {
        if (!this.members.has(id)) {
          this.joined.delete(id);
          this.inputAt.delete(id);
        }
      }
      return;
    }
    if (!this.arena) return;
    if (command.type === "sync") this.publish(true);
    else if (this.members.has(command.id)) {
      if (command.type === "input") {
        this.arena.input(command.id, command.input);
        this.inputAt.set(command.id, this.clock);
      } else if (this.joined.get(command.id) !== command.nonce) {
        this.joined.set(command.id, command.nonce);
        if (this.arena.join(command.id, command.name, command.skin)) {
          this.inputAt.set(command.id, this.clock);
          this.publish(true);
        } else this.emit({ type: "rejected", id: command.id });
      }
    }
  }

  advance(elapsed: number): void {
    if (!this.arena || !Number.isFinite(elapsed) || elapsed <= 0) return;
    this.clock += elapsed;
    for (const snake of this.arena.snakes.values()) {
      if (!snake.bot && this.clock - (this.inputAt.get(snake.id) ?? 0) > 500) snake.boost = false;
    }
    // Bound catch-up work after a suspended device; never build an ever-growing backlog.
    this.accumulator = Math.min(STEP_MS * 5, this.accumulator + elapsed);
    while (this.accumulator + 0.000001 >= STEP_MS) {
      this.arena.step();
      this.accumulator -= STEP_MS;
    }
    // Testing tick % 3 can skip publication when a timer advances several ticks at once.
    if (this.arena.tick - this.lastPublished >= 3) this.publish();
  }

  private publish(full = false): void {
    if (!this.arena) return;
    this.lastPublished = this.arena.tick;
    this.emit({ type: "state", snapshot: this.arena.snapshot(), full });
  }
}
