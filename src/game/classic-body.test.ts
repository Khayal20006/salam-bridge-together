import { expect, it } from "vitest";
import { followClassicBody } from "./classic-body";
import { SmoothCamera } from "./camera";

it("leaves slack joints still and pulls stretched joints to classic spacing", () => {
  const source = [{x:0,y:0}, {x:-8,y:0}, {x:-16,y:0}];
  const saved = structuredClone(source);
  const moved = followClassicBody({x:0,y:4}, source, 4, 8);
  expect(source).toEqual(saved);
  expect(Math.hypot(moved[1]!.x, moved[1]!.y - 4)).toBeCloseTo(8);
  expect(moved[3]).toEqual(moved[2]);
  const slack = followClassicBody({x:-4,y:0}, source, 3, 8);
  expect(slack[1]).toEqual(source[1]);
  const owned = structuredClone(source);
  expect(followClassicBody({x:0,y:4}, owned, 4, 8, owned)).toEqual(moved);
});

it("keeps the classic camera response at both 60 and 120 Hz", () => {
  const sixty = new SmoothCamera(), fast = new SmoothCamera();
  sixty.follow(100, 200, 1, 1000/60);
  expect(sixty.x).toBeCloseTo(15);
  fast.follow(100, 200, 1, 1000/120);
  fast.follow(100, 200, 1, 1000/120);
  expect(fast.x).toBeCloseTo(sixty.x);
  expect(fast.y).toBeCloseTo(sixty.y);
  expect(fast.z).toBeCloseTo(sixty.z);
});
