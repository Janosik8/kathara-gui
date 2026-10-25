"""Planning and checking IP addressing.

Two jobs, deliberately separate.

**Allocation** proposes subnets for collision domains and host addresses for
interfaces. It never overwrites something the user set by hand unless asked:
the tool assists a designer, it does not overrule one.

**Validation** reports what is wrong with an addressing plan. This is the part
that earns its keep. The specification calls out one case in particular —
*"warning about different subnets residing in the same collision domain"* —
which is the classic lab failure: everything looks configured, the interfaces
come up, and nothing can reach anything because two devices on one wire are on
different networks.

Both are pure. Nothing here touches Docker, the filesystem or the network, so
the whole addressing model is testable without a container in sight.
"""

from __future__ import annotations

import ipaddress
from collections.abc import Iterator
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal

from kathara_gui.domain.model import CollisionDomain, Topology

__all__ = [
    "infer_subnets",
    "Severity",
    "AddressingIssue",
    "AllocationResult",
    "validate",
    "allocate",
    "DEFAULT_POOL",
    "DEFAULT_PREFIX",
]

# A private range with room for far more collision domains than any teaching
# lab will use. RFC 1918, so it can never collide with something real.
DEFAULT_POOL = "10.0.0.0/8"
DEFAULT_PREFIX = 24

IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network
IPInterface = ipaddress.IPv4Interface | ipaddress.IPv6Interface


class Severity(StrEnum):
    #: The lab will not work as intended.
    ERROR = "error"
    #: Probably a mistake, but legitimate in some designs.
    WARNING = "warning"


@dataclass(frozen=True)
class AddressingIssue:
    """One problem found in an addressing plan.

    Carries enough location for the UI to highlight the offending device or
    link rather than only printing a sentence.
    """

    severity: Severity
    code: str
    message: str
    collision_domain: str | None = None
    devices: tuple[str, ...] = ()

    def __str__(self) -> str:  # pragma: no cover - convenience only
        return f"[{self.severity.value}] {self.message}"


@dataclass
class AllocationResult:
    """What an allocation changed, so the UI can report it precisely."""

    topology: Topology
    assigned_subnets: dict[str, str] = field(default_factory=dict)
    assigned_addresses: dict[str, str] = field(default_factory=dict)
    #: Collision domains that could not be given a subnet, and why.
    skipped: list[str] = field(default_factory=list)
    #: Interfaces renumbered because their address was outside the subnet
    #: planned for their collision domain, mapped to the address they had.
    replaced: dict[str, str] = field(default_factory=dict)

    @property
    def changed(self) -> bool:
        return bool(self.assigned_subnets or self.assigned_addresses)


def _parse_interface(value: str) -> IPInterface | None:
    try:
        return ipaddress.ip_interface(value)
    except ValueError:
        return None


# ---------------------------------------------------------------- validation


def infer_subnets(topology: Topology) -> dict[str, str]:
    """The subnet each collision domain is evidently on, from its members.

    Kathará's format records the wiring but not the plan, so an imported lab
    arrives with named domains and no subnets — the addresses are on the
    interfaces, and nothing joins them up. The panel and the diagram then show
    a bare letter where they should show a network.

    Only agreed subnets are returned. Members whose addresses sit on *different*
    networks are the specification's headline fault, already reported by
    :func:`validate`; inventing a subnet for that domain would paper over the
    very thing the user needs to see.
    """
    inferred: dict[str, str] = {}

    for domain in {i.collision_domain for node in topology.nodes for i in node.interfaces}:
        networks = {
            str(parsed.network)
            for _, _, address in _members(topology, domain)
            if address and (parsed := _parse_interface(address)) is not None
        }
        if len(networks) == 1:
            inferred[domain] = networks.pop()

    return inferred


def validate(topology: Topology) -> list[AddressingIssue]:
    """Every problem in the current addressing plan, worst first."""
    issues: list[AddressingIssue] = []
    issues.extend(_check_unparseable_addresses(topology))
    issues.extend(_check_mixed_subnets_in_one_domain(topology))
    issues.extend(_check_duplicate_addresses(topology))
    issues.extend(_check_addresses_match_planned_subnet(topology))
    issues.extend(_check_overlapping_planned_subnets(topology))
    issues.extend(_check_reserved_addresses(topology))
    issues.extend(_check_missing_addresses(topology))
    issues.extend(_check_duplicate_loopbacks(topology))

    order = {Severity.ERROR: 0, Severity.WARNING: 1}
    return sorted(issues, key=lambda i: (order[i.severity], i.code, i.collision_domain or ""))


