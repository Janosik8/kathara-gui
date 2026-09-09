/**
 * Deciding which side of a device each interface sits on.
 *
 * Assigning sides by interface number — eth0 left, eth1 right — makes links
 * take absurd routes: a device whose peer is directly above it still exits
 * leftwards and loops around, and links cross each other for no reason.
 *
 * So the side is chosen by geometry instead: an interface sits on the face
 * pointing at whatever it is connected to. The label then reads in the
 * direction the link actually leaves, which is what makes a diagram legible.
 *
 * Pure, and separate from the component, because it needs the whole topology
 * to see where each peer is — and because this is the part worth testing.
 */

import { Position } from "@xyflow/react";
import type { Position as Point, Topology } from "../types";

export interface Placement {
  position: Position;
  /** Distance along that side, as a CSS percentage. */
  offset: string;
}

/** Placements for one device, keyed by interface number. */
export type DevicePlacements = Map<number, Placement>;

/** Fallback order when an interface has nothing to point at. */
const SIDES = [Position.Left, Position.Right, Position.Top, Position.Bottom] as const;

/**
 * The face of `from` that points at `to`.
 *
 * Node positions are top-left corners rather than centres, but every device
 * is the same size, so the difference between two positions equals the
 * difference between their centres and the direction is exact.
 */
export function preferredSide(from: Point, to: Point): Position {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Ties go to the horizontal axis: side-by-side reads better than stacked
  // for the wide, short boxes devices are drawn as.
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? Position.Right : Position.Left;
  }
  return dy >= 0 ? Position.Bottom : Position.Top;
}

/** Mean of a set of points; the notional location of a shared segment. */
function centroid(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Where an interface should point: at its single peer, or at the notional
 * centre of the segment when several devices share it.
 */
function targetFor(topology: Topology, device: string, collisionDomain: string): Point | null {
  const peers = topology.nodes.filter(
    (node) =>
      node.name !== device &&
      node.interfaces.some((iface) => iface.collision_domain === collisionDomain),
  );
  if (peers.length === 0) return null;
  return centroid(peers.map((node) => node.position));
}

/**
 * How far in from each corner the outermost interface sits, as a percentage.
 *
 * Not zero: a device is a rounded rectangle, so a handle exactly on the
 * corner floats away from the drawn border.
 */
const CORNER_INSET = 20;

/**
 * Spread the interfaces sharing a side out towards its corners.
 *
 * A lone interface sits centred. Two go to opposite corners rather than
 * bunching near the middle, which keeps their labels from colliding — with
 * a device only ~90px wide, an even spread leaves barely 30px between them.
 */
function spread(count: number, index: number): string {
  if (count === 1) return "50%";
  const span = 100 - 2 * CORNER_INSET;
  return `${CORNER_INSET + (index * span) / (count - 1)}%`;
}

/**
 * Order interfaces along a side by where their peers actually are.
 *
 * Without this they are ordered by interface number, so a device whose eth0
 * goes right and eth1 goes left has its links cross immediately outside the
 * node — visible in the triangle as an X just below the top router.
 *
 * Along a horizontal face the ordering key is the peer's x, along a vertical
 * face its y. Interfaces with no peer keep their existing relative order.
 */
function orderAlongSide(
  side: Position,
  entries: { number: number; target: Point | null }[],
): number[] {
  const horizontal = side === Position.Top || side === Position.Bottom;
  return [...entries]
    .sort((a, b) => {
      if (!a.target || !b.target) return a.number - b.number;
      const key = (p: Point) => (horizontal ? p.x : p.y);
      return key(a.target) - key(b.target) || a.number - b.number;
    })
    .map((entry) => entry.number);
}

export function computePlacements(topology: Topology): Map<string, DevicePlacements> {
  const result = new Map<string, DevicePlacements>();

  for (const node of topology.nodes) {
    const interfaces = [...node.interfaces].sort((a, b) => a.number - b.number);

    // First pass: pick a side for each interface.
    const chosen = interfaces.map((iface, index) => {
      const target = targetFor(topology, node.name, iface.collision_domain);
      return {
        number: iface.number,
        target,
        // An unconnected interface has nothing to point at, so fall back to
        // the old fixed order rather than piling them all on one side.
        side: target ? preferredSide(node.position, target) : SIDES[index % SIDES.length]!,
      };
    });

    // Second pass: distribute the ones that landed on the same side, ordered
    // so their links do not cross on the way out.
    const bySide = new Map<Position, { number: number; target: Point | null }[]>();
    for (const entry of chosen) {
      bySide.set(entry.side, [...(bySide.get(entry.side) ?? []), entry]);
    }

    const placements: DevicePlacements = new Map();
    for (const [side, entries] of bySide) {
      orderAlongSide(side, entries).forEach((number, index) => {
        placements.set(number, { position: side, offset: spread(entries.length, index) });
      });
    }
    result.set(node.name, placements);
  }

  return result;
}
