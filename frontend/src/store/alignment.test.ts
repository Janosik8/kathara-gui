import { describe, expect, it } from "vitest";
import { type Node, newNode } from "../types";
import { type AlignmentAction, computeAlignment, minimumSelection } from "./alignment";

function nodes(...coords: [number, number][]): Node[] {
  return coords.map(([x, y], i) => newNode(`r${i + 1}`, "router", { x, y }));
}

describe("computeAlignment", () => {
  it("aligns left to the smallest x", () => {
    const result = computeAlignment(nodes([10, 0], [50, 5], [30, 9]), "left");
    expect(result).toEqual({ r2: { x: 10, y: 5 }, r3: { x: 10, y: 9 } });
  });

  it("aligns right to the largest x", () => {
    const result = computeAlignment(nodes([10, 0], [50, 5]), "right");
    expect(result).toEqual({ r1: { x: 50, y: 0 } });
  });

  it("aligns top to the smallest y", () => {
    const result = computeAlignment(nodes([0, 40], [10, 10]), "top");
    expect(result).toEqual({ r1: { x: 0, y: 10 } });
  });

  it("aligns bottom to the largest y", () => {
    const result = computeAlignment(nodes([0, 40], [10, 10]), "bottom");
    expect(result).toEqual({ r2: { x: 10, y: 40 } });
  });

  it("centres on the mean", () => {
    const result = computeAlignment(nodes([0, 0], [100, 0]), "centerX");
    expect(result).toEqual({ r1: { x: 50, y: 0 }, r2: { x: 50, y: 0 } });
  });

  it("preserves the other axis when aligning", () => {
    const result = computeAlignment(nodes([10, 7], [50, 9]), "left");
    expect(result.r2?.y).toBe(9);
  });
});

describe("distribute", () => {
  it("spaces evenly and leaves the outermost nodes alone", () => {
    // 0, 10, 100 -> 0, 50, 100
    const result = computeAlignment(nodes([0, 0], [10, 0], [100, 0]), "distributeX");
    expect(result).toEqual({ r2: { x: 50, y: 0 } });
  });

  it("distributes by position, not by list order", () => {
    const result = computeAlignment(nodes([100, 0], [0, 0], [10, 0]), "distributeX");
    expect(result).toEqual({ r3: { x: 50, y: 0 } });
  });

  it("distributes vertically", () => {
    const result = computeAlignment(nodes([0, 0], [0, 10], [0, 100]), "distributeY");
    expect(result).toEqual({ r2: { x: 0, y: 50 } });
  });
});

describe("no-ops", () => {
  it("returns nothing when the selection is too small to align", () => {
    expect(computeAlignment(nodes([0, 0]), "left")).toEqual({});
  });

  it("returns nothing when the selection is too small to distribute", () => {
    // Two nodes are already 'evenly distributed' between themselves.
    expect(computeAlignment(nodes([0, 0], [10, 0]), "distributeX")).toEqual({});
  });

  it("omits nodes that would not move", () => {
    // Already aligned: dispatching this must not create an undo step.
    expect(computeAlignment(nodes([10, 0], [10, 5]), "left")).toEqual({});
  });
});

describe("minimumSelection", () => {
  const aligns: AlignmentAction[] = ["left", "right", "top", "bottom", "centerX", "centerY"];

  it.each(aligns)("%s needs two", (action) => {
    expect(minimumSelection(action)).toBe(2);
  });

  it.each(["distributeX", "distributeY"] as AlignmentAction[])("%s needs three", (action) => {
    expect(minimumSelection(action)).toBe(3);
  });
});
