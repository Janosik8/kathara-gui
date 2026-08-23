/**
 * Mirror of the Python domain model in `src/kathara_gui/domain/model.py`.
 *
 * Kept hand-written rather than generated: the model is small, and the
 * duplication is caught immediately by the API round-trip tests. If it grows,
 * generate these from the OpenAPI schema instead.
 */

export type DeviceKind = "router" | "switch" | "pc" | "server";

export const DEVICE_KINDS: readonly DeviceKind[] = ["router", "switch", "pc", "server"];

/** FRR daemons the backend knows how to enable. */
export const KNOWN_DAEMONS = [
  "zebra",
  "bgpd",
  "ospfd",
  "ospf6d",
  "ripd",
  "ripngd",
  "isisd",
  "staticd",
] as const;

export interface Position {
  x: number;
  y: number;
}

/**
 * One end of a link being drawn in connect mode.
 *
 * Either end may be a device or an existing collision domain, which is what
 * lets a third device join a segment two others already share — the shared
 * medium is a first-class thing in Kathara, so it is selectable here too.
 */
export type PendingEnd =
  | { kind: "device"; name: string }
  | { kind: "domain"; name: string };

export interface Interface {
  number: number;
  collision_domain: string;
  mac_address?: string | null;
  /** Address in CIDR form, e.g. "10.0.0.1/24". */
  ip?: string | null;
}

export interface Node {
  name: string;
  kind: DeviceKind;
  image?: string | null;
  memory?: string | null;
  cpus?: number | null;
  bridged: boolean;
  position: Position;
  interfaces: Interface[];
  daemons: string[];
  /** lab.conf options the model does not interpret, preserved verbatim. */
  extra_options: Record<string, string>;
}

export interface CollisionDomain {
  name: string;
  subnet?: string | null;
}

export interface Topology {
  name: string;
  description?: string | null;
  version?: string | null;
  author?: string | null;
  email?: string | null;
  web?: string | null;
  nodes: Node[];
  collision_domains: CollisionDomain[];
}

export interface TopologyState {
  topology: Topology;
  dirty: boolean;
  path: string | null;
}

export function emptyTopology(): Topology {
  return { name: "untitled", nodes: [], collision_domains: [] };
}

export function newNode(name: string, kind: DeviceKind, position: Position): Node {
  return {
    name,
    kind,
    bridged: false,
    position,
    interfaces: [],
    daemons: kind === "router" ? ["zebra"] : [],
    extra_options: {},
  };
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

/** Lowest unused interface index, so numbering stays gap-free. */
export function nextInterfaceNumber(node: Node): number {
  const used = new Set(node.interfaces.map((i) => i.number));
  let candidate = 0;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}
