/**
 * Text labels (FR-51): where a new one goes, and the font sizes it may have.
 */

import { TEXT_SIZE_MAX, TEXT_SIZE_MIN, type TextLabel, type Topology } from "../types";

/** What a new text label says until it is given words of its own. */
export const NEW_TEXT = "Text";
/** The size a new text label starts at: a little larger than the device names. */
export const DEFAULT_TEXT_SIZE = 16;
/** Room between a new label and the devices below it. */
const GAP = 40;

/** The first `t<n>` no text label has. */
export function nextTextId(topology: Topology): string {
  const taken = new Set((topology.texts ?? []).map((t) => t.id));
  let n = 1;
  while (taken.has(`t${n}`)) n++;
  return `t${n}`;
}

/**
 * A new text label at `position`, or, without one, just above the selected
 * devices, or above the whole lab when none is selected, where it covers
 * nothing until it is moved.
 */
export function newText(
  topology: Topology,
  selected: readonly string[],
  position?: { x: number; y: number },
): TextLabel {
  const id = nextTextId(topology);
  if (position) return { id, text: NEW_TEXT, position, size: DEFAULT_TEXT_SIZE };
  const chosen = topology.nodes.filter((n) => selected.includes(n.name));
  const over = chosen.length > 0 ? chosen : topology.nodes;
  const x = over.length ? Math.min(...over.map((n) => n.position.x)) : 0;
  const y = over.length ? Math.min(...over.map((n) => n.position.y)) : 0;
  return { id, text: NEW_TEXT, position: { x, y: y - GAP - DEFAULT_TEXT_SIZE }, size: DEFAULT_TEXT_SIZE };
}

/** Why `draft` is not a font size a label may have, or null when it is one. */
export function sizeProblem(draft: string): string | null {
  const value = Number(draft.trim());
  if (draft.trim() === "" || !Number.isInteger(value)) return "a whole number of pixels, such as 24.";
  if (value < TEXT_SIZE_MIN || value > TEXT_SIZE_MAX) {
    return `from ${TEXT_SIZE_MIN} to ${TEXT_SIZE_MAX} pixels.`;
  }
  return null;
}