def _members(topology: Topology, domain: str) -> Iterator[tuple[str, int, str | None]]:
    """(device, interface number, address) for everything on ``domain``."""
    for node in topology.nodes:
        for iface in node.interfaces:
            if iface.collision_domain == domain:
                yield node.name, iface.number, iface.ip


def _check_unparseable_addresses(topology: Topology) -> list[AddressingIssue]:
    """The model validates on assignment, but an imported lab may carry junk."""
    issues = []
    for node in topology.nodes:
        for iface in node.interfaces:
            if iface.ip and _parse_interface(iface.ip) is None:
                issues.append(
                    AddressingIssue(
                        Severity.ERROR,
                        "unparseable_address",
                        f"{node.name} eth{iface.number} has {iface.ip!r}, "
                        "which is not a valid address in CIDR form.",
                        iface.collision_domain,
                        (node.name,),
                    )
                )
    return issues


def _check_mixed_subnets_in_one_domain(topology: Topology) -> list[AddressingIssue]:
    """The failure the specification singles out.

    Devices sharing a collision domain share a wire. If their addresses sit in
    different networks they cannot talk, even though every interface is up and
    every address is individually valid — which is exactly what makes it hard
    to spot by reading the configuration.
    """
    issues = []
    for domain in topology.referenced_collision_domains():
        networks: dict[str, list[str]] = {}
        for device, number, address in _members(topology, domain):
            parsed = _parse_interface(address) if address else None
            if parsed is None:
                continue
            networks.setdefault(str(parsed.network), []).append(f"{device} eth{number}")

        if len(networks) > 1:
            detail = "; ".join(
                f"{network} ({', '.join(sorted(where))})"
                for network, where in sorted(networks.items())
            )
            issues.append(
                AddressingIssue(
                    Severity.ERROR,
                    "mixed_subnets",
                    f"Collision domain {domain} carries more than one subnet: {detail}. "
                    "Devices on the same collision domain share a wire, so they cannot "
                    "reach each other unless they are on the same subnet.",
                    domain,
                    tuple(sorted({w.split()[0] for group in networks.values() for w in group})),
                )
            )
    return issues


def _check_duplicate_addresses(topology: Topology) -> list[AddressingIssue]:
    issues = []
    for domain in topology.referenced_collision_domains():
        seen: dict[str, list[str]] = {}
        for device, number, address in _members(topology, domain):
            parsed = _parse_interface(address) if address else None
            if parsed is None:
                continue
            seen.setdefault(str(parsed.ip), []).append(f"{device} eth{number}")

        for address, where in sorted(seen.items()):
            if len(where) > 1:
                issues.append(
                    AddressingIssue(
                        Severity.ERROR,
                        "duplicate_address",
                        f"{address} is assigned to more than one interface on collision "
                        f"domain {domain}: {', '.join(sorted(where))}.",
                        domain,
                        tuple(sorted({w.split()[0] for w in where})),
                    )
                )
    return issues


def _check_addresses_match_planned_subnet(topology: Topology) -> list[AddressingIssue]:
    """An interface outside the subnet planned for its collision domain."""
    issues = []
    for cd in topology.collision_domains:
        if not cd.subnet:
            continue
        planned = ipaddress.ip_network(cd.subnet, strict=False)
        for device, number, address in _members(topology, cd.name):
            parsed = _parse_interface(address) if address else None
            if parsed is None:
                continue
            if parsed.ip not in planned:
                issues.append(
                    AddressingIssue(
                        Severity.ERROR,
                        "outside_planned_subnet",
                        f"{device} eth{number} has {address}, which is outside "
                        f"{cd.subnet}, the subnet planned for collision domain {cd.name}.",
                        cd.name,
                        (device,),
                    )
                )
    return issues


def _check_overlapping_planned_subnets(topology: Topology) -> list[AddressingIssue]:
    """Two collision domains planned onto overlapping address space.

    A warning, not an error (bug 23). Usually it is a mistake, but a VPN or VRF
    lab reuses one subnet on purpose on either side of the tunnel, and calling
    that an error told the student their correct design was wrong. Unlike two
    subnets on one wire, Kathará and the routers run it without complaint.

    The message states the fact and nothing more (bug 32): the tester knows
    why the subnet is reused, and a paragraph on VPNs and VRFs only buried it.
    """
    issues = []
    planned = [
        (cd.name, ipaddress.ip_network(cd.subnet, strict=False))
        for cd in topology.collision_domains
        if cd.subnet
    ]
    for index, (name, network) in enumerate(planned):
        for other_name, other in planned[index + 1 :]:
            if network.overlaps(other):
                issues.append(
                    AddressingIssue(
                        Severity.WARNING,
                        "overlapping_subnets",
                        f"Collision domains {name} and {other_name} have the same "
                        f"subnet, {network}."
                        if network == other
                        else f"Collision domains {name} ({network}) and {other_name} "
                        f"({other}) have overlapping subnets.",
                        name,
                    )
                )
    return issues


