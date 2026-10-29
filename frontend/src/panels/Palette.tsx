/**
 * Adding devices.
 *
 * Buttons rather than drag-only: dragging from a palette onto a canvas is
 * unusable without a pointer, and "add a router" is the single most common
 * action in the application. Placement is automatic and can be adjusted after.
 */

import { DEVICE_ICONS } from "../canvas/icons";
import { DEVICE_KINDS, type DeviceKind, type Topology } from "../types";

interface Props {
  topology: Topology;
  onAdd: (kind: DeviceKind) => void;
  disabled?: boolean;
}

/** Conventional prefixes, so generated names read like a network diagram. */
const PREFIX: Record<DeviceKind, string> = {
  router: "r",
  switch: "sw",
  pc: "pc",
  server: "srv",
};

/** First free `r1`, `r2`, ... for this kind. */
export function suggestName(topology: Topology, kind: DeviceKind): string {
  const taken = new Set(topology.nodes.map((n) => n.name.toLowerCase()));
  for (let i = 1; ; i += 1) {
    const candidate = `${PREFIX[kind]}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function Palette({ topology, onAdd, disabled }: Props) {
  return (
    <div className="palette">
      {/* Labelled by its panel section's heading, which App gives this id. */}
      <div className="palette__buttons" role="group" aria-labelledby="palette-heading">
        {DEVICE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="palette__button"
            onClick={() => onAdd(kind)}
            disabled={disabled}
          >
            {/* The picture the device will have on the canvas (UX-08); the
                words carry the name, so it is decoration here. */}
            <img className="palette__icon" src={DEVICE_ICONS[kind]} alt="" />
            {/* Name the device that will be created, so the outcome is
                predictable before activating the control. */}
            Add {kind} <span className="palette__hint">({suggestName(topology, kind)})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
