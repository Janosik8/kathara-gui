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

    @property
    def changed(self) -> bool:
        return bool(self.assigned_subnets or self.assigned_addresses)


def _parse_interface(value: str) -> IPInterface | None:
    try:
        return ipaddress.ip_interface(value)
    except ValueError:
        return None


# ---------------------------------------------------------------- validation


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
    """Two collision domains planned onto overlapping address space."""
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
                        Severity.ERROR,
                        "overlapping_subnets",
                        f"Collision domains {name} ({network}) and {other_name} ({other}) "
                        "have overlapping address space.",
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


# ---------------------------------------------------------------- allocation


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

    By default anything already set is left alone, so a partly hand-addressed
    design can be completed rather than replaced. ``overwrite=True`` starts
    afresh, which is what "renumber the whole lab" means.
    """
    network = ipaddress.ip_network(pool, strict=False)
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

        if entry.subnet and not overwrite:
            chosen = ipaddress.ip_network(entry.subnet, strict=False)
        else:
            chosen = _next_free(available, reserved)
            if chosen is None:
                result.skipped.append(domain)
                continue
            reserved.add(chosen)
            entry.subnet = str(chosen)
            result.assigned_subnets[domain] = str(chosen)

        _number_hosts(working, domain, chosen, overwrite, result)

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
    result: AllocationResult,
) -> None:
    """Give every interface on ``domain`` an address inside ``subnet``."""
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
                continue

            address = next((h for h in hosts if h not in taken), None)
            if address is None:
                # More devices than the subnet can hold; report rather than
                # silently leaving interfaces unaddressed.
                result.skipped.append(f"{node.name} eth{iface.number}")
                continue

            taken.add(address)
            iface.ip = f"{address}/{subnet.prefixlen}"
            result.assigned_addresses[f"{node.name}:{iface.number}"] = iface.ip
