/**
 * Editing the selected device.
 *
 * Text fields use CommittedInput, so they report on blur or Enter rather than
 * on every keystroke.
 */

import { useEffect, useRef, useState } from "react";
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
import { Explanation, useExplain } from "./Explain";

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
  const explain = useExplain();

  if (!node) {
    return (
      // No tint with nothing selected: the coloured block means "these
      // controls act on one device", so showing it empty would be a promise
      // with nothing behind it.
      <div className="inspector">
        <p className="inspector__empty">
          {selected.length > 1
            ? `${selected.length} devices selected. Editing applies to one device at a time; use Arrange to align them.`
            : "Select a device to edit its settings."}
        </p>
      </div>
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
    // that these controls act on one device and not on the laboratory. The
    // tint itself is on the panel section, so it takes in the heading too.
    <div className="inspector">

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
            // Only while the hint exists, so it never points at nothing.
            aria-describedby={explain ? "inspector-privileged-hint" : undefined}
          />
          Privileged
        </label>
        <Explanation id="inspector-privileged-hint">
          Full access to the host kernel, for MPLS or kernel modules. Kathará allows it only
          when this application runs as administrator (Windows) or root (macOS, Linux).
        </Explanation>
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
        {node.image?.toLowerCase().includes("quagga") && (
          <Explanation>
            On Quagga each daemon is its own process with its own file in /etc/quagga, and it
            runs only once ticked here and redeployed. Until then, vtysh accepts its commands
            and drops them.
          </Explanation>
        )}
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
      <Explanation>
        Extra addresses on <code>lo</code>, for a router ID or an address that stays up
        whichever link is down. Usually a /32.
      </Explanation>
      {/* Keyed by device, so empty rows opened on one device do not follow
          the selection to the next. */}
      <LoopbackRows key={node.name} loopbacks={loopbacks} onChange={setLoopbacks} />
    </div>
  );
}

/**
 * One field per loopback address, with + to open another and − to remove one.
 *
 * There is always at least one row, so the place to type the first address is
 * visible without first finding a button. Rows opened with + and not yet
 * filled are local to this component: an empty address is not an address, and
 * putting one in the model would be refused by the server.
 */
function LoopbackRows({
  loopbacks,
  onChange,
}: {
  loopbacks: string[];
  onChange: (next: string[]) => void;
}) {
  // Ids rather than a count, so removing one empty row removes that row and
  // not whichever happens to be last, with someone's draft in it.
  const [pending, setPending] = useState<number[]>([]);
  const nextId = useRef(0);
  const [focusId, setFocusId] = useState<string | null>(null);

  // Waits for the field to exist: a filled row reappears as a saved one only
  // once the new address has come back in the props.
  useEffect(() => {
    if (!focusId) return;
    const field = document.getElementById(focusId);
    if (field) {
      field.focus();
      setFocusId(null);
    }
  }, [focusId, loopbacks]);

  const openRow = () => {
    const id = nextId.current++;
    setPending((p) => [...p, id]);
    setFocusId(`inspector-lo-p${id}`);
  };
  const closeRow = (id: number) => setPending((p) => p.filter((x) => x !== id));

  // The row that is shown when there is nothing at all, so there is always one.
  const shown = loopbacks.length === 0 && pending.length === 0 ? [-1] : pending;

  type Row =
    | { kind: "saved"; index: number; address: string }
    | { kind: "pending"; id: number };
  const rows: Row[] = [
    ...loopbacks.map((address, index) => ({ kind: "saved" as const, index, address })),
    ...shown.map((id) => ({ kind: "pending" as const, id })),
  ];
  const onlyRow = rows.length === 1;

  return (
    <ul className="loopback-list">
      {rows.map((row, position) => {
        const n = position + 1;
        const fieldId =
          row.kind === "saved" ? `inspector-lo-${row.index}` : `inspector-lo-p${row.id}`;
        const empty = row.kind === "pending";
        return (
          <li key={fieldId} className="loopback-list__row">
            {row.kind === "saved" ? (
              <CommittedInput
                id={fieldId}
                label={`Loopback address ${n}`}
                value={row.address}
                validate={(value) =>
                  value.trim() === ""
                    ? null
                    : validateLoopback(
                        value,
                        loopbacks.filter((_, i) => i !== row.index),
                      )
                }
                // Emptying the field removes the address.
                onCommit={(value) =>
                  onChange(
                    value.trim() === ""
                      ? loopbacks.filter((_, i) => i !== row.index)
                      : loopbacks.map((a, i) => (i === row.index ? value.trim() : a)),
                  )
                }
              />
            ) : (
              <CommittedInput
                id={fieldId}
                label={`Loopback address ${n}`}
                value=""
                placeholder="e.g. 10.255.0.1/32"
                validate={(value) =>
                  value.trim() === "" ? null : validateLoopback(value, loopbacks)
                }
                onCommit={(value) => {
                  if (!value.trim()) return;
                  // The row becomes a saved one in the same place. After Enter
                  // the cursor follows it; after Tab it is left where it went.
                  if (document.activeElement?.id === fieldId) {
                    setFocusId(`inspector-lo-${loopbacks.length}`);
                  }
                  closeRow(row.id);
                  onChange([...loopbacks, value.trim()]);
                }}
              />
            )}
            <div className="loopback-list__actions">
              <button
                type="button"
                className="loopback__button"
                aria-label={`Remove loopback address ${n}`}
                title={`Remove loopback address ${n}`}
                // The last empty row stays: it is where the next address goes.
                disabled={onlyRow && empty}
                onClick={() =>
                  row.kind === "saved"
                    ? onChange(loopbacks.filter((_, i) => i !== row.index))
                    : closeRow(row.id)
                }
              >
                −
              </button>
              {position === 0 && (
                <button
                  type="button"
                  className="loopback__button"
                  aria-label="Add another loopback address"
                  title="Add another loopback address"
                  onClick={openRow}
                >
                  +
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
