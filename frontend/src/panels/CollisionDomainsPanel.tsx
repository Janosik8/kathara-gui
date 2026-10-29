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
 */

import type { Operation } from "../store/operations";
import type { Topology } from "../types";
import { CommittedInput } from "./CommittedInput";

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
      <p className="field__hint">
        Leave a subnet blank to have one allocated. Set one to pin that network.
      </p>

      <ul className="domain-list">
        {domains.map(({ name, members, subnet }) => (
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
          </li>
        ))}
      </ul>
    </>
  );
}

interface DomainRow {
  name: string;
  members: number;
  subnet: string | null;
}

/** Domains something is actually attached to, in first-seen order. */
export function referencedDomains(topology: Topology): DomainRow[] {
  const counts = new Map<string, number>();
  for (const node of topology.nodes) {
    for (const iface of node.interfaces) {
      counts.set(iface.collision_domain, (counts.get(iface.collision_domain) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, members]) => ({
    name,
    members,
    subnet: topology.collision_domains.find((cd) => cd.name === name)?.subnet ?? null,
  }));
}
