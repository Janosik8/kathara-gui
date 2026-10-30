/**
 * A text label on the canvas (FR-51): words at a size of their own, placed
 * anywhere, inside a zone or outside it.
 *
 * Moved by dragging it, like a device; its words and size are changed in the
 * Text labels panel, which is also the keyboard way to place one.
 */

import type { NodeProps } from "@xyflow/react";

export interface TextData extends Record<string, unknown> {
  text: string;
  size: number;
}

export function TextNode({ data }: NodeProps) {
  const label = data as TextData;
  return (
    <div className="text-label" style={{ fontSize: `${label.size}px` }}>
      {label.text}
    </div>
  );
}
