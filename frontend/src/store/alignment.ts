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
      // Outermost nodes stay put; the rest are spaced evenly between them.
      const ordered = [...nodes].sort((a, b) => a.position.x - b.position.x);
      const first = ordered[0]!;
      const last = ordered[ordered.length - 1]!;
      const step = (last.position.x - first.position.x) / (ordered.length - 1);
      ordered.forEach((node, index) =>
        set(node, { x: first.position.x + step * index, y: node.position.y }),
      );
      break;
    }
    case "distributeY": {
      const ordered = [...nodes].sort((a, b) => a.position.y - b.position.y);
      const first = ordered[0]!;
      const last = ordered[ordered.length - 1]!;
      const step = (last.position.y - first.position.y) / (ordered.length - 1);
      ordered.forEach((node, index) =>
        set(node, { x: node.position.x, y: first.position.y + step * index }),
      );
      break;
    }
  }

  return target;
}
