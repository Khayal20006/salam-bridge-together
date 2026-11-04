import {
  advanceHead,
  cloneSnake,
  segmentCount,
  SEG,
  BASE_SPEED,
  BOOST_SPEED,
  type Snake,
} from "./engine";
import { angleDelta } from "./movement";
import { followClassicBody } from "./classic-body";

/** Predict only the local player's appearance. Never simulates bots, food or deaths. */
export class LocalPrediction {
  private snake: Snake | undefined;
  private target: number | undefined;
  private boost = false;
  private sent = new Map<number, number>();
  private lead = 0;
  private clock = 0;
  private receivedAt = -Infinity;
  private correction = { x: 0, y: 0, angle: 0 };
  private visual = { x: 0, y: 0, angle: 0 };
  private bodyCorrection: { x: number; y: number }[] = [];
  private visibleBody: { x: number; y: number }[] = [];

  clear(): void {
    this.snake = undefined;
    this.target = undefined;
    this.sent.clear();
    this.lead = 0;
    this.receivedAt = -Infinity;
    this.correction.x = this.correction.y = this.correction.angle = 0;
    this.bodyCorrection.length = this.visibleBody.length = 0;
  }
  steer(angle: number, boost: boolean): void {
    this.target = angle;
    this.boost = boost;
  }
  command(seq: number, at: number): void {
    this.sent.set(seq, at);
    if (this.sent.size > 64) this.sent.delete(this.sent.keys().next().value!);
  }
  reconcile(authority: Snake, at: number): void {
    // Older servers can omit acknowledgements. Continue normal interpolation there.
    if (authority.inputSeq === undefined) {
      this.clear();
      return;
    }
    const sameLife =
      this.snake?.id === authority.id && this.snake?.spawnTick === authority.spawnTick;
    // Advance to packet arrival before replacing the baseline. Otherwise the time
    // since the preceding paint is discarded on every publication (a 10 Hz hitch).
    if (sameLife) this.updateTo(at);
    const sentAt = this.sent.get(authority.inputSeq);
    if (sentAt !== undefined) {
      // A single ack can arrive just after a snapshot, making the raw RTT look
      // tiny. A small floor plus slow smoothing avoids pulsing the local speed.
      const measured = Math.min(180, Math.max(20, (at - sentAt) / 2));
      this.lead = this.lead ? this.lead + (measured - this.lead) * 0.08 : measured;
    }
    for (const seq of this.sent.keys()) if (seq <= authority.inputSeq) this.sent.delete(seq);
    const localAngle = this.snake?.angle;
    if (sameLife && this.snake) {
      const points = this.snake.pts;
      Object.assign(this.snake, authority, { pts: points });
      for (let i = 0; i < authority.pts.length; i++) {
        const p = points[i] ?? (points[i] = { x: 0, y: 0 });
        p.x = authority.pts[i]!.x;
        p.y = authority.pts[i]!.y;
      }
      points.length = authority.pts.length;
    } else {
      this.snake = cloneSnake(authority);
    }
    this.receivedAt = this.clock = at;
    if (sameLife && this.target !== undefined) this.advance(this.lead / 1000);
    // Authority reports an older input. Keep the heading already reached with
    // current local input so each packet cannot rewind the direction of travel.
    if (sameLife && localAngle !== undefined) this.snake.angle = localAngle;
    const head = this.snake.pts[0]!;
    const dx = this.visual.x - head.x,
      dy = this.visual.y - head.y;
    const soft = sameLife && dx * dx + dy * dy < 40000;
    this.correction.x = soft ? dx : 0;
    this.correction.y = soft ? dy : 0;
    this.correction.angle = soft ? angleDelta(this.snake.angle, this.visual.angle) : 0;
    for (let i = 1; i < this.snake.pts.length; i++) {
      const p = this.snake.pts[i]!,
        old = this.visibleBody[i];
      const c = this.bodyCorrection[i] ?? (this.bodyCorrection[i] = { x: 0, y: 0 });
      const x = old ? old.x - p.x : 0,
        y = old ? old.y - p.y : 0;
      const blend = soft && old && x * x + y * y < 40000;
      c.x = blend ? x : 0;
      c.y = blend ? y : 0;
    }
    this.bodyCorrection.length = this.snake.pts.length;
    if (!sameLife) {
      this.visual.x = head.x;
      this.visual.y = head.y;
      this.visual.angle = this.snake.angle;
    }
  }
  private advance(seconds: number): void {
    if (!this.snake || seconds <= 0) return;
    if (this.target !== undefined) {
      this.snake.target = this.target;
      this.snake.boost = this.boost;
    }
    let remaining = seconds;
    while (remaining > 0.000001) {
      const step = Math.min(1 / 60, remaining);
      const head = advanceHead(this.snake, step);
      this.snake.pts = followClassicBody(head, this.snake.pts, segmentCount(this.snake.len), SEG, this.snake.pts);
      remaining -= step;
    }
  }
  renderInto(shown: Snake, now: number): boolean {
    if (
      !this.snake ||
      shown.id !== this.snake.id ||
      shown.spawnTick !== this.snake.spawnTick
    )
      return false;
    this.updateTo(now);
    const points = this.snake.pts;
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      let out = shown.pts[i];
      if (!out) out = shown.pts[i] = { x: 0, y: 0 };
      const correction = i === 0 ? this.correction : this.bodyCorrection[i];
      out.x = p.x + (correction?.x ?? 0);
      out.y = p.y + (correction?.y ?? 0);
    }
    shown.pts.length = points.length;
    shown.angle = this.snake.angle + this.correction.angle;
    shown.len = this.snake.len;
    shown.boost = this.snake.boost;
    return true;
  }
  private updateTo(now: number): void {
    if (!this.snake) return;
    // Low-end phones can render below 20 fps. Do not slow simulation time down
    // on those frames, otherwise the next packet visibly snaps the snake forward.
    const dt = Math.min(120, Math.max(0, now - this.clock));
    this.clock = now;
    // Stop speculation during a stalled connection; never keep a disconnected snake alive.
    const available = Math.max(0, 250 - (now - dt - this.receivedAt));
    this.advance(Math.min(dt, available) / 1000);
    // Bound correction speed rather than applying a large exponential impulse
    // after every packet. Small network errors cannot repeatedly stop the head.
    const length = Math.hypot(this.correction.x, this.correction.y);
    const correctionStep =
      ((this.snake.boost ? BOOST_SPEED : BASE_SPEED) * 0.2 * Math.min(dt, available)) / 1000;
    const scale = length > 0 ? Math.max(0, 1 - correctionStep / length) : 0;
    this.correction.x *= scale;
    this.correction.y *= scale;
    const angularStep = (2 * Math.min(dt, available)) / 1000;
    this.correction.angle -=
      Math.sign(this.correction.angle) * Math.min(Math.abs(this.correction.angle), angularStep);
    const head = this.snake.pts[0]!;
    this.visual.x = head.x + this.correction.x;
    this.visual.y = head.y + this.correction.y;
    this.visual.angle = this.snake.angle + this.correction.angle;
    for (let i = 0; i < this.snake.pts.length; i++) {
      const p = this.snake.pts[i]!,
        c = i === 0 ? this.correction : this.bodyCorrection[i];
      if (i > 0 && c) {
        const length = Math.hypot(c.x, c.y),
          step = correctionStep * 2;
        const scale = length > 0 ? Math.max(0, 1 - step / length) : 0;
        c.x *= scale;
        c.y *= scale;
      }
      const visible = this.visibleBody[i] ?? (this.visibleBody[i] = { x: 0, y: 0 });
      visible.x = p.x + (c?.x ?? 0);
      visible.y = p.y + (c?.y ?? 0);
    }
    this.visibleBody.length = this.snake.pts.length;
  }
}
