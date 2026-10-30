/**
 * Topology edits as discrete, described operations (decision D4).
 *
 * Nothing mutates a topology directly. Every change is an `Operation` value
 * applied by a pure reducer, which buys three things:
 *
 *  - **Testability.** The whole edit model is exercised without React.
 *  - **Undo.** A log of what happened, rather than diffed snapshots.
 *  - **Collaboration later.** Capability 7 becomes "send these operations over
 *    the WebSocket and merge them", not a rewrite. This is the single reason
 *    the indirection is worth it now.
 *
 * The reducer is pure and returns a new topology; it never edits in place.
 */

import {
  type CollisionDomain,
  type Interface,
  type Node,
  type Position,
  type Topology,
  type Zone,
  compactInterfaces,
  nextInterfaceNumber,
} from "../types";

export type Operation =
  | { type: "addNode"; node: Node }
  | { type: "removeNode"; name: string }
  | { type: "moveNode"; name: string; position: Position }
  // Aligning a selection moves many devices at once; as one operation it is
  // also one undo step.
  | {
      type: "moveNodes";
      positions: Record<string, Position>;
      label?: string;
      /** Also return every moved shared segment to its place between its members. */
      releaseDomains?: boolean;
    }
  // A shared segment dragged by hand. Without a position of its own it was
  // drawn between its members, so it followed them, and a drag of it was
  // thrown away on the next render (test step 1D.1).
  | { type: "moveDomain"; name: string; position: Position }
  | { type: "renameNode"; from: string; to: string }
  | { type: "updateNode"; name: string; changes: Partial<Omit<Node, "name">> }
  // One router's daemons onto every router, as one undo step (test step 3B.1:
  // "apply to all ... only one button for the whole daemon settings").
  | { type: "applyDaemons"; from: string }
  | { type: "connect"; node: string; collisionDomain: string; number?: number }
  // Linking two devices is one user intent, so it is one operation and one
  // undo step — not two `connect`s the user must undo twice.
  | { type: "link"; a: string; b: string; collisionDomain: string }
  | { type: "disconnect"; node: string; number: number }
  // Removing a whole link, rather than one end of it. Disconnecting a single
  // interface leaves the other device still attached to a domain nothing else
  // is on, which is not what "delete this link" means.
  | { type: "removeLink"; collisionDomain: string }
  | { type: "updateInterface"; node: string; number: number; changes: Partial<Interface> }
  | { type: "setSubnet"; collisionDomain: string; subnet: string | null }
  | { type: "setLabMetadata"; changes: Partial<Omit<Topology, "nodes" | "collision_domains" | "zones">> }
  | { type: "addZone"; zone: Zone }
  | { type: "updateZone"; id: string; changes: Partial<Omit<Zone, "id">>; label?: string }
  | { type: "removeZone"; id: string }
  | { type: "replaceTopology"; topology: Topology };

/** Thrown when an operation refers to something that is not there. */
export class OperationError extends Error {}

function mapNode(topology: Topology, name: string, fn: (node: Node) => Node): Topology {
  let found = false;
  const nodes = topology.nodes.map((node) => {
    if (node.name !== name) return node;
    found = true;
    return fn(node);
  });
  if (!found) throw new OperationError(`No device named "${name}".`);
  return { ...topology, nodes };
}

/**
 * Drop collision domains that no remaining device is attached to.
 *
 * Only ever called for deletion, never for disconnection — see `removeNode`.
 */
function pruneEmptyDomains(topology: Topology, remaining: Node[]): CollisionDomain[] {
  const used = new Set<string>();
  for (const node of remaining) {
    for (const iface of node.interfaces) used.add(iface.collision_domain);
  }
  return topology.collision_domains.filter((cd) => used.has(cd.name));
}

/** Register a collision domain if this is the first reference to it. */
function ensureCollisionDomain(topology: Topology, name: string): CollisionDomain[] {
  if (topology.collision_domains.some((cd) => cd.name === name)) {
    return topology.collision_domains;
  }
  return [...topology.collision_domains, { name }];
}

