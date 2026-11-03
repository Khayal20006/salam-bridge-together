/** Render remote snakes on simulation time, rather than variable packet arrival intervals. */
export class SnapshotPlayback {
  private tick: number | undefined;
  private newest: number | undefined;
  private receivedAt = 0;
  private clock = 0;
  private delay = 100;

  clear(): void {
    this.tick = this.newest = undefined;
    this.delay = 100;
  }

  receive(tick: number, now: number, stepMs: number): void {
    if (this.newest !== undefined && tick <= this.newest) return;
    if (this.newest !== undefined) {
      const simulated = (tick - this.newest) * stepMs;
      const jitter = Math.abs(now - this.receivedAt - simulated);
      const desired = Math.min(200, 100 + jitter * 2);
      // Build a little more buffer on an uneven connection; release it slowly.
      this.delay += (desired - this.delay) * (desired > this.delay ? 0.25 : 0.025);
    }
    this.newest = tick;
    this.receivedAt = now;
    if (this.tick === undefined) {
      this.tick = tick - this.delay / stepMs;
      this.clock = now;
    }
  }

  sample(now: number, oldest: number, stepMs: number): number {
    if (this.tick === undefined || this.newest === undefined) return oldest;
    const elapsed = Math.max(0, Math.min(50, now - this.clock));
    this.clock = now;
    const sincePacket = Math.max(0, now - this.receivedAt);
    const target = this.newest + (sincePacket - this.delay) / stepMs;
    const errorMs = (target - this.tick) * stepMs;
    // Small speed changes absorb jitter without reversing or snapping a body.
    const rate = 1 + Math.max(-0.1, Math.min(0.1, errorMs / 500));
    this.tick = Math.max(oldest, Math.min(this.newest, this.tick + (elapsed * rate) / stepMs));
    return this.tick;
  }
}
