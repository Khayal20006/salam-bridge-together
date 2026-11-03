class DampedAxis {
  value: number;
  velocity = 0;
  constructor(value = 0) {
    this.value = value;
  }
  follow(target: number, frequency: number, seconds: number): void {
    const error = this.value - target;
    const impulse = (this.velocity + frequency * error) * seconds;
    const decay = Math.exp(-frequency * seconds);
    this.value = target + (error + impulse) * decay;
    this.velocity = (this.velocity - frequency * impulse) * decay;
  }
  snap(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}

/** Continuous camera velocity filters packet corrections instead of passing them into world motion. */
export class SmoothCamera {
  private horizontal = new DampedAxis();
  private vertical = new DampedAxis();
  private scale = new DampedAxis(0.8);
  get x(): number {
    return this.horizontal.value;
  }
  get y(): number {
    return this.vertical.value;
  }
  get z(): number {
    return this.scale.value;
  }
  snap(x: number, y: number): void {
    this.horizontal.snap(x);
    this.vertical.snap(y);
    this.scale.snap(this.scale.value);
  }
  follow(x: number, y: number, zoom: number, elapsedMs: number): void {
    const seconds = Math.min(0.05, Math.max(0, elapsedMs / 1000));
    this.horizontal.follow(x, 20, seconds);
    this.vertical.follow(y, 20, seconds);
    this.scale.follow(zoom, 4, seconds);
  }
}
