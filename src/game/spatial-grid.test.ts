import { describe, expect, it } from "vitest";
import { SpatialGrid } from "./spatial-grid";

describe("reusable spatial index", () => {
  it("deduplicates shared cells and preserves query order across reset", () => {
    const grid = new SpatialGrid<string>(100),
      output = new Set<string>();
    grid.insert(-150, -150, 150, 150, "wide");
    grid.insert(0, 0, 0, 0, "center");
    expect([...grid.query(-200, -200, 200, 200, output)]).toEqual(["wide", "center"]);
    grid.reset();
    expect([...grid.query(-200, -200, 200, 200, output)]).toEqual([]);
    grid.insert(0, 0, 0, 0, "replacement");
    expect([...grid.query(-200, -200, 200, 200, output)]).toEqual(["replacement"]);
  });
  it("keeps independently owned results separate and handles negative coordinates", () => {
    const grid = new SpatialGrid<string>(100),
      a = new Set<string>(),
      b = new Set<string>();
    grid.insert(-100, -100, -100, -100, "negative");
    grid.insert(0, 0, 0, 0, "origin");
    grid.query(-100, -100, -100, -100, a);
    grid.query(0, 0, 0, 0, b);
    expect([...a]).toEqual(["negative"]);
    expect([...b]).toEqual(["origin"]);
    grid.query(1000, 1000, 1000, 1000, b);
    expect(b.size).toBe(0);
    expect([...a]).toEqual(["negative"]);
  });
  it("does not alias distant numeric coordinates or previous tick objects", () => {
    const grid = new SpatialGrid<object>(1),
      first = { id: 1 },
      second = { id: 2 },
      output = new Set<object>();
    grid.insert(0, 0, 0, 0, first);
    grid.insert(65536, 0, 65536, 0, second);
    expect([...grid.query(0, 0, 0, 0, output)]).toEqual([first]);
    grid.reset();
    grid.insert(0, 0, 0, 0, second);
    expect([...grid.query(0, 0, 0, 0, output)]).toEqual([second]);
  });
});
