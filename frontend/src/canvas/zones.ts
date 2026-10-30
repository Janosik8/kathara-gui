/**
 * Zone geometry (FR-10): where a new zone goes, and fitting one to devices.
 *
 * The padding matches `domain/asgroups.py`, so a zone drawn here round some
 * devices looks like one the import drew round an autonomous system.
 */

import type { Node, Topology, Zone } from "../types";

/** Room between a zone's edge and the devices inside it, for their labels. */
const PADDING = { x: 70, y: 60 };
/** About how much a device occupies from its position, its top-left corner. */
const DEVICE = { x: 90, y: 90 };
/** A zone round nothing in particular. */
const DEFAULT_SIZE = { width: 320, height: 200 };

/** The box round `devices`, with room for their labels. */
export function fitAround(devices: readonly Node[]): Pick<Zone, "position" | "width" | "height"> {
  const xs = devices.map((d) => d.position.x);
  const ys = devices.map((d) => d.position.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    position: { x: left - PADDING.x, y: top - PADDING.y },
    width: Math.max(...xs) - left + DEVICE.x + 2 * PADDING.x,
    height: Math.max(...ys) - top + DEVICE.y + 2 * PADDING.y,
  };
}

/** The first `z<n>` no zone has. */
export function nextZoneId(topology: Topology): string {
  const taken = new Set((topology.zones ?? []).map((z) => z.id));
  let n = 1;
  while (taken.has(`z${n}`)) n++;
  return `z${n}`;
}

/**
 * A new zone: round the selected devices if any, otherwise above the lab, where
 * it covers nothing until it is moved.
 */
export function newZone(topology: Topology, selected: readonly string[]): Zone {
  const chosen = topology.nodes.filter((n) => selected.includes(n.name));
  const id = nextZoneId(topology);
  const name = `Zone ${id.slice(1)}`;
  if (chosen.length > 0) return { id, name, shape: "rectangle", ...fitAround(chosen) };
  const top = topology.nodes.length ? Math.min(...topology.nodes.map((n) => n.position.y)) : 0;
  const left = topology.nodes.length ? Math.min(...topology.nodes.map((n) => n.position.x)) : 0;
  return {
    id,
    name,
    shape: "rectangle",
    position: { x: left - PADDING.x, y: top - DEFAULT_SIZE.height - 2 * PADDING.y },
    ...DEFAULT_SIZE,
  };
}
