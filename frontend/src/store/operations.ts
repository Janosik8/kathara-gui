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
  nextInterfaceNumber,
} from "../types";

export type Operation =
  | { type: "addNode"; node: Node }
  | { type: "removeNode"; name: string }
  | { type: "moveNode"; name: string; position: Position }
  // Aligning a selection moves many devices at once; as one operation it is
  // also one undo step.
  | { type: "moveNodes"; positions: Record<string, Position>; label?: string }
  | { type: "renameNode"; from: string; to: string }
  | { type: "updateNode"; name: string; changes: Partial<Omit<Node, "name">> }
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
  | { type: "setLabMetadata"; changes: Partial<Omit<Topology, "nodes" | "collision_domains">> }
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
      };
    }

    case "renameNode": {
      if (op.from === op.to) return topology;
      if (topology.nodes.some((n) => n.name.toLowerCase() === op.to.toLowerCase())) {
        throw new OperationError(`A device named "${op.to}" already exists.`);
      }
      return mapNode(topology, op.from, (node) => ({ ...node, name: op.to }));
    }

    case "updateNode":
      return mapNode(topology, op.name, (node) => ({ ...node, ...op.changes }));

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

      const nodes = topology.nodes.map((node) => ({
        ...node,
        interfaces: node.interfaces.filter(
          (iface) => iface.collision_domain !== op.collisionDomain,
        ),
      }));
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
        return { ...node, interfaces };
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
    case "renameNode":
      return `Renamed ${op.from} to ${op.to}`;
    case "updateNode":
      return `Changed ${op.name}`;
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
    case "replaceTopology":
      return "Replaced the topology";
  }
}
