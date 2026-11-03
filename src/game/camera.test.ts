import { describe, expect, it } from "vitest";
import { SmoothCamera } from "./camera";

describe("camera following boost", () => {
  it("filters packet-sized position steps without a first-frame camera kick or overshoot", () => {
    const camera = new SmoothCamera();
    camera.snap(0, 0);
    camera.follow(8, 0, 0.8, 1000 / 60);
    expect(camera.x).toBeGreaterThan(0);
    expect(camera.x).toBeLessThan((8 * 0.15) / 2);
    for (let i = 0; i < 120; i++) {
      camera.follow(8, 0, 0.8, 1000 / 60);
      expect(camera.x).toBeLessThanOrEqual(8);
    }
    expect(camera.x).toBeCloseTo(8, 4);
  });
  it("reduces camera velocity jolts while tracking a boosting head with network corrections", () => {
    const camera = new SmoothCamera();
    camera.snap(0, 0);
    let old = 0,
      lastNew = 0,
      lastOld = 0,
      newVelocity = 0,
      oldVelocity = 0,
      maxNew = 0,
      maxOld = 0;
    for (let frame = 1; frame <= 300; frame++) {
      const target = (320 * frame) / 60 + (Math.floor(frame / 6) % 2 === 0 ? 3 : -3);
      camera.follow(target, 0, 0.8, 1000 / 60);
      old += (target - old) * 0.15;
      const nv = (camera.x - lastNew) * 60,
        ov = (old - lastOld) * 60;
      if (frame > 60) {
        maxNew = Math.max(maxNew, Math.abs(nv - newVelocity));
        maxOld = Math.max(maxOld, Math.abs(ov - oldVelocity));
      }
      lastNew = camera.x;
      lastOld = old;
      newVelocity = nv;
      oldVelocity = ov;
    }
    expect(maxNew).toBeLessThan(maxOld * 0.6);
    expect(1600 - camera.x).toBeLessThan(45);
  });
  it("follows the same route at different refresh rates and resets velocity on respawn", () => {
    const follow = (fps: number) => {
      const camera = new SmoothCamera();
      for (let frame = 1; frame <= fps * 2; frame++)
        camera.follow((320 * frame) / fps, 0, 0.8, 1000 / fps);
      return camera;
    };
    const a = follow(60),
      b = follow(120);
    expect(Math.abs(a.x - b.x)).toBeLessThan(2);
    a.snap(-100, 50);
    a.follow(-100, 50, 0.8, 1000 / 60);
    expect(a.x).toBe(-100);
    expect(a.y).toBe(50);
  });
});
