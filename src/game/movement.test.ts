import { describe, expect, it } from "vitest";
import {
  BodyTrail,
  angleDelta,
  interpolateAngle,
  smoothSpine,
  smoothTurn,
  traceBodyCurve,
  traceBodyRange,
} from "./movement";

describe("fluid snake movement", () => {
  it("reuses an owned prediction buffer without changing the travelled route or its source", () => {
    const source = Array.from({ length: 24 }, (_, i) => ({ x: -i * 8, y: 0 }));
    const saved = structuredClone(source);
    const immutable = new BodyTrail(source),
      reusable = new BodyTrail(source);
    const output = structuredClone(source),
      first = output[0];
    for (let i = 1; i <= 90; i++) {
      const head = { x: Math.sin(i / 30) * 120, y: (1 - Math.cos(i / 30)) * 120 };
      expect(reusable.advance(head, 24, 8, output)).toEqual(immutable.advance(head, 24, 8));
      expect(output[0]).toBe(first);
    }
    expect(source).toEqual(saved);
    reusable.reset(source);
    expect(reusable.advance({ x: 8, y: 0 }, 24, 8, output)).toEqual(
      new BodyTrail(source).advance({ x: 8, y: 0 }, 24, 8),
    );
  });
  it.each([1, 2, 4])("preserves the neck curve at render detail %i", (detail) => {
    const body = [
      { x: 0, y: 0 },
      { x: -8, y: 0 },
      { x: -16, y: 0 },
      { x: -24, y: 0 },
    ];
    const points: { x: number; y: number }[] = [];
    smoothSpine(body, points, detail, 0.6);
    const facing = Math.atan2(points[0]!.y - points[1]!.y, points[0]!.x - points[1]!.x);
    expect(Math.abs(angleDelta(facing, 0.6))).toBeLessThan(0.15);
    expect(points.at(-1)).toEqual(body.at(-1));
  });
  it("joins fractional skin bands exactly and advances their boundary continuously", () => {
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
    traceBodyRange(pen, points, 0, 1.3);
    const boundary = curves.at(-1)!.slice(2);
    traceBodyRange(pen, points, 1.3, points.length);
    expect(moves.at(-1)).toEqual(boundary);
    traceBodyRange(pen, points, 0, 1.31);
    const next = curves.at(-1)!.slice(2);
    expect(Math.hypot(next[0]! - boundary[0]!, next[1]! - boundary[1]!)).toBeGreaterThan(0);
    expect(Math.hypot(next[0]! - boundary[0]!, next[1]! - boundary[1]!)).toBeLessThan(0.2);
  });
  it("joins the face and neck on a shared tangent when the head changes direction", () => {
    const body = [
      { x: 0, y: 0 },
      { x: -8, y: 0 },
      { x: -16, y: 0 },
      { x: -24, y: 0 },
    ];
    const points: { x: number; y: number }[] = [];
    smoothSpine(body, points, 32, 0.6);
    const direction = Math.atan2(points[0]!.y - points[1]!.y, points[0]!.x - points[1]!.x);
    expect(Math.abs(angleDelta(direction, 0.6))).toBeLessThan(0.05);
    expect(points[32]).toEqual(body[1]);
    expect(points.at(-1)).toEqual(body.at(-1));
  });
  it("draws four times as many spine intervals without changing the network body", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ x: i * 8, y: Math.sin(i / 3) * 8 }));
    const saved = structuredClone(points),
      output: { x: number; y: number }[] = [];
    smoothSpine(points, output, 4);
    expect(output).toHaveLength(37);
    expect(output[0]).toEqual(points[0]);
    expect(output.at(-1)).toEqual(points.at(-1));
    const reused = output[5];
    smoothSpine(points, output, 4);
    expect(output[5]).toBe(reused);
    expect(points).toEqual(saved);
    for (let i = 1; i < output.length; i++)
      expect(
        Math.hypot(output[i]!.x - output[i - 1]!.x, output[i]!.y - output[i - 1]!.y),
      ).toBeLessThan(3);
  });
  it("moves the turn through every body segment and the tail along the head's actual route", () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ x: 0 - i * 8, y: 0 }));
    const trail = new BodyTrail(history);
    const square = [
      { x: 8, y: 0 },
      { x: 16, y: 0 },
      { x: 16, y: 8 },
      { x: 16, y: 16 },
      { x: 8, y: 16 },
      { x: 0, y: 16 },
      { x: 0, y: 8 },
      { x: 0, y: 0 },
    ];
    for (let i = 0; i < 32; i++) {
      const head = square[i % square.length]!;
      history.unshift({ ...head });
      expect(trail.advance(head, 8, 8)).toEqual(history.slice(0, 8));
    }
  });
  it("keeps spacing when the head travels farther than one segment in a boosted tick", () => {
    const trail = new BodyTrail([
      { x: 0, y: 0 },
      { x: -8, y: 0 },
      { x: -16, y: 0 },
    ]);
    expect(trail.advance({ x: 20, y: 0 }, 3, 8)).toEqual([
      { x: 20, y: 0 },
      { x: 12, y: 0 },
      { x: 4, y: 0 },
    ]);
  });
  it("grows into travelled space instead of duplicating a stationary tail point", () => {
    const trail = new BodyTrail([
      { x: 0, y: 0 },
      { x: -8, y: 0 },
      { x: -16, y: 0 },
    ]);
    const growing = trail.advance({ x: 4, y: 0 }, 8, 8);
    expect(growing).toHaveLength(3);
    expect(trail.advance({ x: 8, y: 0 }, 8, 8)).toHaveLength(4);
    expect(new Set(growing.map((p) => `${p.x}:${p.y}`)).size).toBe(growing.length);
  });
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
