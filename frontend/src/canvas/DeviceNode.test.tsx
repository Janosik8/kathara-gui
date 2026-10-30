import { render } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { DEVICE_KINDS, type DeviceKind, type Interface } from "../types";
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

function drawWith(interfaces: Interface[], hosts?: Map<number, string | null>) {
  const data: DeviceNodeData = { label: "r1", kind: "router", interfaces, placements: new Map(), hosts };
  const props = { id: "r1", data, selected: false } as unknown as NodeProps;
  return render(
    <ReactFlowProvider>
      <DeviceNode {...props} />
    </ReactFlowProvider>,
  ).container;
}

describe("DeviceNode interface addresses (FR-49)", () => {
  const ifaces: Interface[] = [
    { number: 0, collision_domain: "A", ip: "192.168.0.1/24" },
    { number: 1, collision_domain: "B" },
  ];

  it("shows the host part with a label, apart from the name", () => {
    const node = drawWith(ifaces, new Map([[0, ".1"], [1, null]]));
    const labels = [...node.querySelectorAll(".iface__label")];
    expect(labels.map((l) => l.textContent)).toEqual(["eth0.1", "eth1"]);
    expect(labels[0]!.querySelector(".iface__host")?.textContent).toBe(".1");
  });

  it("shows only the names while the switch is off", () => {
    const node = drawWith(ifaces);
    expect(node.querySelector(".iface__host")).toBeNull();
  });
});

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
