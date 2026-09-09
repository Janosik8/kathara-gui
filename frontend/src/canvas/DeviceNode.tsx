/**
 * A device on the canvas, with its interfaces as labelled attachment points.
 *
 * Interface identity matters in network teaching: "wired eth0 but configured
 * eth1" is the classic lab fault, and a diagram that hides which port a link
 * enters cannot help anyone find it. Each interface is therefore a real
 * handle on the node's perimeter carrying its own label, so an edge visibly
 * terminates at `eth0` rather than at the box in general.
 *
 * The node is `aria-hidden` along with the rest of the canvas; `TopologyTree`
 * is the accessible presentation of the same information.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Fragment } from "react";
import type { DeviceKind, Interface } from "../types";
import type { DevicePlacements } from "./layout";

export interface DeviceNodeData extends Record<string, unknown> {
  label: string;
  kind: DeviceKind;
  interfaces: Interface[];
  /** Which side each interface sits on, decided by `computePlacements`. */
  placements: DevicePlacements;
  pending?: boolean;
}

/**
 * Offsetting a handle along the border it sits on.
 *
 * React Flow already positions a handle absolutely on the node's edge and
 * centres it with a transform; the documented way to slide it along that edge
 * is to override the single co-ordinate that runs parallel to it. Overriding
 * more than that — as an earlier version did, forcing `position: relative` —
 * detaches the handle from where React Flow believes it to be, and edges are
 * then drawn to the remembered spot rather than the visible one.
 */
function alongBorder(position: Position, offset: string): React.CSSProperties {
  return position === Position.Left || position === Position.Right
    ? { top: offset }
    : { left: offset };
}

const GLYPH: Record<DeviceKind, string> = {
  router: "◆",
  switch: "▬",
  pc: "▢",
  server: "▤",
};

export function DeviceNode({ data, selected }: NodeProps) {
  const { label, kind, interfaces, placements, pending } = data as DeviceNodeData;

  return (
    <div
      className={`device device--${kind}`}
      data-selected={selected || undefined}
      data-pending={pending || undefined}
    >
      <span className="device__glyph" aria-hidden="true">
        {GLYPH[kind]}
      </span>
      <span className="device__name">{label}</span>
      <span className="device__kind">{kind}</span>

      {interfaces.map((iface) => {
        const { position, offset } = placements.get(iface.number) ?? {
          position: Position.Right,
          offset: "50%",
        };
        const along = alongBorder(position, offset);
        const id = `eth${iface.number}`;

        return (
          <Fragment key={iface.number}>
            {/* Source and target coincide deliberately: a Kathará link has no
                direction, so either end may begin or finish a connection. */}
            <Handle type="source" position={position} id={id} style={along} className="iface__point" />
            <Handle type="target" position={position} id={id} style={along} className="iface__point" />
            {/* The label sits outside the border; the handle stays on it. */}
            <span className="iface__label" data-side={position} style={along}>
              {id}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