def _check_reserved_addresses(topology: Topology) -> list[AddressingIssue]:
    """The network or broadcast address used as a host address.

    A /31 point-to-point link (RFC 3021) legitimately has neither, so it is
    exempt rather than flagged.
    """
    issues = []
    for node in topology.nodes:
        for iface in node.interfaces:
            parsed = _parse_interface(iface.ip) if iface.ip else None
            if parsed is None or parsed.network.prefixlen >= 31:
                continue
            if parsed.ip == parsed.network.network_address:
                what = "network address"
            elif parsed.ip == parsed.network.broadcast_address:
                what = "broadcast address"
            else:
                continue
            issues.append(
                AddressingIssue(
                    Severity.ERROR,
                    "reserved_address",
                    f"{node.name} eth{iface.number} uses {parsed.ip}, the {what} of "
                    f"{parsed.network}. It cannot be used as a host address.",
                    iface.collision_domain,
                    (node.name,),
                )
            )
    return issues


def _check_missing_addresses(topology: Topology) -> list[AddressingIssue]:
    """An interface with no address. A warning: it may well be intentional."""
    issues = []
    for node in topology.nodes:
        for iface in node.interfaces:
            if not iface.ip:
                issues.append(
                    AddressingIssue(
                        Severity.WARNING,
                        "missing_address",
                        f"{node.name} eth{iface.number} has no address.",
                        iface.collision_domain,
                        (node.name,),
                    )
                )
    return issues


def _check_duplicate_loopbacks(topology: Topology) -> list[AddressingIssue]:
    """One loopback address on two devices.

    A warning: a loopback usually serves as a router ID, which must be unique,
    but anycast gives several devices one address on purpose.
    """
    owners: dict[str, list[str]] = {}
    for node in topology.nodes:
        for address in node.loopbacks:
            ip = str(ipaddress.ip_interface(address).ip)
            if node.name not in owners.setdefault(ip, []):
                owners[ip].append(node.name)
    return [
        AddressingIssue(
            Severity.WARNING,
            "duplicate_loopback",
            f"{ip} is a loopback address on {', '.join(devices)}. As a router ID it must "
            "be unique; it is shared on purpose only for anycast.",
            None,
            tuple(devices),
        )
        for ip, devices in sorted(owners.items())
        if len(devices) > 1
    ]


# ---------------------------------------------------------------- allocation


def _parse_pool(pool: str) -> ipaddress.IPv4Network | ipaddress.IPv6Network:
    """The pool as a network, refusing one whose address has host bits set.

    ``192.168.0.0/8`` used to be read as ``192.0.0.0/8`` without a word, so
    the lab was addressed from 192.0.0.x and it looked as if nothing had
    happened (test step 3B.1). Guessing which half the user meant — the
    address or the mask — is worse than asking.
    """
    try:
        return ipaddress.ip_network(pool.strip())
    except ValueError as exc:
        try:
            loose = ipaddress.ip_network(pool.strip(), strict=False)
        except ValueError:
            raise ValueError(
                f"{pool!r} is not an address pool. Write one like 10.0.0.0/8."
            ) from exc
        address = pool.strip().split("/", 1)[0]
        value, width = int(ipaddress.ip_address(address)), loose.max_prefixlen
        # The shortest mask on an octet boundary for which the typed address
        # is a network address: 192.168.0.0 gives /16.
        longer = next(
            (
                f"{address}/{p}"
                for p in range(loose.prefixlen + 1, width)
                if p % 8 == 0 and value % (1 << (width - p)) == 0
            ),
            None,
        )
        hint = f", or a longer mask such as {longer} to keep {address}" if longer else ""
        raise ValueError(
            f"{pool} is not a network: a /{loose.prefixlen} mask keeps only the first "
            f"{loose.prefixlen} bits, which makes it {loose}. Type {loose} for that{hint}."
        ) from exc


