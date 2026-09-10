/**
 * Tidying a selection of devices.
 *
 * Alignment works on each node's origin (its top-left corner), because that is
 * what the topology model stores — node dimensions live in the renderer, not
 * the document. For devices of similar size, which is the normal case here,
 * the visual result matches expectation. It is an honest approximation rather
 * than a hidden one, so "align right" lines up origins, not right edges.
 *
 * Pure functions returning a position map, so a whole alignment travels as one
 * `moveNodes` operation and undoes in one step.
 */

import type { Node, Position } from "../types";

/**
 * The closest two devices may be placed by distribution, centre to centre.
 *
 * Distributing evenly between the outermost devices packs them as tightly as
 * those extremes allow, which can leave their interface labels overlapping and
 * unreadable — the labels sit *outside* the node, so the visible width of a
 * device is considerably more than the box. These are floors, not targets:
 * spacing wider than this is left alone.
 *
 * Horizontal needs more room because a device is drawn wide and its labels
 * extend to the left and right of it.
 */
const MINIMUM_SPACING = { x: 190, y: 120 } as const;

export type AlignmentAction =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "centerX"
  | "centerY"
  | "distributeX"
  | "distributeY";

export const ALIGNMENT_LABELS: Record<AlignmentAction, string> = {
  left: "Align left",
  right: "Align right",
  top: "Align top",
  bottom: "Align bottom",
  centerX: "Centre vertically",
  centerY: "Centre horizontally",
  distributeX: "Distribute horizontally",
  distributeY: "Distribute vertically",
};

/** Aligning needs two nodes; distributing needs three to have any effect. */
export function minimumSelection(action: AlignmentAction): number {
  return action === "distributeX" || action === "distributeY" ? 3 : 2;
}

/**
 * The gap to leave between adjacent devices when distributing.
 *
 * Normally the outermost devices stay put and the rest are spaced evenly
 * between them. When that would pack them closer than `minimum`, the spacing
 * opens out instead and the far end moves: an evenly spaced row nobody can
 * read is worse than one that grew slightly wider than asked.
 */
export function distributionStep(
  from: number,
  to: number,
  count: number,
  minimum: number,
): number {
  if (count < 2) return 0;
  const even = (to - from) / (count - 1);
  return Math.max(even, minimum);
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Positions to apply for `action` over `nodes`.
 *
 * Returns only the nodes that actually move, so a no-op alignment produces an
 * empty map and the caller can skip dispatching entirely.
 */
export function computeAlignment(
  nodes: Node[],
  action: AlignmentAction,
): Record<string, Position> {
  if (nodes.length < minimumSelection(action)) return {};

  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const target: Record<string, Position> = {};

  const set = (node: Node, position: Position) => {
    if (position.x !== node.position.x || position.y !== node.position.y) {
      target[node.name] = position;
    }
  };

  switch (action) {
    case "left": {
      const x = Math.min(...xs);
      nodes.forEach((n) => set(n, { x, y: n.position.y }));
      break;
    }
    case "right": {
      const x = Math.max(...xs);
      nodes.forEach((n) => set(n, { x, y: n.position.y }));
      break;
    }
    case "top": {
      const y = Math.min(...ys);
      nodes.forEach((n) => set(n, { x: n.position.x, y }));
      break;
    }
    case "bottom": {
      const y = Math.max(...ys);
      nodes.forEach((n) => set(n, { x: n.position.x, y }));
      break;
    }
    case "centerX": {
      const x = average(xs);
      nodes.forEach((n) => set(n, { x, y: n.position.y }));
      break;
    }
    case "centerY": {
      const y = average(ys);
      nodes.forEach((n) => set(n, { x: n.position.x, y }));
      break;
    }
    case "distributeX": {
      const ordered = [...nodes].sort((a, b) => a.position.x - b.position.x);
      const first = ordered[0]!;
      const step = distributionStep(
        first.position.x,
        ordered[ordered.length - 1]!.position.x,
        ordered.length,
        MINIMUM_SPACING.x,
      );
      ordered.forEach((node, index) =>
        set(node, { x: first.position.x + step * index, y: node.position.y }),
      );
      break;
    }
    case "distributeY": {
      const ordered = [...nodes].sort((a, b) => a.position.y - b.position.y);
      const first = ordered[0]!;
      const step = distributionStep(
        first.position.y,
        ordered[ordered.length - 1]!.position.y,
        ordered.length,
        MINIMUM_SPACING.y,
      );
      ordered.forEach((node, index) =>
        set(node, { x: node.position.x, y: first.position.y + step * index }),
      );
      break;
    }
  }

  return target;
}
