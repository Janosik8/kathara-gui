import { render } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { DEVICE_KINDS, type DeviceKind } from "../types";
import { DeviceNode, type DeviceNodeData } from "./DeviceNode";

function draw(kind: DeviceKind, selected = false) {
  const data: DeviceNodeData = { label: `${kind}1`, kind, interfaces: [], placements: new Map() };
  const props = { id: `${kind}1`, data, selected } as unknown as NodeProps;
  return render(
    <ReactFlowProvider>
      <DeviceNode {...props} />
    </ReactFlowProvider>,
  ).container;
}

describe("DeviceNode (UX-08)", () => {
  it("draws each kind as its own picture, with the name under it", () => {
    const sources = DEVICE_KINDS.map((kind) => {
      const node = draw(kind);
      const icon = node.querySelector<HTMLImageElement>("img.device__icon");
      expect(icon, kind).not.toBeNull();
      expect(node.querySelector(".device__name")?.textContent).toBe(`${kind}1`);
      return icon!.getAttribute("src");
    });
    // Four kinds, four pictures: a shared one would make two kinds look alike.
    expect(new Set(sources).size).toBe(DEVICE_KINDS.length);
  });

  it("treats the picture as decoration, not as content", () => {
    // The canvas is aria-hidden and the tree view says the kind in words; an
    // alt text here would only be read twice where the canvas is not hidden.
    const icon = draw("router").querySelector("img.device__icon")!;
    expect(icon.getAttribute("alt")).toBe("");
    expect(icon.getAttribute("draggable")).toBe("false");
  });

  it("marks the selected device", () => {
    expect(draw("pc", true).querySelector(".device")?.hasAttribute("data-selected")).toBe(true);
    expect(draw("pc").querySelector(".device")?.hasAttribute("data-selected")).toBe(false);
  });
});
