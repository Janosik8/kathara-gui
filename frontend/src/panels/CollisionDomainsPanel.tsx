/**
 * Planning the address space per collision domain.
 *
 * "Collision domain C should use 192.168.1.0/24" is a normal thing to want,
 * and the allocator already honours a subnet that is set — it fills in hosts
 * inside whatever each domain has been given and only invents subnets for the
 * ones left blank. This panel is the missing way to say it.
 *
 * It also gives collision domains a presence in the interface at all. Until
 * now they existed only as edge labels on the canvas and as text inside the
 * tree's interface rows, which left them unreachable for anyone not using a
 * pointer.
 *
 * A link between two devices also gets the keyboard's way to slide its label
 * along the link, which a pointer does on the canvas (FR-50).
 */

import { useState } from "react";
import { clampLabelAt } from "../canvas/linkLabel";
import type { Operation } from "../store/operations";
import type { Topology } from "../types";
import { CommittedInput } from "./CommittedInput";
import { Explanation } from "./Explain";

interface Props {
  topology: Topology;
  onDispatch: (op: Operation) => void;
}

/** Rejects what the backend would reject, so the message arrives immediately. */
export function validateSubnet(value: string): string | null {
  if (value.trim() === "") return null; // blank means "allocate one for me"

  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return "Use CIDR form, for example 192.168.1.0/24.";

  const octets = match.slice(1, 5).map(Number);
  if (octets.some((o) => o > 255)) return "Each octet must be 0-255.";

  const prefix = Number(match[5]);
  if (prefix > 32) return "The prefix must be /32 or shorter.";

  // A subnet must name a network, not a host on one. 192.168.1.1/24 is a
  // common slip, and the model rejects it, so say so here with the fix.
  const asInt = octets.reduce((acc, o) => acc * 256 + o, 0);
  const hostBits = 32 - prefix;
  const network = hostBits === 32 ? 0 : Math.floor(asInt / 2 ** hostBits) * 2 ** hostBits;
  if (network !== asInt) {
    const suggestion = [24, 16, 8, 0].map((shift) => Math.floor(network / 2 ** shift) % 256);
    return `That is a host address. Did you mean ${suggestion.join(".")}/${prefix}?`;
  }
  return null;
}

export function CollisionDomainsPanel({ topology, onDispatch }: Props) {
  const domains = referencedDomains(topology);
  if (domains.length === 0) return null;

  return (
    <>
      <Explanation>
        Leave a subnet blank to have one allocated. Set one to pin that network.
      </Explanation>

      <ul className="domain-list">
        {domains.map(({ name, members, subnet, labelAt }) => (
          <li key={name} className="domain-list__item">
            <div className="domain-list__title">
              {name}
              <span className="domain-list__members">
                {members === 1 ? "1 device" : `${members} devices`}
              </span>
            </div>
            <CommittedInput
              id={`domain-subnet-${name}`}
              label={`Subnet for ${name}`}
              value={subnet ?? ""}
              placeholder="e.g. 192.168.1.0/24"
              validate={validateSubnet}
              onCommit={(next) => {
                const trimmed = next.trim();
                onDispatch({
                  type: "setSubnet",
                  collisionDomain: name,
                  subnet: trimmed === "" ? null : trimmed,
                });
              }}
            />
            {members === 2 && (
              <LabelSlider name={name} at={labelAt} onDispatch={onDispatch} />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Where the link's label sits, in percent of the way from its first device.
 * Committed when the slider is let go, so one slide is one undo step.
 */
function LabelSlider({
  name,
  at,
  onDispatch,
}: {
  name: string;
  at: number | null;
  onDispatch: (op: Operation) => void;
}) {
  const stored = Math.round((at ?? 0.5) * 100);
  const [value, setValue] = useState<number | null>(null);
  const shown = value ?? stored;
  const commit = () => {
    if (value !== null && value !== stored) {
      onDispatch({ type: "moveLabel", collisionDomain: name, at: clampLabelAt(value / 100) });
    }
    setValue(null);
  };
  const id = `domain-label-${name}`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        Label of {name} along the link
      </label>
      <div className="domain-list__slider">
        <input
          id={id}
          type="range"
          min={5}
          max={95}
          step={5}
          value={shown}
          aria-valuetext={`${shown}% of the way from the first device`}
          onChange={(e) => setValue(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <span className="field__hint">{shown}%</span>
        {at !== null && (
          <button
            type="button"
            onClick={() => onDispatch({ type: "moveLabel", collisionDomain: name, at: null })}
          >
            Middle
          </button>
        )}
      </div>
    </div>
  );
}

interface DomainRow {
  name: string;
  members: number;
  subnet: string | null;
  /** A two-device link's label place, if slid (FR-50). */
  labelAt: number | null;
}

/** Domains something is actually attached to, in first-seen order. */
export function referencedDomains(topology: Topology): DomainRow[] {
  const counts = new Map<string, number>();
  for (const node of topology.nodes) {
    for (const iface of node.interfaces) {
      counts.set(iface.collision_domain, (counts.get(iface.collision_domain) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, members]) => {
    const cd = topology.collision_domains.find((d) => d.name === name);
    return { name, members, subnet: cd?.subnet ?? null, labelAt: cd?.label_at ?? null };
  });
}