/**
 * Why Kathará would refuse this device name, or null. Its own rule
 * (`Kathara.model.Machine`): otherwise the deploy fails with "Invalid device
 * name" and says nothing about what is allowed. Mirrors
 * `kathara_name_problem` in `domain/naming.py`.
 */
export function deviceNameProblem(name: string): string | null {
  if (/^[a-z0-9_]{1,30}$/.test(name)) return null;
  const suggestion = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30) || "r1";
  return (
    "Kathará only accepts device names made of lowercase letters, digits and " +
    `underscores, up to 30 characters, so it would refuse "${name}". Try "${suggestion}".`
  );
}

const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

const labCharOk = (c: string) => /[\p{L}\p{N} _-]/u.test(c);

/** The nearest acceptable lab name: "BGP exam, group A" → "BGP exam group A". */
export function suggestLabName(name: string): string {
  const cleaned = [...name]
    .map((c) => (labCharOk(c) ? c : " "))
    .join("")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .slice(0, 48)
    .trim();
  if (!cleaned) return "untitled";
  return RESERVED_WINDOWS_NAMES.has(cleaned.toLowerCase()) ? `${cleaned}1` : cleaned;
}

/**
 * Why this cannot be a lab's name, or null (test 3E.2). The name is also its
 * folder's name, exactly, and no two scenarios may share one: Kathará knows a
 * running lab by its name, so two folders with one name are one lab to it.
 * Mirrors `lab_name_problem` in `domain/naming.py`; `taken` is the other
 * scenarios' names, compared case-insensitively as Windows and macOS do.
 */
export function labNameProblem(name: string, taken: string[] = []): string | null {
  if (!name.trim()) return "A lab needs a name.";
  if (name.length > 48) {
    return (
      "A lab name can be at most 48 characters, because it is also the folder's name " +
      "and Windows limits the length of a path."
    );
  }
  if (name !== name.trim()) return "A lab name cannot begin or end with a space.";
  const bad = [...new Set([...name].filter((c) => !labCharOk(c)))].sort();
  if (bad.length > 0) {
    return (
      "A lab name is also its folder's name, so it can hold only letters, digits, " +
      `spaces, dashes and underscores, not ${bad.map((c) => `'${c}'`).join(" ")}. ` +
      `Try "${suggestLabName(name)}".`
    );
  }
  if (RESERVED_WINDOWS_NAMES.has(name.toLowerCase())) {
    return `"${name}" is reserved by Windows and cannot name a folder. Try "${name}1".`;
  }
  const clash = taken.find((other) => other.toLowerCase() === name.toLowerCase());
  if (clash !== undefined) {
    return `There is already a scenario called "${clash}". Choose another name.`;
  }
  return null;
}

