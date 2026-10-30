/**
 * A zone on the canvas: a rectangle, an ellipse or a cloud, named, behind the
 * devices (FR-10).
 *
 * Moved by dragging it and resized by its corner handles once selected. Each
 * ends as one edit, reported through `data.onResize`; a drag goes through the
 * canvas like a device's. The Zones panel names, reshapes and fits zones from
 * the keyboard.
 */

import { type NodeProps, NodeResizer } from "@xyflow/react";
import type { ZoneShape } from "../types";

export interface ZoneData extends Record<string, unknown> {
  name: string;
  shape: ZoneShape;
  locked: boolean;
  onResize: (box: { x: number; y: number; width: number; height: number }) => void;
}

/** A cloud's outline in a 100 × 60 box, stretched to the zone's size. */
const CLOUD =
  "M22 52 C8 52 4 40 12 34 C4 26 14 14 26 18 C30 6 48 4 54 14 C62 4 82 8 82 22 " +
  "C96 22 98 40 88 46 C92 56 78 60 70 54 C62 60 48 60 42 54 C36 58 26 58 22 52 Z";

export function ZoneNode({ data, selected }: NodeProps) {
  const zone = data as ZoneData;
  return (
    <div className={`zone zone--${zone.shape}`}>
      <NodeResizer
        isVisible={selected && !zone.locked}
        minWidth={80}
        minHeight={60}
        lineClassName="zone__resize-line"
        handleClassName="zone__resize-handle"
        onResizeEnd={(_, box) => zone.onResize(box)}
      />
      <svg className="zone__shape" viewBox="0 0 100 60" preserveAspectRatio="none">
        {zone.shape === "ellipse" ? (
          <ellipse cx="50" cy="30" rx="49" ry="29" vectorEffect="non-scaling-stroke" />
        ) : zone.shape === "cloud" ? (
          <path d={CLOUD} vectorEffect="non-scaling-stroke" />
        ) : (
          <rect x="0.5" y="0.5" width="99" height="59" rx="3" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {zone.name && <span className="zone__name">{zone.name}</span>}
    </div>
  );
}
