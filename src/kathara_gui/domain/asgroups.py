"""Autonomous systems drawn as separate clusters, each in its own zone (9B.2).

Capability 9's second scenario: a student opens a BGP lab from a public
repository "to visualize it to understand it better", and the application
organises "the distinct Autonomous Systems into separate visual clusters". A
lab from elsewhere has no coordinates, so it is laid out anyway
(:mod:`~kathara_gui.domain.layout`); this decides *what* is laid out together,
and :mod:`~kathara_gui.domain.clusters` lays it out.

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
from collections.abc import Callable

from kathara_gui.domain.model import Topology

__all__ = ["asn_from_config", "as_groups", "spread"]

_ROUTER_BGP = re.compile(r"^\s*router\s+bgp\s+(\d+)\b", re.MULTILINE)


def asn_from_config(text: str) -> int | None:
    """The AS a router's FRR or Quagga configuration puts it in, if any."""
    match = _ROUTER_BGP.search(text)
    return int(match.group(1)) if match else None


def as_groups(topology: Topology, asns: dict[str, int]) -> dict[int, list[str]]:
    """Each AS's devices: the routers that declare it, and what hangs off them.

    Repeated until nothing changes, so a host behind a switch behind a router
    joins the router's AS, not only the switch.
    """
    member = spread(
        topology, {name: asn for name, asn in asns.items() if topology.node(name)}
    )

    groups: dict[int, list[str]] = defaultdict(list)
    for node in topology.nodes:
        if node.name in member:
            groups[member[node.name]].append(node.name)
    return dict(sorted(groups.items()))


def spread[K](
    topology: Topology,
    member: dict[str, K],
    eligible: Callable[[str], bool] = lambda name: True,
) -> dict[str, K]:
    """``member`` extended to the devices wired only to one group.

    A device joins when every neighbour that has a group has the same one.
    Repeated until nothing changes, so a host behind a switch behind a router
    joins the router's group, not only the switch. A device ``eligible``
    refuses is never added, and nothing spreads through it.
    """
    member = dict(member)
    neighbours: dict[str, set[str]] = defaultdict(set)
    for domain in topology.referenced_collision_domains():
        names = [node.name for node, _ in topology.members(domain)]
        for name in names:
            neighbours[name].update(n for n in names if n != name)

    changed = True
    while changed:
        changed = False
        for node in topology.nodes:
            if node.name in member or not eligible(node.name):
                continue
            around = {member[n] for n in neighbours[node.name] if n in member}
            if len(around) == 1:
                member[node.name] = around.pop()
                changed = True
    return member