export function apply(topology: Topology, op: Operation): Topology {
  switch (op.type) {
    case "addNode": {
      if (topology.nodes.some((n) => n.name.toLowerCase() === op.node.name.toLowerCase())) {
        // Case-insensitive: "R1" and "r1" collide on macOS and Windows.
        throw new OperationError(`A device named "${op.node.name}" already exists.`);
      }
      return { ...topology, nodes: [...topology.nodes, op.node] };
    }

    case "removeNode": {
      const nodes = topology.nodes.filter((n) => n.name !== op.name);
      if (nodes.length === topology.nodes.length) {
        throw new OperationError(`No device named "${op.name}".`);
      }
      // Deleting a device leaves its collision domains behind. One that is
      // now empty is invisible on the canvas but still in the model, and it
      // would silently consume address space at the next allocation — so it
      // goes with the device.
      //
      // A domain that still has members is kept, along with any planned
      // subnet: those are still in use. `disconnect` keeps empty domains
      // deliberately, since briefly detaching a cable should not discard the
      // plan; deleting the device is a clearer statement of intent.
      return { ...topology, collision_domains: pruneEmptyDomains(topology, nodes), nodes };
    }

    case "moveNode":
      return mapNode(topology, op.name, (node) => ({ ...node, position: op.position }));

    case "moveNodes": {
      const unknown = Object.keys(op.positions).filter(
        (name) => !topology.nodes.some((n) => n.name === name),
      );
      if (unknown.length > 0) {
        throw new OperationError(`No device named "${unknown[0]}".`);
      }
      return {
        ...topology,
        nodes: topology.nodes.map((node) =>
          op.positions[node.name] ? { ...node, position: op.positions[node.name]! } : node,
        ),
        collision_domains: op.releaseDomains
          ? topology.collision_domains.map((cd) => ({ ...cd, position: null }))
          : topology.collision_domains,
      };
    }

    case "moveDomain": {
      if (!topology.collision_domains.some((cd) => cd.name === op.name)) {
        throw new OperationError(`No collision domain named "${op.name}".`);
      }
      return {
        ...topology,
        collision_domains: topology.collision_domains.map((cd) =>
          cd.name === op.name ? { ...cd, position: op.position } : cd,
        ),
      };
    }

    case "renameNode": {
      if (op.from === op.to) return topology;
      const problem = deviceNameProblem(op.to);
      if (problem) throw new OperationError(problem);
      // Not the device itself: renaming "R23" to "r23" is not a clash.
      if (
        topology.nodes.some(
          (n) => n.name !== op.from && n.name.toLowerCase() === op.to.toLowerCase(),
        )
      ) {
        throw new OperationError(`A device named "${op.to}" already exists.`);
      }
      return mapNode(topology, op.from, (node) => ({ ...node, name: op.to }));
    }

    case "updateNode":
      return mapNode(topology, op.name, (node) => ({ ...node, ...op.changes }));

    case "applyDaemons": {
      const source = topology.nodes.find((n) => n.name === op.from);
      if (!source) throw new OperationError(`No device named "${op.from}".`);
      // Only routers run FRR; a PC's daemon list would mean nothing.
      return {
        ...topology,
        nodes: topology.nodes.map((n) =>
          n.kind === "router" && n !== source ? { ...n, daemons: [...source.daemons] } : n,
        ),
      };
    }

    case "connect": {
      const node = topology.nodes.find((n) => n.name === op.node);
      if (!node) throw new OperationError(`No device named "${op.node}".`);

      const number = op.number ?? nextInterfaceNumber(node);
      if (node.interfaces.some((i) => i.number === number)) {
        throw new OperationError(`${op.node} already has an eth${number}.`);
      }

      const withInterface = mapNode(topology, op.node, (n) => ({
        ...n,
        interfaces: [
          ...n.interfaces,
          { number, collision_domain: op.collisionDomain },
        ].sort((a, b) => a.number - b.number),
      }));
      return {
        ...withInterface,
        collision_domains: ensureCollisionDomain(withInterface, op.collisionDomain),
      };
    }

    case "link": {
      if (op.a === op.b) {
        throw new OperationError("A device cannot be linked to itself.");
      }
      // Applied through `apply` so both ends get the same validation a single
      // `connect` would receive.
      return applyAll(topology, [
        { type: "connect", node: op.a, collisionDomain: op.collisionDomain },
        { type: "connect", node: op.b, collisionDomain: op.collisionDomain },
      ]);
    }

    case "removeLink": {
      const attached = topology.nodes.some((node) =>
        node.interfaces.some((iface) => iface.collision_domain === op.collisionDomain),
      );
      if (!attached) {
        throw new OperationError(`Nothing is connected to ${op.collisionDomain}.`);
      }

      const nodes = topology.nodes.map((node) => {
        const interfaces = node.interfaces.filter(
          (iface) => iface.collision_domain !== op.collisionDomain,
        );
        return interfaces.length === node.interfaces.length
          ? node
          : compactInterfaces({ ...node, interfaces });
      });
      // The domain goes too: unlike a single disconnect, deleting the link is
      // an unambiguous statement that this segment is no longer wanted, so
      // keeping its planned subnet would only clutter the addressing panel.
      return {
        ...topology,
        nodes,
        collision_domains: topology.collision_domains.filter(
          (cd) => cd.name !== op.collisionDomain,
        ),
      };
    }

    case "disconnect":
      return mapNode(topology, op.node, (node) => {
        const interfaces = node.interfaces.filter((i) => i.number !== op.number);
        if (interfaces.length === node.interfaces.length) {
          throw new OperationError(`${op.node} has no eth${op.number}.`);
        }
        return compactInterfaces({ ...node, interfaces });
      });

    case "updateInterface":
      return mapNode(topology, op.node, (node) => {
        let found = false;
        const interfaces = node.interfaces.map((iface) => {
          if (iface.number !== op.number) return iface;
          found = true;
          return { ...iface, ...op.changes };
        });
        if (!found) throw new OperationError(`${op.node} has no eth${op.number}.`);
        return { ...node, interfaces };
      });

    case "setSubnet": {
      const exists = topology.collision_domains.some((cd) => cd.name === op.collisionDomain);
      const collision_domains = exists
        ? topology.collision_domains.map((cd) =>
            cd.name === op.collisionDomain ? { ...cd, subnet: op.subnet } : cd,
          )
        : [...topology.collision_domains, { name: op.collisionDomain, subnet: op.subnet }];
      return { ...topology, collision_domains };
    }

    case "setLabMetadata":
      return { ...topology, ...op.changes };

    case "addZone": {
      const zones = topology.zones ?? [];
      if (zones.some((z) => z.id === op.zone.id)) {
        throw new OperationError(`A zone with the id "${op.zone.id}" already exists.`);
      }
      return { ...topology, zones: [...zones, op.zone] };
    }

    case "updateZone": {
      const zones = topology.zones ?? [];
      if (!zones.some((z) => z.id === op.id)) throw new OperationError("No such zone.");
      return {
        ...topology,
        zones: zones.map((z) => (z.id === op.id ? { ...z, ...op.changes } : z)),
      };
    }

    case "removeZone": {
      const zones = topology.zones ?? [];
      if (!zones.some((z) => z.id === op.id)) throw new OperationError("No such zone.");
      return { ...topology, zones: zones.filter((z) => z.id !== op.id) };
    }

    case "replaceTopology":
      return op.topology;
  }
}

