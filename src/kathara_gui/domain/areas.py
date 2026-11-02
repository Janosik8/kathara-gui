"""OSPF areas, read from each router's configuration, as groups of devices.

The OSPF counterpart of :mod:`~kathara_gui.domain.asgroups`. Tidy layout and
the zones button draw a lab the way a lecturer draws OSPF on a whiteboard: the
backbone in the middle, every other area beside it.

**An area belongs to an interface, not to a router.** FRR says so in either of
two ways: ``network 10.0.0.0/16 area 0`` under ``router ospf``, which puts
every interface whose address falls in the prefix in that area, or
``ip ospf area 1`` under ``interface eth1``. So a router's areas are those of
its interfaces, and a border router (ABR) is in several. It is drawn in the
backbone, which is where an ABR has to have an interface.

**Only what the configuration says.** A router with no OSPF configuration, an
empty ``frr.conf``, is in no area: which one it was meant for cannot be known,
and guessing from its neighbours would draw a zone the lab does not have. A
host or a switch never has one, so it takes the area of the segments it sits
on, which the routers' interfaces there define.

Pure: the caller reads the files.
"""

from __future__ import annotations

import ipaddress
import re
from collections import defaultdict
from dataclasses import dataclass, field

from kathara_gui.domain.asgroups import spread
from kathara_gui.domain.model import Interface, Topology

__all__ = ["OspfConfig", "area_edges", "area_groups", "area_label", "ospf_areas_from_config"]

_NETWORK = re.compile(r"^\s*network\s+(\S+)\s+area\s+(\S+)", re.MULTILINE)
_INTERFACE = re.compile(r"^\s*interface\s+(\S+)")
_IP_OSPF_AREA = re.compile(r"^\s*ip\s+ospf\s+area\s+(\S+)")


@dataclass
class OspfConfig:
    """The area statements of one router's configuration."""

    #: ``network P area A``: every interface whose address is in P is in A.
    networks: list[tuple[ipaddress.IPv4Network, int]] = field(default_factory=list)
    #: ``ip ospf area A`` under ``interface ethN``, by interface name.
    interfaces: dict[str, int] = field(default_factory=dict)

    def __bool__(self) -> bool:
        return bool(self.networks or self.interfaces)

    def area_of(self, interface: Interface) -> int | None:
        """The area ``interface`` is in, if the configuration puts it in one."""
        if interface.name in self.interfaces:
            return self.interfaces[interface.name]
        if not interface.ip:
            return None
        address = ipaddress.ip_interface(interface.ip).ip
        # The longest prefix that holds the address, as FRR itself matches.
        matching = [(net, area) for net, area in self.networks if address in net]
        if not matching:
            return None
        return max(matching, key=lambda pair: pair[0].prefixlen)[1]


def _area(text: str) -> int | None:
    """An area as a number: ``0``, ``0.0.0.0`` and ``1.1.1.1`` are all accepted."""
    try:
        return int(text) if text.isdigit() else int(ipaddress.IPv4Address(text))
    except ValueError:
        return None


def area_label(area: int) -> str:
    """How an area is written: ``0`` and ``1`` plainly, ``1.1.1.1`` dotted."""
    return str(area) if area < 65536 else str(ipaddress.IPv4Address(area))


def ospf_areas_from_config(text: str) -> OspfConfig:
    """The area statements in an FRR or Quagga configuration."""
    config = OspfConfig()
    for prefix, area_text in _NETWORK.findall(text):
        area = _area(area_text)
        try:
            network = ipaddress.IPv4Network(prefix, strict=False)
        except ValueError:
            continue
        if area is not None:
            config.networks.append((network, area))

    current: str | None = None
    for line in text.splitlines():
        if match := _INTERFACE.match(line):
            current = match.group(1)
        elif (match := _IP_OSPF_AREA.match(line)) and current:
            area = _area(match.group(1))
            if area is not None:
                config.interfaces[current] = area
    return config


