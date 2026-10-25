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
  DAEMONS,
  type Node,
  type Topology,
} from "../types";

/**
 * Why a loopback address would be refused, or null. The server refuses the
 * same things; checking here keeps the draft in the field with a reason
 * instead of a failed request (bug 28).
 */
export function validateLoopback(value: string, existing: string[] = []): string | null {
  const text = value.trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(text);
  if (v4) {
    if (v4.slice(1, 5).some((o) => Number(o) > 255)) return "Each octet must be 0-255.";
    if (Number(v4[5]) > 32) return "The prefix must be /32 or shorter.";
    if (v4[1] === "127") return "127.0.0.0/8 is already on lo in every container.";
  } else if (!/^[0-9a-fA-F:]*:[0-9a-fA-F:]*\/\d{1,3}$/.test(text)) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(text)
      ? `Add a prefix, usually ${text}/32.`
      : "Use CIDR form, for example 10.255.0.1/32.";
  }
  if (existing.includes(text)) return `${text} is already on lo.`;
  return null;
}

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

  const routers = topology.nodes.filter((n) => n.kind === "router" && n.name !== node.name);
  const otherRouters = routers.length;
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && a.every((d) => b.includes(d));
  // Nothing to apply when every router already runs exactly these.
  const allMatch = routers.every((r) => sameSet(r.daemons, node.daemons));

  const update = (changes: Partial<Omit<Node, "name">>) =>
    onDispatch({ type: "updateNode", name: node.name, changes });

  const loopbacks = node.loopbacks ?? [];
  const setLoopbacks = (next: string[]) => update({ loopbacks: next });

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

      <div className="field">
        <label className="checkbox" htmlFor="inspector-privileged">
          <input
            id="inspector-privileged"
            type="checkbox"
            checked={node.privileged ?? false}
            onChange={(e) => update({ privileged: e.target.checked })}
            aria-describedby="inspector-privileged-hint"
          />
          Privileged
        </label>
        <p className="field__hint" id="inspector-privileged-hint">
          Full access to the host kernel, for MPLS or kernel modules. Kathará allows it only
          when this application runs as administrator (Windows) or root (macOS, Linux).
        </p>
      </div>

      <fieldset className="field field--group">
        <legend>Routing daemons</legend>
        {DAEMONS.map(([daemon, purpose]) => (
          <label key={daemon} className="checkbox">
            <input
              type="checkbox"
              checked={node.daemons.includes(daemon)}
              onChange={(e) => toggleDaemon(daemon, e.target.checked)}
            />
            {daemon} <span className="checkbox__hint">{purpose}</span>
          </label>
        ))}
        {node.kind === "router" && otherRouters > 0 && (
          <button
            type="button"
            className="daemons__apply"
            onClick={() => onDispatch({ type: "applyDaemons", from: node.name })}
            disabled={allMatch}
          >
            Apply to all routers
          </button>
        )}
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

      <h3 className="panel__heading">Loopback (lo)</h3>
      <p className="field__hint">
        Extra addresses on <code>lo</code>, for a router ID or an address that stays up
        whichever link is down. Usually a /32.
      </p>
      <ul className="interface-list">
        {loopbacks.map((address, index) => (
          <li key={address} className="interface-list__item">
            <CommittedInput
              id={`inspector-lo-${index}`}
              label={`Loopback address ${index + 1}`}
              value={address}
              validate={(value) => (value.trim() === "" ? null : validateLoopback(value))}
              // Emptying the field removes the address.
              onCommit={(value) =>
                setLoopbacks(
                  value.trim() === ""
                    ? loopbacks.filter((_, i) => i !== index)
                    : loopbacks.map((a, i) => (i === index ? value.trim() : a)),
                )
              }
            />
            <button
              type="button"
              onClick={() => setLoopbacks(loopbacks.filter((_, i) => i !== index))}
            >
              Remove {address}
            </button>
          </li>
        ))}
      </ul>
      <CommittedInput
        // A fresh field after each addition, rather than one still holding
        // the address just added.
        key={loopbacks.length}
        id="inspector-lo-new"
        label="Add a loopback address"
        value=""
        placeholder="e.g. 10.255.0.1/32"
        validate={(value) => (value.trim() === "" ? null : validateLoopback(value, loopbacks))}
        onCommit={(value) => {
          if (value.trim()) setLoopbacks([...loopbacks, value.trim()]);
        }}
      />
    </section>
  );
}
