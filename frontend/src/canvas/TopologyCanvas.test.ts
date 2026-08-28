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
import { mergeMeasurements } from "./TopologyCanvas";

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
