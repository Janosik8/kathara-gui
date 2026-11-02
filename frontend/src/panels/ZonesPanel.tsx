/**
 * Zones: named areas drawn behind devices, such as Area 0, the backbone or
 * AS 65001 (FR-10, asked for at the 2 September meeting).
 *
 * The canvas moves and resizes a zone by pointer. Everything else is here,
 * and so is a keyboard way to place one: select devices in the topology list,
 * then **Add zone** draws one round them, and **Fit to selected devices**
 * redraws an existing zone round a new selection. No zone needs dragging.
 * **Zones from OSPF areas and BGP ASes** draws one round each area and AS the
 * routers' configuration names, where the devices stand, and moves none.
 */

import { fitAround, newZone } from "../canvas/zones";
import type { Operation } from "../store/operations";
import type { Topology, ZoneShape } from "../types";
import { CommittedInput } from "./CommittedInput";
import { Explanation } from "./Explain";

const SHAPES: [ZoneShape, string][] = [
  ["rectangle", "Rectangle"],
  ["ellipse", "Ellipse"],
  ["cloud", "Cloud"],
];

interface Props {
  topology: Topology;
  /** Selected devices, by name. */
  selected: string[];
  selectedZone: string | null;
  onSelectZone: (id: string | null) => void;
  onDispatch: (op: Operation) => void;
  /** Draw a zone round each OSPF area and BGP AS, from the routers' configuration. */
  onRoutingZones: () => void;
  /** True while the configuration is being read. */
  routingBusy?: boolean;
}

export function ZonesPanel({
  topology,
  selected,
  selectedZone,
  onSelectZone,
  onDispatch,
  onRoutingZones,
  routingBusy = false,
}: Props) {
  const zones = topology.zones ?? [];
  const chosen = topology.nodes.filter((n) => selected.includes(n.name));

  return (
    <>
      <Explanation>
        A zone groups devices on the diagram, for the reader only: Kathará never sees it.
        Moving a device leaves its zone where it is, so adjust either on its own.
      </Explanation>
      <div className="lab__actions">
        <button
          type="button"
          onClick={() => {
            const zone = newZone(topology, selected);
            onDispatch({ type: "addZone", zone });
            onSelectZone(zone.id);
          }}
        >
          {chosen.length > 0
            ? `Add zone round ${chosen.length === 1 ? "1 device" : `${chosen.length} devices`}`
            : "Add zone"}
        </button>
        <button type="button" onClick={onRoutingZones} disabled={routingBusy}>
          {routingBusy ? "Reading the configuration…" : "Zones from OSPF areas and BGP ASes"}
        </button>
      </div>

      {zones.length > 0 && (
        <ul className="domain-list">
          {zones.map((zone) => (
            <li
              key={zone.id}
              className={`domain-list__item${zone.id === selectedZone ? " zone-list__item--selected" : ""}`}
            >
              <CommittedInput
                id={`zone-name-${zone.id}`}
                label="Zone name"
                value={zone.name}
                placeholder="e.g. Area 0"
                onCommit={(name) =>
                  onDispatch({
                    type: "updateZone",
                    id: zone.id,
                    changes: { name: name.trim() },
                    label: `Renamed a zone to ${name.trim() || "nothing"}`,
                  })
                }
              />
              <label className="field" htmlFor={`zone-shape-${zone.id}`}>
                <span className="field__label">Shape</span>
                <select
                  id={`zone-shape-${zone.id}`}
                  value={zone.shape}
                  onChange={(e) =>
                    onDispatch({
                      type: "updateZone",
                      id: zone.id,
                      changes: { shape: e.target.value as ZoneShape },
                      label: `Drew ${zone.name || "a zone"} as a ${e.target.value}`,
                    })
                  }
                >
                  {SHAPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="lab__actions">
                <button
                  type="button"
                  disabled={chosen.length === 0}
                  onClick={() =>
                    onDispatch({
                      type: "updateZone",
                      id: zone.id,
                      changes: fitAround(chosen),
                      label: `Fitted ${zone.name || "a zone"} to the selected devices`,
                    })
                  }
                >
                  Fit to selected devices
                </button>
                <button
                  type="button"
                  aria-label={`Delete zone ${zone.name || zone.id}`}
                  onClick={() => {
                    onDispatch({ type: "removeZone", id: zone.id });
                    if (zone.id === selectedZone) onSelectZone(null);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
