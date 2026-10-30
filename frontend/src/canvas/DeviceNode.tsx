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
import { DEVICE_ICONS } from "./icons";
import type { DevicePlacements } from "./layout";

export interface DeviceNodeData extends Record<string, unknown> {
  label: string;
  kind: DeviceKind;
  interfaces: Interface[];
  /** Loopback addresses, shown under the name (FR-09 names `lo` too). */
  loopbacks?: string[];
  /** Which side each interface sits on, decided by `computePlacements`. */
  placements: DevicePlacements;
  pending?: boolean;
  /** Each interface's host part, by number, when the canvas shows them (FR-49). */
  hosts?: Map<number, string | null>;
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

export function DeviceNode({ data, selected }: NodeProps) {
  const { label, kind, interfaces, loopbacks, placements, pending, hosts } = data as DeviceNodeData;

  return (
    <div
      className={`device device--${kind}`}
      data-selected={selected || undefined}
      data-pending={pending || undefined}
    >
      {/* The picture names the kind, so the word "router" under it went
          (UX-08). Not draggable: a dragged image would leave the browser's
          ghost picture instead of moving the device. */}
      <img className="device__icon" src={DEVICE_ICONS[kind]} alt="" draggable={false} />
      <span className="device__name">{label}</span>
      {loopbacks?.map((address) => (
        <span key={address} className="device__lo">
          lo {address}
        </span>
      ))}

      {interfaces.map((iface) => {
        const { position, offset } = placements.get(iface.number) ?? {
          position: Position.Right,
          offset: "50%",
        };
        const along = alongBorder(position, offset);
        const id = `eth${iface.number}`;
        const host = hosts?.get(iface.number);

        return (
          <Fragment key={iface.number}>
            {/* Source and target coincide deliberately: a Kathará link has no
                direction, so either end may begin or finish a connection. */}
            <Handle type="source" position={position} id={id} style={along} className="iface__point" />
            <Handle type="target" position={position} id={id} style={along} className="iface__point" />
            {/* The label sits outside the border; the handle stays on it. The
                host part goes on the label's far side from the device, so
                labels side by side grow outwards, not into each other. */}
            <span className="iface__label" data-side={position} style={along}>
              <span>{id}</span>
              {host && <span className="iface__host">{host}</span>}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
