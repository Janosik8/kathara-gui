/**
 * Creating links without a mouse.
 *
 * Dragging between handles on a canvas is the obvious gesture for a pointer
 * user and completely unavailable to everyone else, so link creation gets a
 * real form. Both routes dispatch the same operations.
 *
 * One control covers both cases the model allows, because Kathara collision
 * domains are shared media:
 *
 *  - target is another device  -> create a new collision domain, attach both
 *  - target is a collision domain -> attach this device to the shared segment
 */

import { useEffect, useMemo, useState } from "react";
import type { Operation } from "../store/operations";
import type { Topology } from "../types";

interface Props {
  topology: Topology;
  onConnect: (op: Operation) => void;
}

/** Next unused collision-domain name: A, B, ... Z, AA, AB, ... */
export function suggestCollisionDomain(topology: Topology): string {
  const taken = new Set(topology.collision_domains.map((cd) => cd.name.toUpperCase()));
  for (let i = 0; ; i += 1) {
    let n = i;
    let name = "";
    do {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    if (!taken.has(name)) return name;
  }
}

const DEVICE = "device:";
const DOMAIN = "domain:";

export function ConnectForm({ topology, onConnect }: Props) {
  const [from, setFrom] = useState("");
  const [target, setTarget] = useState("");

  const devices = topology.nodes.map((n) => n.name);
  // Only domains that something is actually attached to; an orphan left behind
  // by a disconnect would be a confusing thing to offer.
  const domains = useMemo(() => {
    const used = new Set<string>();
    for (const node of topology.nodes) {
      for (const iface of node.interfaces) used.add(iface.collision_domain);
    }
    return [...used].sort();
  }, [topology]);

  // Keep the selections pointing at things that still exist after an edit.
  useEffect(() => {
    if (from && !devices.includes(from)) setFrom("");
  }, [devices, from]);

  const targets = devices.filter((name) => name !== from);
  const canConnect = from !== "" && target !== "";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canConnect) return;

    if (target.startsWith(DOMAIN)) {
      onConnect({
        type: "connect",
        node: from,
        collisionDomain: target.slice(DOMAIN.length),
      });
    } else {
      onConnect({
        type: "link",
        a: from,
        b: target.slice(DEVICE.length),
        collisionDomain: suggestCollisionDomain(topology),
      });
    }
    setTarget("");
  };

  if (devices.length === 0) return null;

  return (
    <form className="connect-form" onSubmit={submit}>
      <h2 className="panel__heading" id="connect-heading">
        Connect
      </h2>

      <div className="connect-form__row">
        <label htmlFor="connect-from">Device</label>
        <select id="connect-from" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Choose a device…</option>
          {devices.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="connect-form__row">
        <label htmlFor="connect-target">Connect to</label>
        <select
          id="connect-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={from === ""}
          aria-describedby="connect-explanation"
        >
          <option value="">Choose a destination…</option>
          {targets.length > 0 && (
            <optgroup label="Device (creates a new link)">
              {targets.map((name) => (
                <option key={name} value={DEVICE + name}>
                  {name}
                </option>
              ))}
            </optgroup>
          )}
          {domains.length > 0 && (
            <optgroup label="Collision domain (joins a shared segment)">
              {domains.map((name) => (
                <option key={name} value={DOMAIN + name}>
                  {name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* State the outcome before the control is activated, rather than
          leaving the user to infer it from the result. */}
      <p className="connect-form__explanation" id="connect-explanation">
        {target.startsWith(DOMAIN)
          ? `${from} will join collision domain ${target.slice(DOMAIN.length)}.`
          : target
            ? `A new collision domain ${suggestCollisionDomain(topology)} will link ${from} and ${target.slice(DEVICE.length)}.`
            : "Choosing a device creates a new link; choosing a collision domain joins an existing shared segment."}
      </p>

      <button type="submit" disabled={!canConnect}>
        Connect
      </button>
    </form>
  );
}
