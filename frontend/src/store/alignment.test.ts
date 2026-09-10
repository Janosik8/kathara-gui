import { describe, expect, it } from "vitest";
import { type Node, newNode } from "../types";
import {
  type AlignmentAction,
  computeAlignment,
  distributionStep,
  minimumSelection,
} from "./alignment";

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
    // 0, 100, 1000 -> 0, 500, 1000. Wide enough that the minimum gap, which
    // guards against unreadable labels, does not come into play.
    const result = computeAlignment(nodes([0, 0], [100, 0], [1000, 0]), "distributeX");
    expect(result).toEqual({ r2: { x: 500, y: 0 } });
  });

  it("distributes by position, not by list order", () => {
    const result = computeAlignment(nodes([1000, 0], [0, 0], [100, 0]), "distributeX");
    expect(result).toEqual({ r3: { x: 500, y: 0 } });
  });

  it("distributes vertically", () => {
    const result = computeAlignment(nodes([0, 0], [0, 100], [0, 1000]), "distributeY");
    expect(result).toEqual({ r2: { x: 0, y: 500 } });
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

describe("distributionStep", () => {
  it("spaces evenly when there is room", () => {
    expect(distributionStep(0, 1000, 3, 190)).toBe(500);
  });

  it("opens out rather than packing below the minimum", () => {
    // The reported defect: distributing a tight cluster left the interface
    // labels overlapping and unreadable. The labels sit outside the node, so
    // the visible width of a device is well beyond its box.
    expect(distributionStep(0, 100, 3, 190)).toBe(190);
  });

  it("never returns a step below the minimum", () => {
    for (const to of [0, 10, 100, 300]) {
      expect(distributionStep(0, to, 4, 190)).toBeGreaterThanOrEqual(190);
    }
  });

  it("is zero for fewer than two devices", () => {
    expect(distributionStep(0, 500, 1, 190)).toBe(0);
  });
});

describe("distribution keeps labels readable", () => {
  it("does not pack a tight cluster on top of itself", () => {
    // Three devices within 60px: evenly spaced that is 30px apart, which is
    // narrower than a device, let alone its labels.
    const result = computeAlignment(nodes([0, 0], [30, 0], [60, 0]), "distributeX");
    const xs = [0, result.r2!.x, result.r3!.x];
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(190);
    }
  });

  it("anchors on the first device so the row grows one way only", () => {
    const result = computeAlignment(nodes([100, 0], [130, 0], [160, 0]), "distributeX");
    // r1 is the leftmost and does not move.
    expect(result.r1).toBeUndefined();
    expect(result.r2!.x).toBe(290);
  });

  it("leaves a comfortably spread row exactly as it was", () => {
    const result = computeAlignment(nodes([0, 0], [400, 0], [800, 0]), "distributeX");
    expect(result).toEqual({});
  });
});
