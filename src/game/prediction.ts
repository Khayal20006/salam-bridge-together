import { advanceHead, cloneSnake, segmentCount, SEG, type Snake } from "./engine";
import { BodyTrail, angleDelta } from "./movement";

/** Predict only the local player's appearance. Never simulates bots, food or deaths. */
export class LocalPrediction {
  private snake: Snake | undefined;
  private trail: BodyTrail | undefined;
  private target: number | undefined;
  private boost = false;
  private sent = new Map<number, number>();
  private lead = 0;
  private clock = 0;
  private receivedAt = -Infinity;
  private correction = { x: 0, y: 0, angle: 0 };
  private visual = { x: 0, y: 0, angle: 0 };

  clear(): void {
    this.snake = undefined;
    this.trail = undefined;
    this.target = undefined;
    this.sent.clear();
    this.lead = 0;
    this.receivedAt = -Infinity;
    this.correction.x = this.correction.y = this.correction.angle = 0;
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
    const sentAt = this.sent.get(authority.inputSeq);
    if (sentAt !== undefined) {
      const measured = Math.min(180, Math.max(0, (at - sentAt) / 2));
      this.lead = this.lead ? this.lead + (measured - this.lead) * 0.2 : measured;
    }
    for (const seq of this.sent.keys()) if (seq <= authority.inputSeq) this.sent.delete(seq);
    this.snake = cloneSnake(authority);
    this.trail = new BodyTrail(this.snake.pts);
    this.receivedAt = this.clock = at;
    if (sameLife && this.target !== undefined) this.advance(this.lead / 1000);
    const head = this.snake.pts[0]!;
    const dx = this.visual.x - head.x,
      dy = this.visual.y - head.y;
    const soft = sameLife && dx * dx + dy * dy < 10000;
    this.correction.x = soft ? dx : 0;
    this.correction.y = soft ? dy : 0;
    this.correction.angle = soft ? angleDelta(this.snake.angle, this.visual.angle) : 0;
    if (!sameLife) {
      this.visual.x = head.x;
      this.visual.y = head.y;
      this.visual.angle = this.snake.angle;
    }
  }
  private advance(seconds: number): void {
    if (!this.snake || !this.trail || seconds <= 0) return;
    if (this.target !== undefined) {
      this.snake.target = this.target;
      this.snake.boost = this.boost;
    }
    let remaining = seconds;
    while (remaining > 0.000001) {
      const step = Math.min(1 / 60, remaining);
      const head = advanceHead(this.snake, step);
      this.snake.pts = this.trail.advance(head, segmentCount(this.snake.len), SEG);
      remaining -= step;
    }
  }
  renderInto(shown: Snake, now: number): boolean {
    if (
      !this.snake ||
      !this.trail ||
      shown.id !== this.snake.id ||
      shown.spawnTick !== this.snake.spawnTick
    )
      return false;
    const dt = Math.min(50, Math.max(0, now - this.clock));
    this.clock = now;
    // Stop speculation during a stalled connection; never keep a disconnected snake alive.
    const available = Math.max(0, 250 - (now - dt - this.receivedAt));
    this.advance(Math.min(dt, available) / 1000);
    const decay = Math.exp(-dt / 60);
    this.correction.x *= decay;
    this.correction.y *= decay;
    this.correction.angle *= decay;
    const points = this.snake.pts;
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      let out = shown.pts[i];
      if (!out) out = shown.pts[i] = { x: 0, y: 0 };
      out.x = p.x + this.correction.x;
      out.y = p.y + this.correction.y;
    }
    shown.pts.length = points.length;
    shown.angle = this.snake.angle + this.correction.angle;
    shown.len = this.snake.len;
    shown.boost = this.snake.boost;
    this.visual.x = shown.pts[0]!.x;
    this.visual.y = shown.pts[0]!.y;
    this.visual.angle = shown.angle;
    return true;
  }
}
