import { describe, expect, it } from "vitest";
import { angleDelta, interpolateAngle, smoothTurn, traceBodyCurve } from "./movement";

describe("fluid snake movement", () => {
  it("interpolates head rotation through the shortest arc across the angle boundary", () => {
    const angle = interpolateAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    expect(Math.abs(angleDelta(angle, Math.PI))).toBeLessThan(0.000001);
    expect(interpolateAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
  });
  it("eases into a turn and settles on the requested heading", () => {
    let state = { angle: 0, velocity: 0 };
    state = smoothTurn(state.angle, Math.PI / 2, state.velocity, 8.4, 1 / 30);
    expect(state.angle).toBeGreaterThan(0);
    expect(state.angle).toBeLessThan(0.2);
    for (let i = 0; i < 90; i++)
      state = smoothTurn(state.angle, Math.PI / 2, state.velocity, 8.4, 1 / 30);
    expect(Math.abs(angleDelta(state.angle, Math.PI / 2))).toBeLessThan(0.001);
  });
  it("softens a reversed steering input without instantly reversing angular velocity", () => {
    const before = smoothTurn(0, Math.PI / 2, 8, 8.4, 1 / 30);
    const after = smoothTurn(before.angle, -Math.PI / 2, before.velocity, 8.4, 1 / 30);
    expect(after.velocity).toBeLessThan(before.velocity);
    expect(after.velocity).toBeGreaterThan(-8.4);
  });
  it("joins skin sections on the same smooth spine without gaps at their boundaries", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 16, y: 8 },
      { x: 16, y: 16 },
    ];
    const moves: number[][] = [],
      curves: number[][] = [];
    const pen = {
      moveTo: (...p: number[]) => {
        moves.push(p);
      },
      lineTo: () => {},
      quadraticCurveTo: (...p: number[]) => {
        curves.push(p);
      },
    };
    traceBodyCurve(pen, points, 0, 1);
    const boundary = curves.at(-1)!.slice(2);
    traceBodyCurve(pen, points, 2, 3);
    expect(moves[1]).toEqual(boundary);
    expect(curves.at(-1)!.slice(2)).toEqual([16, 16]);
  });
});
