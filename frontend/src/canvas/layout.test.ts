/**
 * Interface sides are chosen by geometry, so the tests are geometric.
 *
 * The behaviour that matters: a link leaves the face pointing at its peer,
 * rather than the face its interface number happens to imply.
 */

import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { Node, Topology } from "../types";
import { computePlacements, domainPosition, STUB_DISTANCE, preferredSide } from "./layout";

function device(name: string, x: number, y: number, domains: string[]): Node {
  return {
    name,
    kind: "router",
    bridged: false,
    position: { x, y },
    daemons: [],
    extra_options: {},
    interfaces: domains.map((collision_domain, number) => ({ number, collision_domain })),
  };
}

const topology = (...nodes: Node[]): Topology => ({
  name: "lab",
  nodes,
  collision_domains: [],
});

const sideOf = (t: Topology, name: string, iface: number) =>
  computePlacements(t).get(name)?.get(iface)?.position;

describe("preferredSide", () => {
  it("points at a peer to the right", () => {
    expect(preferredSide({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(Position.Right);
  });

  it("points at a peer to the left", () => {
    expect(preferredSide({ x: 100, y: 0 }, { x: 0, y: 0 })).toBe(Position.Left);
  });

  it("points at a peer below", () => {
    expect(preferredSide({ x: 0, y: 0 }, { x: 0, y: 100 })).toBe(Position.Bottom);
  });

  it("points at a peer above", () => {
    expect(preferredSide({ x: 0, y: 100 }, { x: 0, y: 0 })).toBe(Position.Top);
  });

  it("prefers the horizontal axis when the offsets are equal", () => {
    // Devices are drawn wide and short, so side-by-side reads better.
    expect(preferredSide({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe(Position.Right);
  });
});

describe("computePlacements", () => {
  it("puts eth0 on the side facing its peer, not always on the left", () => {
    // The reported problem: r1's peer is above it, but eth0 still exited
    // leftwards and the link had to loop around.
    const t = topology(device("r1", 0, 500, ["A"]), device("r2", 0, 0, ["A"]));
    expect(sideOf(t, "r1", 0)).toBe(Position.Top);
    expect(sideOf(t, "r2", 0)).toBe(Position.Bottom);
  });

  it("gives each interface its own direction", () => {
    // r1 has a peer above and a peer to the right; eth0 and eth1 should not
    // both be pinned by their index.
    const t = topology(
      device("r1", 0, 500, ["A", "B"]),
      device("r2", 0, 0, ["A"]),
      device("r3", 900, 500, ["B"]),
    );
    expect(sideOf(t, "r1", 0)).toBe(Position.Top);
    expect(sideOf(t, "r1", 1)).toBe(Position.Right);
  });

  it("resolves the triangle from the screenshot without pinning by index", () => {
    const t = topology(
      device("r1", 100, 800, ["A", "C"]),
      device("r2", 700, 100, ["A", "B"]),
      device("r3", 900, 1100, ["B", "C"]),
    );
    // Each interface faces the device it is actually connected to.
    expect(sideOf(t, "r1", 0)).toBe(Position.Top); // A -> r2, above
    expect(sideOf(t, "r1", 1)).toBe(Position.Right); // C -> r3, right
    expect(sideOf(t, "r2", 1)).toBe(Position.Bottom); // B -> r3, below
    expect(sideOf(t, "r3", 1)).toBe(Position.Left); // C -> r1, left
  });

  it("points at the middle of a shared segment when several devices share it", () => {
    // Three on one collision domain: aim at the notional centre, not at one
    // arbitrarily chosen peer.
    const t = topology(
      device("r1", 0, 0, ["A"]),
      device("r2", 1000, 0, ["A"]),
      device("r3", 1000, 20, ["A"]),
    );
    expect(sideOf(t, "r1", 0)).toBe(Position.Right);
  });

  it("sends interfaces sharing a side to opposite corners", () => {
    // Bunching them near the middle leaves barely 30px between two labels on
    // a device this size, so they collide.
    const t = topology(
      device("r1", 0, 0, ["A", "B"]),
      device("r2", 900, -10, ["A"]),
      device("r3", 900, 10, ["B"]),
    );
    const placements = computePlacements(t).get("r1")!;

    expect(placements.get(0)!.position).toBe(Position.Right);
    expect(placements.get(1)!.position).toBe(Position.Right);
    expect([placements.get(0)!.offset, placements.get(1)!.offset]).toEqual(["20%", "80%"]);
  });

  it("spreads three on a side across the whole face", () => {
    const t = topology(
      device("r1", 0, 0, ["A", "B", "C"]),
      device("r2", 900, -20, ["A"]),
      device("r3", 900, 0, ["B"]),
      device("r4", 900, 20, ["C"]),
    );
    const placements = computePlacements(t).get("r1")!;
    expect([0, 1, 2].map((n) => placements.get(n)!.offset)).toEqual(["20%", "50%", "80%"]);
  });

  it("centres a lone interface on its side", () => {
    const t = topology(device("r1", 0, 0, ["A"]), device("r2", 900, 0, ["A"]));
    expect(computePlacements(t).get("r1")!.get(0)!.offset).toBe("50%");
  });

  it("falls back to a fixed order for an unconnected interface", () => {
    // Nothing to point at, so spread them rather than piling them up.
    const t = topology(device("r1", 0, 0, ["A", "B", "C"]));
    const placements = computePlacements(t).get("r1")!;
    expect(
      new Set([
        placements.get(0)!.position,
        placements.get(1)!.position,
        placements.get(2)!.position,
      ]).size,
    ).toBe(3);
  });

  it("follows a device as it moves", () => {
    // Dragging a peer across should flip the side the link leaves from.
    const before = topology(device("r1", 0, 0, ["A"]), device("r2", 900, 0, ["A"]));
    const after = topology(device("r1", 0, 0, ["A"]), device("r2", -900, 0, ["A"]));
    expect(sideOf(before, "r1", 0)).toBe(Position.Right);
    expect(sideOf(after, "r1", 0)).toBe(Position.Left);
  });

  it("covers every device in the topology", () => {
    const t = topology(device("r1", 0, 0, ["A"]), device("r2", 900, 0, ["A"]));
    expect([...computePlacements(t).keys()].sort()).toEqual(["r1", "r2"]);
  });
});

describe("ordering along a side", () => {
  it("orders by where each peer is, so links do not cross", () => {
    // The reported defect: r2 has both peers below, eth0 going left and eth1
    // going right, but they were ordered by interface number and so left the
    // node crossed over — an X immediately beneath it.
    const t = topology(
      device("r2", 700, 0, ["A", "C"]),
      device("r3", 1300, 900, ["A"]), // eth0's peer, to the right
      device("r1", 100, 900, ["C"]), // eth1's peer, to the left
    );
    const placements = computePlacements(t).get("r2")!;

    expect(placements.get(0)!.position).toBe(Position.Bottom);
    expect(placements.get(1)!.position).toBe(Position.Bottom);
    // eth1 heads left, so it must sit left of eth0 on the bottom edge.
    expect(placements.get(1)!.offset).toBe("20%");
    expect(placements.get(0)!.offset).toBe("80%");
  });

  it("leaves the order alone when it already matches the peers", () => {
    const t = topology(
      device("r2", 700, 0, ["A", "C"]),
      device("r1", 100, 900, ["A"]), // eth0's peer, to the left
      device("r3", 1300, 900, ["C"]), // eth1's peer, to the right
    );
    const placements = computePlacements(t).get("r2")!;
    expect(placements.get(0)!.offset).toBe("20%");
    expect(placements.get(1)!.offset).toBe("80%");
  });

  it("orders by vertical position on a vertical face", () => {
    const t = topology(
      device("r1", 0, 500, ["A", "B"]),
      device("r2", 900, 900, ["A"]), // lower
      device("r3", 900, 100, ["B"]), // higher
    );
    const placements = computePlacements(t).get("r1")!;
    expect(placements.get(1)!.offset).toBe("20%"); // higher peer, nearer the top
    expect(placements.get(0)!.offset).toBe("80%");
  });

  it("falls back to interface number when a peer is missing", () => {
    const t = topology(device("r1", 0, 0, ["A", "B"]));
    const placements = computePlacements(t).get("r1")!;
    expect(placements.get(0)).toBeDefined();
    expect(placements.get(1)).toBeDefined();
  });
});


describe("domainPosition", () => {
  const at = (x: number, y: number) => ({ x, y });

  it("puts a shared segment between the devices on it", () => {
    expect(domainPosition([at(0, 0), at(200, 100)], "A")).toEqual({ x: 100, y: 50 });
  });

  it("does not put a stub on top of the device it is attached to", () => {
    // Reported: disconnecting an interface made the remaining network jump
    // onto the device still attached to it, and follow it around when dragged.
    const placed = domainPosition([at(400, 300)], "A");

    expect(placed).not.toEqual({ x: 400, y: 300 });
    const distance = Math.hypot(placed.x - 400, placed.y - 300);
    expect(distance).toBeCloseTo(STUB_DISTANCE, 0);
  });

  it("keeps two stubs on one device apart", () => {
    // Otherwise they stack, and the fix for one device becomes a defect for two.
    const a = domainPosition([at(0, 0)], "A");
    const b = domainPosition([at(0, 0)], "B");
    expect(a).not.toEqual(b);
  });

  it("places a stub in the same spot every time", () => {
    // A diagram that rearranges itself between renders is worse than one that
    // is merely badly arranged.
    expect(domainPosition([at(10, 20)], "Z")).toEqual(domainPosition([at(10, 20)], "Z"));
  });

  it("moves the stub with its device", () => {
    const near = domainPosition([at(0, 0)], "A");
    const far = domainPosition([at(500, 0)], "A");
    expect(far.x - near.x).toBe(500);
  });
});

describe("an interface points at what its link actually reaches", () => {
  it("aims at the segment node when three or more devices share it", () => {
    // Not at the centroid of the *other* devices: the link ends at the
    // segment's own node, which includes this device in its position, so
    // aiming at the peers put the interface slightly beside its own link.
    const t = topology(
      device("r1", 0, 0, ["A"]),
      device("r2", 300, 0, ["A"]),
      device("r3", 300, 300, ["A"]),
    );
    const hub = domainPosition(
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 300 },
      ],
      "A",
    );
    // The hub is down and to the right of r1, so r1's interface must not be
    // on its top or left face.
    expect(hub.x).toBeGreaterThan(0);
    const side = computePlacements(t).get("r1")!.get(0)!.position;
    expect(["top", "left"]).not.toContain(side);
  });

  it("aims a stub at its own offset segment rather than nowhere", () => {
    const t = topology(device("r1", 0, 0, ["A"]));
    // A is placed below r1, so the interface belongs on the bottom face.
    expect(computePlacements(t).get("r1")!.get(0)!.position).toBe("bottom");
  });
});
