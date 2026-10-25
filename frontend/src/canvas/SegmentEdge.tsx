/**
 * A link from a device to a shared segment's node.
 *
 * It aims at the node's centre and stops where it meets the outline, so it
 * enters on the side it comes from. Every link used to end at the node's one
 * top handle, which sent a link from below straight across the label (test
 * step 3B.4).
 */

import { BaseEdge, type EdgeProps, getBezierPath, useInternalNode } from "@xyflow/react";
import { pillBoundary, preferredSide } from "./layout";

export function SegmentEdge({
  id,
  target,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  markerEnd,
  interactionWidth,
}: EdgeProps) {
  const hub = useInternalNode(target);
  const width = hub?.measured.width ?? 0;
  const height = hub?.measured.height ?? 0;

  let end = { x: targetX, y: targetY };
  let endSide = targetPosition;
  // Until React Flow has measured the node there is no outline to meet, so
  // the handle it supplies stands in for one frame.
  if (hub && width > 0 && height > 0) {
    const centre = {
      x: hub.internals.positionAbsolute.x + width / 2,
      y: hub.internals.positionAbsolute.y + height / 2,
    };
    const device = { x: sourceX, y: sourceY };
    end = pillBoundary(centre, width, height, device);
    endSide = preferredSide(centre, device);
  }

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX: end.x,
    targetY: end.y,
    targetPosition: endSide,
  });

  return (
    <BaseEdge
      id={id}
      path={path}
      style={style}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
    />
  );
}
