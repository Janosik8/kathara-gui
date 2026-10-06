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

describe("link", () => {
  it("attaches both devices to one collision domain", () => {
    const next = apply(base(), { type: "link", a: "r1", b: "r2", collisionDomain: "A" });
    expect(next.nodes[0]!.interfaces[0]!.collision_domain).toBe("A");
    expect(next.nodes[1]!.interfaces[0]!.collision_domain).toBe("A");
    expect(next.collision_domains.map((cd) => cd.name)).toEqual(["A"]);
  });

  it("is a single undo step, not two", () => {
    // Linking is one user intent; undoing it should not take two presses.
    const start = base();
    const linked = apply(start, { type: "link", a: "r1", b: "r2", collisionDomain: "A" });
    expect(linked).not.toBe(start);
    expect(linked.nodes.every((n) => n.interfaces.length === 1)).toBe(true);
  });

  it("refuses to link a device to itself", () => {
    expect(() =>
      apply(base(), { type: "link", a: "r1", b: "r1", collisionDomain: "A" }),
    ).toThrow(/cannot be linked to itself/);
  });

  it("rejects an unknown device without half-applying", () => {
    const start = base();
    expect(() =>
      apply(start, { type: "link", a: "r1", b: "ghost", collisionDomain: "A" }),
    ).toThrow(/No device named/);
    // The caller keeps the original topology, so r1 gained nothing.
    expect(start.nodes[0]!.interfaces).toEqual([]);
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

  it("renumbers the interfaces above it, keeping their addresses", () => {
    const prepared = applyAll(base(), [
      { type: "connect", node: "r1", collisionDomain: "A" },
      { type: "connect", node: "r1", collisionDomain: "B" },
      { type: "updateInterface", node: "r1", number: 1, changes: { ip: "10.0.1.1/24" } },
    ]);
    const next = apply(prepared, { type: "disconnect", node: "r1", number: 0 });
    expect(next.nodes[0]!.interfaces).toEqual([
      { number: 0, collision_domain: "B", ip: "10.0.1.1/24" },
    ]);
  });
});

describe("moving a shared segment", () => {
  const shared = () =>
    applyAll(base(), [
      { type: "connect", node: "r1", collisionDomain: "S" },
      { type: "connect", node: "r2", collisionDomain: "S" },
    ]);

  it("records where it was put, as one undoable edit", () => {
    // Test step 1D.1: a dragged segment snapped back, having nowhere to be kept.
    const next = apply(shared(), { type: "moveDomain", name: "S", position: at(320, 160) });
    expect(next.collision_domains[0]).toEqual({ name: "S", position: at(320, 160) });
    expect(label({ type: "moveDomain", name: "S", position: at(0, 0) })).toBe("Moved S");
  });

  it("does not move when its devices do", () => {
    const pinned = apply(shared(), { type: "moveDomain", name: "S", position: at(320, 160) });
    const next = apply(pinned, { type: "moveNode", name: "r1", position: at(-500, 0) });
    expect(next.collision_domains[0]!.position).toEqual(at(320, 160));
  });

  it("goes back between its devices when the layout is tidied", () => {
    const pinned = apply(shared(), { type: "moveDomain", name: "S", position: at(320, 160) });
    const next = apply(pinned, { type: "moveNodes", positions: {}, releaseDomains: true });
    expect(next.collision_domains[0]!.position).toBeNull();
  });

  it("rejects a segment that is not there", () => {
    expect(() =>
      apply(base(), { type: "moveDomain", name: "Z", position: at(0, 0) }),
    ).toThrow(OperationError);
  });
});

describe("removeLink and interface numbering", () => {
  // Test step 1B.3: r2 linked to r1 (eth0) and r3 (eth1); deleting the r1–r2
  // link left r2 with eth1 alone, and Kathará refused the whole deploy with
  // "Interface `0` missing on device `r2`".
  it("leaves no gap on a device that keeps other links", () => {
    const three: Topology = {
      ...base(),
      nodes: [...base().nodes, newNode("r3", "router", at(200, 0))],
    };
    const next = applyAll(three, [
      { type: "link", a: "r1", b: "r2", collisionDomain: "A" },
      { type: "link", a: "r2", b: "r3", collisionDomain: "B" },
      { type: "removeLink", collisionDomain: "A" },
    ]);
    const r2 = next.nodes.find((n) => n.name === "r2")!;
    expect(r2.interfaces.map((i) => [i.number, i.collision_domain])).toEqual([[0, "B"]]);
  });

  it("leaves devices the link did not touch as they were", () => {
    const prepared = applyAll(base(), [
      { type: "link", a: "r1", b: "r2", collisionDomain: "A" },
      { type: "connect", node: "r1", collisionDomain: "C" },
    ]);
    const next = apply(prepared, { type: "removeLink", collisionDomain: "C" });
    expect(next.nodes[1]).toBe(prepared.nodes[1]);
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
    { type: "link", a: "r1", b: "r2", collisionDomain: "A" },
    { type: "disconnect", node: "r1", number: 0 },
    { type: "removeLink", collisionDomain: "A" },
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

describe("removeNode and collision domains", () => {
  it("drops a domain left with nothing attached", () => {
    // An empty domain is invisible on the canvas but still in the model, and
    // would silently consume address space at the next allocation.
    const linked = apply(base(), { type: "link", a: "r1", b: "r2", collisionDomain: "A" });
    const next = applyAll(linked, [
      { type: "removeNode", name: "r1" },
      { type: "removeNode", name: "r2" },
    ]);
    expect(next.collision_domains).toEqual([]);
  });

  it("keeps a domain that other devices still use", () => {
    const start = applyAll(base(), [
      { type: "addNode", node: newNode("r3", "router", at(0, 0)) },
      { type: "connect", node: "r1", collisionDomain: "A" },
      { type: "connect", node: "r2", collisionDomain: "A" },
      { type: "connect", node: "r3", collisionDomain: "A" },
    ]);
    const next = apply(start, { type: "removeNode", name: "r1" });
    expect(next.collision_domains.map((cd) => cd.name)).toEqual(["A"]);
  });

  it("keeps the planned subnet of a domain still in use", () => {
    const start = applyAll(base(), [
      { type: "link", a: "r1", b: "r2", collisionDomain: "A" },
      { type: "addNode", node: newNode("r3", "router", at(0, 0)) },
      { type: "connect", node: "r3", collisionDomain: "A" },
      { type: "setSubnet", collisionDomain: "A", subnet: "10.0.0.0/24" },
    ]);
    const next = apply(start, { type: "removeNode", name: "r1" });
    expect(next.collision_domains[0]).toEqual({ name: "A", subnet: "10.0.0.0/24" });
  });

  it("still keeps an empty domain after a mere disconnect", () => {
    // Detaching a cable briefly should not discard the addressing plan;
    // deleting the device is the clearer statement of intent.
    const start = applyAll(base(), [
      { type: "link", a: "r1", b: "r2", collisionDomain: "A" },
      { type: "setSubnet", collisionDomain: "A", subnet: "10.0.0.0/24" },
    ]);
    const next = applyAll(start, [
      { type: "disconnect", node: "r1", number: 0 },
      { type: "disconnect", node: "r2", number: 0 },
    ]);
    expect(next.collision_domains[0]?.subnet).toBe("10.0.0.0/24");
  });

  it("is undoable, restoring the domain with the device", () => {
    const start = apply(base(), { type: "link", a: "r1", b: "r2", collisionDomain: "A" });
    const after = applyAll(start, [
      { type: "removeNode", name: "r1" },
      { type: "removeNode", name: "r2" },
    ]);
    // The reducer is pure, so undo is simply the earlier value.
    expect(after.collision_domains).toEqual([]);
    expect(start.collision_domains.map((cd) => cd.name)).toEqual(["A"]);
  });
});

describe("removeLink", () => {
  const linked = () =>
    apply(base(), { type: "link", a: "r1", b: "r2", collisionDomain: "A" });

  it("detaches both ends, not just one", () => {
    // Disconnecting a single interface leaves the other device attached to a
    // domain nothing else is on, which is not what deleting a link means.
    const next = apply(linked(), { type: "removeLink", collisionDomain: "A" });
    expect(next.nodes.every((n) => n.interfaces.length === 0)).toBe(true);
  });

  it("removes the collision domain with it", () => {
    const next = apply(linked(), { type: "removeLink", collisionDomain: "A" });
    expect(next.collision_domains).toEqual([]);
  });

  it("detaches every device on a shared segment", () => {
    const shared = applyAll(base(), [
      { type: "addNode", node: newNode("r3", "router", at(0, 0)) },
      { type: "connect", node: "r1", collisionDomain: "A" },
      { type: "connect", node: "r2", collisionDomain: "A" },
      { type: "connect", node: "r3", collisionDomain: "A" },
    ]);
    const next = apply(shared, { type: "removeLink", collisionDomain: "A" });
    expect(next.nodes.every((n) => n.interfaces.length === 0)).toBe(true);
  });

  it("leaves other links alone", () => {
    const two = applyAll(base(), [
      { type: "addNode", node: newNode("r3", "router", at(0, 0)) },
      { type: "link", a: "r1", b: "r2", collisionDomain: "A" },
      { type: "link", a: "r2", b: "r3", collisionDomain: "B" },
    ]);
    const next = apply(two, { type: "removeLink", collisionDomain: "A" });

    expect(next.collision_domains.map((cd) => cd.name)).toEqual(["B"]);
    // r2 keeps the interface belonging to the link that survived.
    expect(next.nodes[1]!.interfaces.map((i) => i.collision_domain)).toEqual(["B"]);
  });

  it("refuses a domain nothing is connected to", () => {
    expect(() =>
      apply(base(), { type: "removeLink", collisionDomain: "Z" }),
    ).toThrow(/Nothing is connected to Z/);
  });

  it("does not mutate the original", () => {
    const start = linked();
    const snapshot = structuredClone(start);
    apply(start, { type: "removeLink", collisionDomain: "A" });
    expect(start).toEqual(snapshot);
  });
});
