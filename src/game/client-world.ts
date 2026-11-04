import {
  STEP_MS,
  BASE_SPEED,
  BOOST_SPEED,
  segmentCount,
  type Snapshot,
  type Snake,
} from "./engine";
import { SnapshotPlayback } from "./playback";

export const MAX_POINTS = 240;
export const MAX_ENTITIES = 70;
export class DrawSnake {
  id = "";
  name = "";
  skin = "hue";
  hue = 0;
  len = 10;
  angle = 0;
  bot = false;
  boost = false;
  spawnTick = 0;
  count = 0;
  x = new Float64Array(MAX_POINTS);
  y = new Float64Array(MAX_POINTS);
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;
}

/** Allocated once. Snapshot decoding and indexes happen on message receipt, never in paint. */
export class ClientWorld {
  readonly pool = Array.from({ length: MAX_ENTITIES }, () => new DrawSnake());
  readonly local = new DrawSnake();
  readonly playback = new SnapshotPlayback();
  private history: { state: Snapshot; index: Map<string, Snake> }[] = [];
  latest: Snapshot | undefined;
  self = "";
  count = 0;
  angle = 0;
  boost = false;
  private predicted = false;
  private last = 0;
  private received = 0;
  private errorX = 0;
  private errorY = 0;
  reset(): void {
    this.history.length = 0;
    this.latest = undefined;
    this.count = 0;
    this.predicted = false;
    this.playback.clear();
    this.self = "";
  }
  receive(state: Snapshot, self: string, now: number): void {
    if (this.latest && state.tick < this.latest.tick) this.reset();
    this.self = self;
    const index = new Map<string, Snake>();
    for (const s of state.snakes) index.set(s.id, s);
    if (state.tick === this.latest?.tick) this.history.pop();
    this.history.push({ state, index });
    if (this.history.length > 8) this.history.shift();
    this.latest = state;
    if (this.history.length === 2) this.playback.clear();
    this.playback.receive(state.tick, now, STEP_MS);
    const me = index.get(self);
    if (!me) {
      this.predicted = false;
      return;
    }
    this.predict(now);
    const p = this.local,
      head = me.pts[0]!;
    const reset =
      !this.predicted ||
      p.spawnTick !== (me.spawnTick ?? 0) ||
      p.id !== me.id ||
      Math.hypot(head.x - p.x[0]!, head.y - p.y[0]!) > 200;
    p.id = me.id;
    p.name = me.name;
    p.skin = me.skin;
    p.hue = me.hue;
    p.len = me.len;
    p.spawnTick = me.spawnTick ?? 0;
    const oldCount = p.count;
    p.count = Math.min(MAX_POINTS, segmentCount(me.len));
    if (reset) {
      for (let i = 0; i < p.count; i++) {
        const q = me.pts[Math.min(i, me.pts.length - 1)]!;
        p.x[i] = q.x;
        p.y[i] = q.y;
      }
      p.angle = me.angle;
      this.angle = me.angle;
      this.errorX = this.errorY = 0;
    } else {
      for (let i = oldCount; i < p.count; i++) {
        p.x[i] = p.x[i - 1]!;
        p.y[i] = p.y[i - 1]!;
      }
      // Correct location gradually, but never rewind the player's current heading.
      this.errorX = head.x - p.x[0]!;
      this.errorY = head.y - p.y[0]!;
    }
    this.predicted = true;
    this.last = this.received = now;
  }
  private predict(now: number): void {
    if (!this.predicted) return;
    let dt =
      Math.min(
        0.12,
        Math.max(0, Math.min(now, this.received + this.playback.predictionWindow) - this.last) /
          1000,
      ) * this.playback.clockRate;
    this.last = now;
    const p = this.local;
    p.boost = this.boost && p.len > 12;
    const speed = p.boost ? BOOST_SPEED : BASE_SPEED;
    while (dt > 0.000001) {
      const step = Math.min(dt, 1 / 120);
      const delta = Math.atan2(Math.sin(this.angle - p.angle), Math.cos(this.angle - p.angle));
      p.angle += Math.max(-5.4 * step, Math.min(5.4 * step, delta));
      const error = Math.hypot(this.errorX, this.errorY);
      const blend = error > 0 ? Math.min(1, (speed * 0.2 * step) / error) : 0;
      const dx = this.errorX * blend,
        dy = this.errorY * blend;
      this.errorX -= dx;
      this.errorY -= dy;
      p.x[0] = p.x[0]! + Math.cos(p.angle) * speed * step + dx;
      p.y[0] = p.y[0]! + Math.sin(p.angle) * speed * step + dy;
      for (let i = 1; i < p.count; i++) {
        const x = p.x[i]! - p.x[i - 1]!,
          y = p.y[i]! - p.y[i - 1]!,
          distance = Math.hypot(x, y);
        if (distance > 8) {
          p.x[i] = p.x[i - 1]! + (x * 8) / distance;
          p.y[i] = p.y[i - 1]! + (y * 8) / distance;
        }
      }
      dt -= step;
    }
  }
  /** No arrays, objects, closures or strings are created by this render path. */
  sample(now: number): void {
    this.count = 0;
    if (!this.history.length || !this.latest) return;
    const tick = this.playback.sample(now, this.history[0]!.state.tick, STEP_MS);
    let a = this.history[0]!,
      b = a;
    for (let i = 1; i < this.history.length; i++) {
      b = this.history[i]!;
      if (b.state.tick >= tick) break;
      a = b;
    }
    const alpha =
      b.state.tick > a.state.tick
        ? Math.max(0, Math.min(1, (tick - a.state.tick) / (b.state.tick - a.state.tick)))
        : 1;
    this.predict(now);
    for (let i = 0; i < this.latest.snakes.length && this.count < MAX_ENTITIES; i++) {
      const current = this.latest.snakes[i]!,
        target = b.index.get(current.id);
      if (!target || target.spawnTick !== current.spawnTick) continue;
      const out = this.pool[this.count++]!;
      out.id = current.id;
      out.name = current.name;
      out.skin = current.skin;
      out.hue = current.hue;
      out.len = target.len;
      out.bot = current.bot;
      out.boost = target.boost;
      out.spawnTick = current.spawnTick ?? 0;
      const previous = a.index.get(current.id);
      const source = previous && previous.spawnTick === target.spawnTick ? previous : target;
      out.count = Math.min(MAX_POINTS, target.pts.length);
      out.angle =
        source!.angle +
        Math.atan2(Math.sin(target.angle - source!.angle), Math.cos(target.angle - source!.angle)) *
          alpha;
      out.minX = out.minY = Infinity;
      out.maxX = out.maxY = -Infinity;
      const local = current.id === this.self && this.predicted;
      if (local) {
        out.count = this.local.count;
        out.angle = this.local.angle;
        out.len = this.local.len;
        out.boost = this.local.boost;
      }
      for (let j = 0; j < out.count; j++) {
        let x: number, y: number;
        if (local) {
          x = this.local.x[j]!;
          y = this.local.y[j]!;
        } else {
          const q = target.pts[j]!,
            p = source!.pts[j] ?? q;
          x = p.x + (q.x - p.x) * alpha;
          y = p.y + (q.y - p.y) * alpha;
        }
        out.x[j] = x;
        out.y[j] = y;
        out.minX = Math.min(out.minX, x);
        out.minY = Math.min(out.minY, y);
        out.maxX = Math.max(out.maxX, x);
        out.maxY = Math.max(out.maxY, y);
      }
    }
  }
}
