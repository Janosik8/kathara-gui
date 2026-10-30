/**
 * The host part of an interface's address, shown beside its label on the
 * canvas when the switch for it is on (FR-49).
 *
 * The part shown starts at the first octet (IPv4) or group (IPv6) that the
 * prefix does not cover entirely, so it is never less than the host part and
 * never cuts a number in two:
 *
 *   192.168.0.1/24  -> .1
 *   192.168.0.1/16  -> .0.1
 *   10.1.17.5/20    -> .17.5     (the prefix ends inside the third octet)
 *   2001:db8::1/64  -> ::1
 *
 * The prefix is the address's own. An address written without one takes its
 * collision domain's pinned subnet's, and with neither only the last octet or
 * group is shown.
 */

/** What to show beside the label, or null for no address or one not understood. */
export function hostPart(ip: string | null | undefined, subnet?: string | null): string | null {
  if (!ip) return null;
  const [address = "", ownPrefix] = ip.trim().split("/");
  const prefix = ownPrefix ?? subnet?.split("/")[1];

  if (address.includes(":")) {
    const groups = expandIPv6(address);
    if (!groups) return null;
    const bits = readPrefix(prefix, 128);
    if (bits === null) return null;
    if (bits < 16) return address;
    return ipv6Tail(groups.slice(Math.min(Math.floor(bits / 16), 7)));
  }

  const octets = address.split(".");
  if (octets.length !== 4 || !octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)) {
    return null;
  }
  const bits = readPrefix(prefix, 32);
  if (bits === null) return null;
  if (bits < 8) return address;
  return "." + octets.slice(Math.min(Math.floor(bits / 8), 3)).map(Number).join(".");
}

/** The prefix length, the whole address when there is none, or null if unreadable. */
function readPrefix(prefix: string | undefined, max: number): number | null {
  if (prefix === undefined) return max;
  if (!/^\d{1,3}$/.test(prefix)) return null;
  const bits = Number(prefix);
  return bits <= max ? bits : null;
}

/** Eight groups as numbers, or null if `address` is not IPv6 this can read. */
function expandIPv6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const part = (text: string) => (text === "" ? [] : text.split(":"));
  const head = part(halves[0]!);
  const tail = halves.length === 2 ? part(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** The groups from the first not wholly network, leading zeros folded into `::`. */
function ipv6Tail(groups: number[]): string {
  const zeros = groups.findIndex((g) => g !== 0);
  const hex = (g: number) => g.toString(16);
  if (zeros === -1) return "::0";
  if (zeros === 0) return ":" + groups.map(hex).join(":");
  return "::" + groups.slice(zeros).map(hex).join(":");
}
