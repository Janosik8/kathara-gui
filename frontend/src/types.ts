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

/**
 * Every FRR daemon the backend can enable, with what it is for, in the order
 * shown. Mirrors `KNOWN_DAEMONS` in `domain/model.py`.
 */
export const DAEMONS = [
  ["zebra", "routing table; always needed"],
  ["staticd", "static routes"],
  ["bgpd", "BGP"],
  ["ospfd", "OSPFv2"],
  ["ospf6d", "OSPFv3, IPv6"],
  ["ripd", "RIP"],
  ["ripngd", "RIPng, IPv6"],
  ["isisd", "IS-IS"],
  ["fabricd", "OpenFabric"],
  ["eigrpd", "EIGRP"],
  ["babeld", "Babel"],
  ["ldpd", "MPLS LDP"],
  ["pimd", "PIM multicast"],
  ["pim6d", "PIM multicast, IPv6"],
  ["nhrpd", "NHRP, for DMVPN"],
  ["bfdd", "BFD"],
  ["pbrd", "policy-based routing"],
  ["vrrpd", "VRRP"],
  ["pathd", "segment-routing paths"],
  ["sharpd", "FRR's test daemon"],
] as const;

export const KNOWN_DAEMONS = DAEMONS.map(([name]) => name);

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
  /** Run the container privileged; Kathará allows it only as administrator or root. */
  privileged?: boolean;
  /** Addresses on `lo` beyond 127.0.0.1, in CIDR form, e.g. 10.255.0.1/32. */
  loopbacks?: string[];
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
  /**
   * Where a two-device link's label sits along the link, from 0.05 to 0.95,
   * from its first device's end, once slid by hand (FR-50). Absent means the
   * middle.
   */
  label_at?: number | null;
}

export type ZoneShape = "rectangle" | "ellipse" | "cloud";

/**
 * A named area drawn behind devices: an OSPF area, an AS, a LAN (FR-10). A
 * layer of its own: moving a device does not move its zone, nor the reverse.
 */
export interface Zone {
  id: string;
  name: string;
  shape: ZoneShape;
  /** Top-left corner. */
  position: Position;
  width: number;
  height: number;
}

/**
 * A line of text placed anywhere on the canvas, at a size of its own (FR-51).
 * For the reader only, like a zone, and it belongs to nothing.
 */
export interface TextLabel {
  id: string;
  text: string;
  /** Top-left corner. */
  position: Position;
  /** Font size, in canvas pixels: TEXT_SIZE_MIN to TEXT_SIZE_MAX. */
  size: number;
}

/** The font sizes a text label may have; the server holds the same bounds. */
export const TEXT_SIZE_MIN = 8;
export const TEXT_SIZE_MAX = 96;

export interface Topology {
  name: string;
  description?: string | null;
  version?: string | null;
  author?: string | null;
  email?: string | null;
  web?: string | null;
  nodes: Node[];
  collision_domains: CollisionDomain[];
  /** Optional: a topology from before zones has none. */
  zones?: Zone[];
  /** Optional, likewise: from before text labels (FR-51). */
  texts?: TextLabel[];
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
