import { describe, expect, it } from "vitest";
import { type Topology, newNode } from "../types";
import { type Operation, OperationError, apply, applyAll, describe as label } from "./operations";

const at = (x: number, y: number) => ({ x, y });

function base(): Topology {
  return {
    name: "lab",
    nodes: [newNode("r1", "router", at(0, 0)), newNode("r2", "router", at(100, 0))],
    collision_domains: [],
  };
}

describe("addNode", () => {
  it("appends the device", () => {
    const next = apply(base(), { type: "addNode", node: newNode("r3", "router", at(0, 0)) });
    expect(next.nodes.map((n) => n.name)).toEqual(["r1", "r2", "r3"]);
  });

  it("rejects a duplicate name", () => {
    expect(() =>
      apply(base(), { type: "addNode", node: newNode("r1", "pc", at(0, 0)) }),
    ).toThrow(OperationError);
  });

  it("rejects a name differing only by case", () => {
    // "R1" and "r1" are one directory on macOS and Windows.
    expect(() =>
      apply(base(), { type: "addNode", node: newNode("R1", "pc", at(0, 0)) }),
    ).toThrow(/already exists/);
  });
});

describe("connect", () => {
  it("assigns the lowest free interface number", () => {
    const next = applyAll(base(), [
      { type: "connect", node: "r1", collisionDomain: "A" },
      { type: "connect", node: "r1", collisionDomain: "B" },
    ]);
    expect(next.nodes[0]!.interfaces.map((i) => i.number)).toEqual([0, 1]);
  });

  it("registers the collision domain on first use", () => {
    const next = apply(base(), { type: "connect", node: "r1", collisionDomain: "A" });
    expect(next.collision_domains.map((cd) => cd.name)).toEqual(["A"]);
  });

  it("does not register the same collision domain twice", () => {
    const next = applyAll(base(), [
      { type: "connect", node: "r1", collisionDomain: "A" },
      { type: "connect", node: "r2", collisionDomain: "A" },
    ]);
    expect(next.collision_domains).toHaveLength(1);
  });

  it("rejects an interface number already in use", () => {
    const once = apply(base(), { type: "connect", node: "r1", collisionDomain: "A", number: 0 });
    expect(() =>
      apply(once, { type: "connect", node: "r1", collisionDomain: "B", number: 0 }),
    ).toThrow(/already has an eth0/);
  });

  it("rejects an unknown device", () => {
    expect(() => apply(base(), { type: "connect", node: "nope", collisionDomain: "A" })).toThrow(
      /No device named/,
    );
  });
});

describe("disconnect", () => {
  it("removes the interface", () => {
    const connected = apply(base(), { type: "connect", node: "r1", collisionDomain: "A" });
    const next = apply(connected, { type: "disconnect", node: "r1", number: 0 });
    expect(next.nodes[0]!.interfaces).toEqual([]);
  });

  it("keeps the collision domain so a planned subnet is not lost", () => {
    const prepared = applyAll(base(), [
      { type: "connect", node: "r1", collisionDomain: "A" },
      { type: "setSubnet", collisionDomain: "A", subnet: "10.0.0.0/24" },
    ]);
    const next = apply(prepared, { type: "disconnect", node: "r1", number: 0 });
    expect(next.collision_domains[0]).toEqual({ name: "A", subnet: "10.0.0.0/24" });
  });

  it("rejects an interface that is not there", () => {
    expect(() => apply(base(), { type: "disconnect", node: "r1", number: 3 })).toThrow(
      /has no eth3/,
    );
  });
});

describe("renameNode", () => {
  it("renames in place", () => {
    const next = apply(base(), { type: "renameNode", from: "r1", to: "core1" });
    expect(next.nodes.map((n) => n.name)).toEqual(["core1", "r2"]);
  });

  it("is a no-op when the name is unchanged", () => {
    const start = base();
    expect(apply(start, { type: "renameNode", from: "r1", to: "r1" })).toBe(start);
  });

  it("rejects colliding with an existing name", () => {
    expect(() => apply(base(), { type: "renameNode", from: "r1", to: "r2" })).toThrow(
      /already exists/,
    );
  });
});

describe("updateInterface", () => {
  it("sets an address", () => {
    const connected = apply(base(), { type: "connect", node: "r1", collisionDomain: "A" });
    const next = apply(connected, {
      type: "updateInterface",
      node: "r1",
      number: 0,
      changes: { ip: "10.0.0.1/24" },
    });
    expect(next.nodes[0]!.interfaces[0]!.ip).toBe("10.0.0.1/24");
  });
});

describe("purity", () => {
  it("never mutates the input topology", () => {
    const start = base();
    const snapshot = structuredClone(start);
    applyAll(start, [
      { type: "connect", node: "r1", collisionDomain: "A" },
      { type: "moveNode", name: "r1", position: at(9, 9) },
      { type: "removeNode", name: "r2" },
    ]);
    expect(start).toEqual(snapshot);
  });
});

describe("describe", () => {
  const cases: Operation[] = [
    { type: "addNode", node: newNode("r3", "router", at(0, 0)) },
    { type: "removeNode", name: "r1" },
    { type: "moveNode", name: "r1", position: at(1, 1) },
    { type: "renameNode", from: "r1", to: "r9" },
    { type: "updateNode", name: "r1", changes: {} },
    { type: "connect", node: "r1", collisionDomain: "A" },
    { type: "disconnect", node: "r1", number: 0 },
    { type: "updateInterface", node: "r1", number: 0, changes: {} },
    { type: "setSubnet", collisionDomain: "A", subnet: "10.0.0.0/24" },
    { type: "setSubnet", collisionDomain: "A", subnet: null },
    { type: "setLabMetadata", changes: { author: "x" } },
    { type: "replaceTopology", topology: base() },
  ];

  // Every operation must be announceable: a screen-reader user relies on
  // this text to know an edit happened at all.
  it.each(cases)("describes $type", (op) => {
    expect(label(op)).toBeTruthy();
  });
});
