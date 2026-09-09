/**
 * The measurement merge behind the minimap.
 *
 * jsdom cannot lay anything out, so React Flow never measures a node in the
 * test environment and the canvas itself is untestable here. The merge is the
 * part that actually broke — measurements were discarded on every re-render,
 * leaving the minimap with no node sizes to draw and no content bounds for
 * the viewport box — and it is pure, so it can be pinned down.
 */

import type { Node as FlowNode } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { placementSignature, mergeMeasurements } from "./TopologyCanvas";

const node = (id: string, measured?: { width: number; height: number }): FlowNode => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
  ...(measured ? { measured } : {}),
});

describe("mergeMeasurements", () => {
  it("carries a measurement across a re-render", () => {
    const previous = [node("r1", { width: 80, height: 40 })];
    const [merged] = mergeMeasurements([node("r1")], previous);
    expect(merged?.measured).toEqual({ width: 80, height: 40 });
  });

  it("keeps measurements for every node, not just the first", () => {
    const previous = [
      node("r1", { width: 80, height: 40 }),
      node("r2", { width: 90, height: 44 }),
    ];
    const merged = mergeMeasurements([node("r1"), node("r2")], previous);
    expect(merged.map((n) => n.measured?.width)).toEqual([80, 90]);
  });

  it("leaves a newly added node unmeasured for React Flow to fill in", () => {
    const merged = mergeMeasurements(
      [node("r1"), node("r2")],
      [node("r1", { width: 80, height: 40 })],
    );
    expect(merged[1]?.measured).toBeUndefined();
  });

  it("takes the derived properties, not the previous ones", () => {
    // Position and class come from the topology; only the size is carried.
    const previous: FlowNode[] = [
      { ...node("r1", { width: 80, height: 40 }), position: { x: 5, y: 5 } },
    ];
    const derived: FlowNode[] = [{ ...node("r1"), position: { x: 99, y: 99 } }];
    const [merged] = mergeMeasurements(derived, previous);

    expect(merged?.position).toEqual({ x: 99, y: 99 });
    expect(merged?.measured).toEqual({ width: 80, height: 40 });
  });

  it("drops nodes that are no longer in the topology", () => {
    const merged = mergeMeasurements([node("r1")], [node("r1"), node("r2")]);
    expect(merged.map((n) => n.id)).toEqual(["r1"]);
  });

  it("does not mutate either input", () => {
    const previous = [node("r1", { width: 80, height: 40 })];
    const derived = [node("r1")];
    mergeMeasurements(derived, previous);
    expect(derived[0]?.measured).toBeUndefined();
  });
});

describe("placementSignature", () => {
  const withHandles = (id: string, handles: [number, string, string][]): FlowNode => ({
    id,
    position: { x: 0, y: 0 },
    data: {
      placements: new Map(
        handles.map(([number, position, offset]) => [number, { position, offset }]),
      ),
    },
  });

  it("changes when a handle moves to another side", () => {
    // The defect: an interface moves to the face pointing at its new peer,
    // but React Flow keeps the old measured bounds and draws the edge to the
    // old spot until the node is dragged.
    const before = placementSignature([withHandles("r1", [[0, "left", "50%"]])]);
    const after = placementSignature([withHandles("r1", [[0, "top", "50%"]])]);
    expect(after).not.toBe(before);
  });

  it("changes when a handle slides along the same side", () => {
    const before = placementSignature([withHandles("r1", [[0, "bottom", "20%"]])]);
    const after = placementSignature([withHandles("r1", [[0, "bottom", "80%"]])]);
    expect(after).not.toBe(before);
  });

  it("changes when a handle appears", () => {
    const before = placementSignature([withHandles("r1", [[0, "left", "50%"]])]);
    const after = placementSignature([
      withHandles("r1", [
        [0, "left", "20%"],
        [1, "left", "80%"],
      ]),
    ]);
    expect(after).not.toBe(before);
  });

  it("does not change when a node merely moves", () => {
    // Re-measuring on every drag frame would be pure waste.
    const still = withHandles("r1", [[0, "left", "50%"]]);
    const moved = { ...withHandles("r1", [[0, "left", "50%"]]), position: { x: 900, y: 900 } };
    expect(placementSignature([moved])).toBe(placementSignature([still]));
  });

  it("tolerates nodes without placements, such as collision domains", () => {
    const hub: FlowNode = { id: "cd:A", position: { x: 0, y: 0 }, data: {} };
    expect(() => placementSignature([hub])).not.toThrow();
    expect(placementSignature([hub])).toContain("cd:A");
  });

  it("distinguishes different devices", () => {
    const a = placementSignature([withHandles("r1", [[0, "left", "50%"]])]);
    const b = placementSignature([withHandles("r2", [[0, "left", "50%"]])]);
    expect(a).not.toBe(b);
  });
});