/** Apply a sequence of operations in order. */
export function applyAll(topology: Topology, ops: readonly Operation[]): Topology {
  return ops.reduce(apply, topology);
}

/**
 * A short human-readable label, used for undo hints and screen-reader
 * announcements. Kept beside the operations so a new operation cannot be
 * added without deciding how it is described to a non-visual user.
 */
export function describe(op: Operation): string {
  switch (op.type) {
    case "addNode":
      return `Added ${op.node.kind} ${op.node.name}`;
    case "removeNode":
      return `Removed ${op.name}`;
    case "moveNode":
      return `Moved ${op.name}`;
    case "moveNodes": {
      const count = Object.keys(op.positions).length;
      return op.label ?? `Moved ${count} ${count === 1 ? "device" : "devices"}`;
    }
    case "moveDomain":
      return `Moved ${op.name}`;
    case "renameNode":
      return `Renamed ${op.from} to ${op.to}`;
    case "updateNode":
      return `Changed ${op.name}`;
    case "applyDaemons":
      return `Gave every router the routing daemons of ${op.from}`;
    case "connect":
      return `Connected ${op.node} to ${op.collisionDomain}`;
    case "link":
      return `Linked ${op.a} and ${op.b} on ${op.collisionDomain}`;
    case "disconnect":
      return `Disconnected eth${op.number} on ${op.node}`;
    case "removeLink":
      return `Removed the link on ${op.collisionDomain}`;
    case "updateInterface":
      return `Changed eth${op.number} on ${op.node}`;
    case "setSubnet":
      return op.subnet
        ? `Set ${op.collisionDomain} subnet to ${op.subnet}`
        : `Cleared ${op.collisionDomain} subnet`;
    case "setLabMetadata":
      // The name is the field users actually change, and it is the one that
      // decides the lab folder and Kathará's identity for the lab, so it is
      // worth naming rather than announcing "changed lab details".
      return op.changes.name !== undefined
        ? `Renamed the scenario to ${op.changes.name}`
        : "Changed lab details";
    case "addZone":
      return `Added the zone ${op.zone.name || "without a name"}`;
    case "updateZone":
      return op.label ?? "Changed a zone";
    case "removeZone":
      return "Removed a zone";
    case "replaceTopology":
      return "Replaced the topology";
  }
}
