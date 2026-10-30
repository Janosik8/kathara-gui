"""Autonomous systems drawn as separate clusters, each in its own zone (9B.2).

Capability 9's second scenario: a student opens a BGP lab from a public
repository "to visualize it to understand it better", and the application
organises "the distinct Autonomous Systems into separate visual clusters". A
lab from elsewhere has no coordinates, so it is laid out anyway
(:mod:`~kathara_gui.domain.layout`); this decides *what* is laid out together.

**Where the AS number comes from.** Each router's ``router bgp <ASN>``, read
from its FRR or Quagga configuration by the caller. A router with no BGP
configuration, and every host and switch, joins the AS of the routers it is
wired to, when they all agree; one that sits between two systems belongs to
neither and is drawn outside both, which is where it is in the network.

Pure: the caller reads the files and applies the result.
"""

from __future__ import annotations

import re
from collections import defaultdict

from kathara_gui.domain.layout import SPACING, arrange
from kathara_gui.domain.model import Position, Topology, Zone

__all__ = ["asn_from_config", "as_groups", "clustered_layout"]

_ROUTER_BGP = re.compile(r"^\s*router\s+bgp\s+(\d+)\b", re.MULTILINE)

#: Room between a zone's edge and the devices inside it, for their labels.
_PADDING = {"x": 70, "y": 60}
#: About how much a device occupies from its position, which is its top-left
#: corner: the picture, its name and a loopback under it.
_DEVICE = {"x": 90, "y": 90}
#: Room between two clusters, so their zones do not touch.
_GAP = SPACING["x"]


def asn_from_config(text: str) -> int | None:
    """The AS a router's FRR or Quagga configuration puts it in, if any."""
    match = _ROUTER_BGP.search(text)
    return int(match.group(1)) if match else None


def as_groups(topology: Topology, asns: dict[str, int]) -> dict[int, list[str]]:
    """Each AS's devices: the routers that declare it, and what hangs off them.

    Repeated until nothing changes, so a host behind a switch behind a router
    joins the router's AS, not only the switch.
    """
    member: dict[str, int] = {name: asn for name, asn in asns.items() if topology.node(name)}
    neighbours: dict[str, set[str]] = defaultdict(set)
    for domain in topology.referenced_collision_domains():
        names = [node.name for node, _ in topology.members(domain)]
        for name in names:
            neighbours[name].update(n for n in names if n != name)

    changed = True
    while changed:
        changed = False
        for node in topology.nodes:
            if node.name in member:
                continue
            around = {member[n] for n in neighbours[node.name] if n in member}
            if len(around) == 1:
                member[node.name] = around.pop()
                changed = True

    groups: dict[int, list[str]] = defaultdict(list)
    for node in topology.nodes:
        if node.name in member:
            groups[member[node.name]].append(node.name)
    return dict(sorted(groups.items()))


def clustered_layout(
    topology: Topology, groups: dict[int, list[str]]
) -> tuple[dict[str, Position], list[Zone]]:
    """Positions with each AS laid out on its own, side by side, and a zone round each.

    Devices in no AS are laid out last, as one more cluster without a zone.
    """
    clusters: list[tuple[int | None, list[str]]] = list(groups.items())
    grouped = {name for names in groups.values() for name in names}
    rest = [node.name for node in topology.nodes if node.name not in grouped]
    if rest:
        clusters.append((None, rest))

    positions: dict[str, Position] = {}
    zones: list[Zone] = []
    origin_x = 0.0
    for asn, names in clusters:
        inside = set(names)
        part = topology.model_copy(
            update={"nodes": [n for n in topology.nodes if n.name in inside]}
        )
        local = arrange(part)
        if not local:
            continue
        left = min(p.x for p in local.values())
        right = max(p.x for p in local.values())
        top = min(p.y for p in local.values())
        bottom = max(p.y for p in local.values())

        shift = origin_x + _PADDING["x"] - left
        for name, p in local.items():
            positions[name] = Position(x=p.x + shift, y=p.y - top + _PADDING["y"])
        if asn is not None:
            zones.append(
                Zone(
                    id=f"as{asn}",
                    name=f"AS {asn}",
                    shape="rectangle",
                    position=Position(x=origin_x, y=0.0),
                    width=right - left + _DEVICE["x"] + 2 * _PADDING["x"],
                    height=bottom - top + _DEVICE["y"] + 2 * _PADDING["y"],
                )
            )
        origin_x += right - left + _DEVICE["x"] + 2 * _PADDING["x"] + _GAP
    return positions, zones
