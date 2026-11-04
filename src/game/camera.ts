/** Classic camera response, adjusted for the display's frame interval. */
export class SmoothCamera {
  x = 0;
  y = 0;
  z = 0.8;
  snap(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }
  follow(x: number, y: number, zoom: number, elapsedMs: number): void {
    const frames = Math.min(6, Math.max(0, elapsedMs / (1000 / 60)));
    const positionBlend = 1 - Math.pow(0.85, frames);
    this.x += (x - this.x) * positionBlend;
    this.y += (y - this.y) * positionBlend;
    this.z += (zoom - this.z) * (1 - Math.pow(0.97, frames));
  }
}
