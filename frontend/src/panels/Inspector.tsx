/**
 * Editing the selected device.
 *
 * Text fields commit on blur or Enter rather than on every keystroke: a
 * per-character dispatch would fill the operation log and make undo useless
 * (twelve presses of Ctrl+Z to retract one rename).
 */

import { useEffect, useState } from "react";
import type { Operation } from "../store/operations";
import { DEVICE_KINDS, type DeviceKind, KNOWN_DAEMONS, type Node, type Topology } from "../types";

interface Props {
  topology: Topology;
  selected: string | null;
  onDispatch: (op: Operation) => void;
}

/** An input that reports its value only once the user has finished with it. */
function CommittedInput({
  id,
  label,
  value,
  placeholder,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Adopt external changes (a different device selected, or an undo) without
  // discarding an edit in progress.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(value);
          }
        }}
      />
    </div>
  );
}

export function Inspector({ topology, selected, onDispatch }: Props) {
  const node: Node | undefined = topology.nodes.find((n) => n.name === selected);

  if (!node) {
    return (
      <>
        <h2 className="panel__heading">Details</h2>
        <p className="inspector__empty">Select a device to edit its settings.</p>
      </>
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
    <>
      <h2 className="panel__heading">Details</h2>

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
          onChange={(e) => update({ kind: e.target.value as DeviceKind })}
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
        placeholder={node.kind === "router" ? "kathara/frr" : "kathara/base"}
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
    </>
  );
}
