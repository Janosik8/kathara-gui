/**
 * The measurement merge behind the minimap.
 *
 * jsdom cannot lay anything out, so React Flow never measures a node in the
 * test environment and the canvas itself is untestable here. The merge is the
 * part that actually broke — measurements were discarded on every re-render,
 * leaving the minimap with no node sizes to draw and no content bounds for
 * the viewport box — and it is pure, so it can be pinned down.
 */

import type { Node as FlowNode, NodeChange } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  committedMoves,
  dropPosition,
  placementSignature,
  mergeMeasurements,
} from "./TopologyCanvas";

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

  it("changes when a node is moved without being dragged", () => {
    // The reported defect. Tidy layout, align and distribute all move a device
    // programmatically; the handles then had to be re-measured or the links
    // stayed attached where the device used to be. An earlier version excluded
    // position entirely and so never re-measured until the user nudged it.
    const still = withHandles("r1", [[0, "left", "50%"]]);
    const moved = { ...withHandles("r1", [[0, "left", "50%"]]), position: { x: 900, y: 900 } };
    expect(placementSignature([moved])).not.toBe(placementSignature([still]));
  });

  it("does not change from frame to frame while a node is dragged", () => {
    // Re-measuring sixty times a second would be pure waste, and it is the
    // reason position was left out in the first place.
    const frame = (x: number): FlowNode => ({
      ...withHandles("r1", [[0, "left", "50%"]]),
      position: { x, y: 0 },
      dragging: true,
    });
    expect(placementSignature([frame(120)])).toBe(placementSignature([frame(480)]));
  });

  it("re-measures once when the drag ends", () => {
    const dragging: FlowNode = {
      ...withHandles("r1", [[0, "left", "50%"]]),
      position: { x: 480, y: 0 },
      dragging: true,
    };
    const dropped: FlowNode = { ...dragging, dragging: false };
    expect(placementSignature([dropped])).not.toBe(placementSignature([dragging]));
  });

  it("ignores sub-pixel jitter", () => {
    const a = { ...withHandles("r1", [[0, "left", "50%"]]), position: { x: 100.2, y: 50.1 } };
    const b = { ...withHandles("r1", [[0, "left", "50%"]]), position: { x: 100.4, y: 49.9 } };
    expect(placementSignature([a])).toBe(placementSignature([b]));
  });

  it("re-measures a collision-domain node when it moves too", () => {
    // A hub has no placements of its own, but its spokes still attach to it.
    const hub = (x: number): FlowNode => ({ id: "cd:A", position: { x, y: 0 }, data: {} });
    expect(placementSignature([hub(0)])).not.toBe(placementSignature([hub(300)]));
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

describe("committedMoves (UX-03)", () => {
  const end = (id: string, x: number): NodeChange => ({
    type: "position",
    id,
    position: { x, y: 0 },
    dragging: false,
  });

  it("returns every device of a selection dragged together, in one batch", () => {
    const { devices } = committedMoves([end("r1", 10), end("r2", 20), end("pc1", 30)]);
    expect(devices).toEqual({ r1: { x: 10, y: 0 }, r2: { x: 20, y: 0 }, pc1: { x: 30, y: 0 } });
  });

  it("ignores the frames of a drag still in progress", () => {
    const moving: NodeChange = { type: "position", id: "r1", position: { x: 5, y: 5 }, dragging: true };
    expect(committedMoves([moving])).toEqual({ devices: {}, domains: {}, zones: {} });
  });

  it("keeps a zone apart from the devices, so moving it moves none of them (FR-10)", () => {
    const { devices, zones } = committedMoves([end("zone:z1", 30), end("r1", 10)]);
    expect(zones).toEqual({ z1: { x: 30, y: 0 } });
    expect(devices).toEqual({ r1: { x: 10, y: 0 } });
  });

  it("keeps a shared segment's node apart from the devices", () => {
    const { devices, domains } = committedMoves([end("r1", 10), end("cd:A", 40)]);
    expect(devices).toEqual({ r1: { x: 10, y: 0 } });
    expect(domains).toEqual({ A: { x: 40, y: 0 } });
  });
});

describe("dropPosition", () => {
  it("puts the picture under the pointer, on the grid (FR-48)", () => {
    expect(dropPosition({ x: 230, y: 220 })).toEqual({ x: 192, y: 192 });
    expect(dropPosition({ x: 240, y: 230 })).toEqual({ x: 208, y: 208 });
  });

  it("works left of and above the origin", () => {
    expect(dropPosition({ x: 0, y: 0 })).toEqual({ x: -32, y: -16 });
  });
});
