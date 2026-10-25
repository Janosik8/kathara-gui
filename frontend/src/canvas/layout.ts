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

/** How far a lone segment sits from the single device left on it. */
export const STUB_DISTANCE = 150;

/**
 * Directions a stub segment can take.
 *
 * Several stubs on one device must not land on each other, so the direction is
 * chosen by the domain's name rather than being the same every time.
 *
 * The four faces come first and the diagonals after, because a stub's
 * direction also decides which face its interface leaves from: leading with
 * diagonals put two stubs on one face while the other three faces stood empty.
 * Cardinals first fans the first four across all four sides, which is how
 * anyone would draw it by hand.
 */
const STUB_DIRECTIONS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 0.6 },
  { x: -1, y: 0.6 },
  { x: -1, y: -0.6 },
  { x: 1, y: -0.6 },
];

/** A stable small number from a name, so a layout does not change per render. */
function nameIndex(name: string, buckets: number): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 100003;
  return hash % buckets;
}

/**
 * Where a collision domain is drawn.
 *
 * The centroid of its members, except when only one member is left: the
 * centroid is then that device's own position, so the segment was drawn on top
 * of the device and followed it around. That is what disconnecting an
 * interface produced — the remaining stub jumped onto the device still
 * attached to it.
 *
 * A stub is pushed out from the device instead, in a direction fixed by its
 * name. Fixed rather than arbitrary for two reasons: the diagram must not
 * rearrange itself between renders, and two stubs on the same device must not
 * be given the same spot.
 */
export function domainPosition(points: Point[], domain?: string): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) {
    const [only] = points as [Point];
    const direction = STUB_DIRECTIONS[nameIndex(domain ?? "", STUB_DIRECTIONS.length)]!;
    return {
      x: only.x + direction.x * STUB_DISTANCE,
      y: only.y + direction.y * STUB_DISTANCE,
    };
  }
  return centroid(points);
}

/**
 * Where a collision domain's own node is drawn: where the user put it, if they
 * moved it, and otherwise between its members.
 *
 * The fallback alone made the node follow its devices around and snap back
 * after being dragged (test step 1D.1), because there was nowhere to keep a
 * position of its own.
 */
export function segmentPosition(topology: Topology, collisionDomain: string): Point {
  const stored = topology.collision_domains.find((cd) => cd.name === collisionDomain)?.position;
  if (stored) return stored;
  return domainPosition(
    topology.nodes
      .filter((node) => node.interfaces.some((i) => i.collision_domain === collisionDomain))
      .map((node) => node.position),
    collisionDomain,
  );
}

/**
 * Where an interface should point: at whatever its link actually reaches.
 *
 * Which is not the same as "at its peers". A segment shared by three or more
 * devices is drawn as a node of its own, and the link runs to *that* — so
 * aiming the interface at the centroid of the other devices pointed it
 * slightly beside the thing it connects to. A stub with no peers at all
 * returned null and pointed nowhere.
 */
function targetFor(topology: Topology, device: string, collisionDomain: string): Point | null {
  const members = topology.nodes.filter((node) =>
    node.interfaces.some((iface) => iface.collision_domain === collisionDomain),
  );
  const peers = members.filter((node) => node.name !== device);

  // Two devices are wired directly to each other, with no node in between.
  if (members.length === 2 && peers.length === 1) return peers[0]!.position;

  // Otherwise the link ends at the segment's own node — including a stub,
  // whose node sits offset from this very device.
  return segmentPosition(topology, collisionDomain);
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

/**
 * Where a line from `toward` to the centre of a pill-shaped node crosses its
 * outline. A shared segment is drawn as a pill (`border-radius: 999px`): a
 * rectangle with a semicircle at each end, or the other way up when it is
 * taller than wide.
 *
 * Links used to end at the node's single top handle, so every one crossed
 * the node and ran over its label (test step 3B.4). Ending each where it
 * meets the outline, on the side it comes from, leaves the label clear.
 */
export function pillBoundary(
  centre: Point,
  width: number,
  height: number,
  toward: Point,
): Point {
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  const length = Math.hypot(dx, dy);
  if (length === 0 || width <= 0 || height <= 0) return centre;
  const ux = dx / length;
  const uy = dy / length;

  // Lay the pill horizontally: swap axes if it stands upright.
  const upright = height > width;
  const [ax, ay] = upright ? [uy, ux] : [ux, uy];
  const [long, short] = upright ? [height, width] : [width, height];
  const radius = short / 2;
  const straight = long / 2 - radius; // half the length of the flat sides

  // The flat side first; outside it, the end cap's circle.
  let distance: number;
  const toFlat = ay !== 0 ? radius / Math.abs(ay) : Infinity;
  if (Math.abs(ax * toFlat) <= straight) {
    distance = toFlat;
  } else {
    // |t·a − c|² = r², with c the cap's centre on the side the line heads.
    const cx = Math.sign(ax) * straight;
    const b = ax * cx;
    distance = b + Math.sqrt(b * b - (cx * cx - radius * radius));
  }

  return { x: centre.x + ux * distance, y: centre.y + uy * distance };
}
