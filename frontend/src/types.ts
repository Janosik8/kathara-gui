/**
 * Mirror of the Python domain model in `src/kathara_gui/domain/model.py`.
 *
 * Kept hand-written rather than generated: the model is small, and the
 * duplication is caught immediately by the API round-trip tests. If it grows,
 * generate these from the OpenAPI schema instead.
 */

export type DeviceKind = "router" | "switch" | "pc" | "server";

export const DEVICE_KINDS: readonly DeviceKind[] = ["router", "switch", "pc", "server"];

/**
 * The image each kind runs unless told otherwise.
 *
 * Mirrors `DEFAULT_IMAGES` in `domain/model.py`. A router *must* get an image
 * carrying FRR: Kathará's own default is `kathara/base`, which has no routing
 * daemons at all, so leaving this unset produced routers with no `vtysh`, an
 * `/etc/frr/daemons` file nothing reads, and no way to configure routing —
 * which is the entire point of the tool.
 */
export const DEFAULT_IMAGES: Record<DeviceKind, string> = {
  router: "kathara/frr",
  switch: "kathara/base",
  pc: "kathara/base",
  server: "kathara/base",
};

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
  /**
   * Where a segment shared by three or more devices is drawn, once moved by
   * hand. Absent means between its members, following them as they move.
   */
  position?: Position | null;
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
    // Set explicitly rather than left to Kathará's default, which is
    // kathara/base for everything and has no routing daemons.
    image: DEFAULT_IMAGES[kind],
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

/**
 * The device with its interfaces renumbered 0, 1, 2… in order.
 *
 * Kathará refuses to deploy a device with a gap — eth1 and no eth0 fails with
 * "Interface `0` missing" — and removing a link is what leaves one. Each
 * interface keeps its domain and address; only its number moves down.
 */
export function compactInterfaces(node: Node): Node {
  const ordered = [...node.interfaces].sort((a, b) => a.number - b.number);
  if (ordered.every((iface, index) => iface.number === index)) return node;
  return { ...node, interfaces: ordered.map((iface, number) => ({ ...iface, number })) };
}

/** Lowest unused interface index, so numbering stays gap-free. */
export function nextInterfaceNumber(node: Node): number {
  const used = new Set(node.interfaces.map((i) => i.number));
  let candidate = 0;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}
