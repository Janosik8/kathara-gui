import { getBezierPath, Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { clampLabelAt, cubicPoint, nearestT, parseCubic } from "./linkLabel";

// A link as React Flow draws it, between an interface on the right of one
// device and one on the left of another, lower down.
const [path, midX, midY] = getBezierPath({
  sourceX: 0,
  sourceY: 0,
  sourcePosition: Position.Right,
  targetX: 300,
  targetY: 120,
  targetPosition: Position.Left,
});

describe("link labels along their link (FR-50)", () => {
  it("reads React Flow's own bezier, ends included", () => {
    const curve = parseCubic(path)!;
    expect(curve[0]).toEqual({ x: 0, y: 0 });
    expect(curve[3]).toEqual({ x: 300, y: 120 });
    expect(parseCubic("M 0,0 L 10,10")).toBeNull();
  });

  it("puts the default label where React Flow put it, in the middle", () => {
    const middle = cubicPoint(parseCubic(path)!, 0.5);
    expect(middle.x).toBeCloseTo(midX, 6);
    expect(middle.y).toBeCloseTo(midY, 6);
  });

  it("finds the place on the link nearest the pointer", () => {
    const curve = parseCubic(path)!;
    for (const t of [0.1, 0.3, 0.62, 0.9]) {
      const on = cubicPoint(curve, t);
      // A pointer a little off the line still lands on it, at about t.
      expect(nearestT(curve, { x: on.x + 3, y: on.y - 3 })).toBeCloseTo(t, 1);
      expect(nearestT(curve, on)).toBeCloseTo(t, 2);
    }
  });

  it("keeps a label short of the devices at either end", () => {
    const curve = parseCubic(path)!;
    expect(nearestT(curve, { x: -200, y: -200 })).toBe(0.05);
    expect(nearestT(curve, { x: 900, y: 500 })).toBe(0.95);
    expect(clampLabelAt(0.123456)).toBe(0.123);
  });
});