@dataclass
class _Interfaces:
    """Which areas each configured router's interfaces, and each segment, are in."""

    routers: dict[str, set[int]]
    segments: dict[str, set[int]]
    #: Routers whose configuration puts no interface in an area.
    unknown: set[str]


def _interfaces(topology: Topology, configs: dict[str, str]) -> _Interfaces:
    segment_areas: dict[str, set[int]] = defaultdict(set)
    router_areas: dict[str, set[int]] = {}
    unknown: set[str] = set()
    for node in topology.nodes:
        config = ospf_areas_from_config(configs.get(node.name, ""))
        if not config:
            if node.kind == "router":
                unknown.add(node.name)
            continue
        found: set[int] = set()
        for interface in node.interfaces:
            area = config.area_of(interface)
            if area is not None:
                found.add(area)
                segment_areas[interface.collision_domain].add(area)
        router_areas[node.name] = found
        if not found:
            unknown.add(node.name)
    return _Interfaces(router_areas, dict(segment_areas), unknown)


@dataclass
class _Interfaces:
    """Which areas each configured router's interfaces, and each segment, are in."""

    routers: dict[str, set[int]]
    segments: dict[str, set[int]]
    #: Routers whose configuration puts no interface in an area.
    unknown: set[str]


def _interfaces(topology: Topology, configs: dict[str, str]) -> _Interfaces:
    segment_areas: dict[str, set[int]] = defaultdict(set)
    router_areas: dict[str, set[int]] = {}
    unknown: set[str] = set()
    for node in topology.nodes:
        config = ospf_areas_from_config(configs.get(node.name, ""))
        if not config:
            if node.kind == "router":
                unknown.add(node.name)
            continue
        found: set[int] = set()
        for interface in node.interfaces:
            area = config.area_of(interface)
            if area is not None:
                found.add(area)
                segment_areas[interface.collision_domain].add(area)
        router_areas[node.name] = found
        if not found:
            unknown.add(node.name)
    return _Interfaces(router_areas, dict(segment_areas), unknown)


def area_groups(topology: Topology, configs: dict[str, str]) -> dict[int, list[str]]:
    """Each area's devices, by area number; a device in no area is left out.

    ``configs`` is each device's routing configuration, by name.
    """
    found = _interfaces(topology, configs)
    router_areas, unknown = found.routers, found.unknown

    areas: dict[str, set[int]] = {name: areas for name, areas in router_areas.items() if areas}
    for node in topology.nodes:
        if node.name in router_areas or node.name in unknown:
            continue
        segments = (found.segments.get(i.collision_domain, set()) for i in node.interfaces)
        around = set().union(*segments)
        if around:
            areas[node.name] = around

    # A border router is drawn in the backbone, where it must have an interface.
    member = {name: 0 if 0 in areas else min(areas) for name, areas in areas.items()}
    # Hosts behind a switch: further from any router, through hosts and
    # switches only, never through a router whose area is unknown.
    member = spread(topology, member, eligible=lambda name: name not in unknown | set(router_areas))

    groups: dict[int, list[str]] = defaultdict(list)
    for node in topology.nodes:
        if node.name in member:
            groups[member[node.name]].append(node.name)
    return dict(sorted(groups.items()))


def area_edges(
    topology: Topology, configs: dict[str, str]
) -> dict[int, tuple[list[str], list[str]]]:
    """Each area's border routers and segments, by area number.

    A border router has interfaces in this area and another, so the zone drawn
    for the area runs through it rather than round it: each of its interfaces
    then lies in the zone of its own area.
    """
    found = _interfaces(topology, configs)
    edges: dict[int, tuple[list[str], list[str]]] = defaultdict(lambda: ([], []))
    for node in topology.nodes:
        areas = found.routers.get(node.name, set())
        if len(areas) >= 2:
            for area in sorted(areas):
                edges[area][0].append(node.name)
    for domain in topology.referenced_collision_domains():
        for area in sorted(found.segments.get(domain, set())):
            edges[area][1].append(domain)
    return dict(edges)
