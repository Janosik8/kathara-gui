/**
 * Editing the selected device.
 *
 * Text fields use CommittedInput, so they report on blur or Enter rather than
 * on every keystroke.
 */

import type { Operation } from "../store/operations";
import { CommittedInput } from "./CommittedInput";
import {
  DEFAULT_IMAGES,
  DEVICE_KINDS,
  type DeviceKind,
  KNOWN_DAEMONS,
  type Node,
  type Topology,
} from "../types";

interface Props {
  topology: Topology;
  selected: string[];
  onDispatch: (op: Operation) => void;
}

export function Inspector({ topology, selected, onDispatch }: Props) {
  const only = selected.length === 1 ? selected[0] : undefined;
  const node: Node | undefined = topology.nodes.find((n) => n.name === only);

  if (!node) {
    return (
      // No tint with nothing selected: the coloured block means "these
      // controls act on one device", so showing it empty would be a promise
      // with nothing behind it.
      <section className="inspector" aria-labelledby="inspector-heading">
        <h2 className="panel__heading" id="inspector-heading">
          Details
        </h2>
        <p className="inspector__empty">
          {selected.length > 1
            ? `${selected.length} devices selected. Editing applies to one device at a time; use Arrange to align them.`
            : "Select a device to edit its settings."}
        </p>
      </section>
    );
  }

  const update = (changes: Partial<Omit<Node, "name">>) =>
    onDispatch({ type: "updateNode", name: node.name, changes });

  const toggleDaemon = (daemon: string, on: boolean) => {
    const daemons = on
      ? [...node.daemons, daemon]
      : node.daemons.filter((d) => d !== daemon);
    // zebra underpins the others; a protocol daemon without it produces a
    // router that looks configured and silently does nothing.
    if (on && daemon !== "zebra" && !daemons.includes("zebra")) daemons.push("zebra");
    update({ daemons });
  };

  return (
    // A tinted rectangle around everything belonging to the selected device —
    // its name, image, interfaces and daemons — so it is obvious at a glance
    // that these controls act on one device and not on the laboratory.
    <section className="inspector inspector--device" aria-labelledby="inspector-heading">
      <h2 className="panel__heading" id="inspector-heading">
        Details
      </h2>

      <CommittedInput
        id="inspector-name"
        label="Name"
        value={node.name}
        onCommit={(to) => onDispatch({ type: "renameNode", from: node.name, to })}
      />

      <div className="field">
        <label htmlFor="inspector-kind">Kind</label>
        <select
          id="inspector-kind"
          value={node.kind}
          onChange={(e) => {
            const kind = e.target.value as DeviceKind;
            // Follow the new kind's default image, but never overwrite an
            // image the user chose themselves.
            const usingDefault = !node.image || node.image === DEFAULT_IMAGES[node.kind];
            update(usingDefault ? { kind, image: DEFAULT_IMAGES[kind] } : { kind });
          }}
        >
          {DEVICE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </div>

      <CommittedInput
        id="inspector-image"
        label="Container image"
        value={node.image ?? ""}
        placeholder={DEFAULT_IMAGES[node.kind]}
        onCommit={(image) => update({ image: image || null })}
      />

      <CommittedInput
        id="inspector-memory"
        label="Memory limit"
        value={node.memory ?? ""}
        placeholder="e.g. 128m"
        onCommit={(memory) => update({ memory: memory || null })}
      />

      <fieldset className="field field--group">
        <legend>Routing daemons</legend>
        {KNOWN_DAEMONS.map((daemon) => (
          <label key={daemon} className="checkbox">
            <input
              type="checkbox"
              checked={node.daemons.includes(daemon)}
              onChange={(e) => toggleDaemon(daemon, e.target.checked)}
            />
            {daemon}
          </label>
        ))}
      </fieldset>

      <h3 className="panel__heading">Interfaces</h3>
      {node.interfaces.length === 0 ? (
        <p className="inspector__empty">
          Not connected. Use the Connect panel to attach this device to a collision domain.
        </p>
      ) : (
        <ul className="interface-list">
          {node.interfaces.map((iface) => (
            <li key={iface.number} className="interface-list__item">
              <div className="interface-list__title">
                eth{iface.number} on {iface.collision_domain}
              </div>
              <CommittedInput
                id={`inspector-ip-${iface.number}`}
                label={`Address for eth${iface.number}`}
                value={iface.ip ?? ""}
                placeholder="e.g. 10.0.0.1/24"
                onCommit={(ip) =>
                  onDispatch({
                    type: "updateInterface",
                    node: node.name,
                    number: iface.number,
                    changes: { ip: ip || null },
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  onDispatch({ type: "disconnect", node: node.name, number: iface.number })
                }
              >
                Disconnect eth{iface.number}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
