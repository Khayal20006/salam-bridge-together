/** Render remote snakes on simulation time, rather than variable packet arrival intervals. */
export class SnapshotPlayback {
  private tick: number | undefined;
  private newest: number | undefined;
  private receivedAt = 0;
  private clock = 0;
  private delay = 100;
  private cadence = 50;
  private rate = 1;
  get predictionWindow(): number {
    return Math.min(750, Math.max(250, this.cadence * 2.5));
  }
  get clockRate(): number {
    return this.rate;
  }

  clear(): void {
    this.tick = this.newest = undefined;
    this.delay = 100;
    this.cadence = 50;
    this.rate = 1;
  }

  receive(tick: number, now: number, stepMs: number): void {
    if (this.newest !== undefined && tick <= this.newest) return;
    if (this.newest !== undefined) {
      const simulated = (tick - this.newest) * stepMs;
      const interval = Math.max(1, now - this.receivedAt);
      this.cadence +=
        (Math.min(500, interval) - this.cadence) * (interval > this.cadence ? 0.5 : 0.05);
      this.rate += (Math.max(0.35, Math.min(1.25, simulated / interval)) - this.rate) * 0.1;
      const jitter = Math.abs(interval - simulated / this.rate);
      const desired = Math.min(450, Math.max(100, this.cadence * 1.25 + jitter));
      // Build a little more buffer on an uneven connection; release it slowly.
      this.delay += (desired - this.delay) * (desired > this.delay ? 0.25 : 0.025);
    }
    this.newest = tick;
    this.receivedAt = now;
    if (this.tick === undefined) {
      this.tick = tick - (this.delay * this.rate) / stepMs;
      this.clock = now;
    }
  }

  sample(now: number, oldest: number, stepMs: number): number {
    if (this.tick === undefined || this.newest === undefined) return oldest;
    // Keep simulation time moving even when a slow device renders below 20 fps.
    const elapsed = Math.max(0, Math.min(120, now - this.clock));
    this.clock = now;
    const sincePacket = Math.max(0, now - this.receivedAt);
    const target = this.newest + ((sincePacket - this.delay) * this.rate) / stepMs;
    const errorMs = (target - this.tick) * stepMs;
    // Small speed changes absorb jitter without reversing or snapping a body.
    const rate = this.rate * (1 + Math.max(-0.35, Math.min(0.1, errorMs / 500)));
    this.tick = Math.max(oldest, Math.min(this.newest, this.tick + (elapsed * rate) / stepMs));
    return this.tick;
  }
}