def allocate(
    topology: Topology,
    *,
    pool: str = DEFAULT_POOL,
    prefix: int = DEFAULT_PREFIX,
    overwrite: Literal[True, False] = False,
) -> AllocationResult:
    """Fill in an addressing plan, returning a new topology.

    Subnets are carved out of ``pool`` at ``prefix`` length and handed to each
    collision domain in order; hosts are numbered from ``.1`` upwards.

    By default the plan is kept, so a partly hand-addressed design can be
    completed rather than replaced: every planned subnet, and every address
    inside its domain's subnet. An address *outside* the subnet planned for its
    domain is replaced (bug 33): the plan says where the domain is, and the
    address contradicts it. A domain with no planned subnet whose members agree
    on one is kept on that subnet, so a typed address is never renumbered just
    because the plan was left blank. ``overwrite=True`` starts afresh, which is
    what "renumber the whole lab" means.
    """
    network = _parse_pool(pool)
    if prefix < network.prefixlen:
        raise ValueError(
            f"A /{prefix} subnet is larger than the pool {pool}. "
            f"Choose a prefix of /{network.prefixlen} or longer."
        )

    result = AllocationResult(topology=topology.model_copy(deep=True))
    working = result.topology

    reserved = {
        ipaddress.ip_network(cd.subnet, strict=False)
        for cd in working.collision_domains
        if cd.subnet and not overwrite
    }
    # Subnets the members of an unplanned domain already agree on.
    planned_names = {cd.name for cd in working.collision_domains if cd.subnet}
    evident = (
        {}
        if overwrite
        else {d: s for d, s in infer_subnets(working).items() if d not in planned_names}
    )
    reserved |= {ipaddress.ip_network(subnet) for subnet in evident.values()}
    available = (net for net in network.subnets(new_prefix=prefix))

    for domain in working.referenced_collision_domains():
        entry = working.collision_domain(domain)
        if entry is None:
            # An interface can reference a domain that was never registered —
            # a topology built programmatically, or PUT by a client that only
            # sent the interfaces. The references are the source of truth, so
            # register it rather than skipping it silently.
            entry = CollisionDomain(name=domain)
            working.collision_domains.append(entry)

        planned = bool(entry.subnet) and not overwrite
        if planned:
            chosen = ipaddress.ip_network(entry.subnet, strict=False)
        elif domain in evident:
            chosen = ipaddress.ip_network(evident[domain])
            entry.subnet = str(chosen)
            result.assigned_subnets[domain] = str(chosen)
        else:
            chosen = _next_free(available, reserved)
            if chosen is None:
                result.skipped.append(domain)
                continue
            reserved.add(chosen)
            entry.subnet = str(chosen)
            result.assigned_subnets[domain] = str(chosen)

        _number_hosts(working, domain, chosen, overwrite, planned, result)

    return result


def _next_free(available: Iterator[IPNetwork], reserved: set[IPNetwork]) -> IPNetwork | None:
    """The next subnet from the pool that does not overlap a reserved one."""
    for candidate in available:
        if not any(candidate.overlaps(taken) for taken in reserved):
            return candidate
    return None


def _number_hosts(
    topology: Topology,
    domain: str,
    subnet: IPNetwork,
    overwrite: bool,
    planned: bool,
    result: AllocationResult,
) -> None:
    """Give every interface on ``domain`` an address inside ``subnet``.

    ``planned`` means the user stated ``subnet`` for this domain, so an
    address outside it is replaced rather than kept.
    """
    taken = set()
    if not overwrite:
        for _, _, address in _members(topology, domain):
            parsed = _parse_interface(address) if address else None
            if parsed is not None and parsed.ip in subnet:
                taken.add(parsed.ip)

    hosts = subnet.hosts()

    for node in topology.nodes:
        for iface in node.interfaces:
            if iface.collision_domain != domain:
                continue
            if iface.ip and not overwrite:
                parsed = _parse_interface(iface.ip)
                inside = parsed is not None and parsed.ip in subnet
                if inside or not planned:
                    continue
                result.replaced[f"{node.name}:{iface.number}"] = iface.ip

            address = next((h for h in hosts if h not in taken), None)
            if address is None:
                # More devices than the subnet can hold; report rather than
                # silently leaving interfaces unaddressed.
                result.skipped.append(f"{node.name} eth{iface.number}")
                continue

            taken.add(address)
            iface.ip = f"{address}/{subnet.prefixlen}"
            result.assigned_addresses[f"{node.name}:{iface.number}"] = iface.ip
