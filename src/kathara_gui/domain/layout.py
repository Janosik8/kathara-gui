"""Arranging a topology that arrives without a layout.

A lab written by hand, or by another tool, carries no coordinates: every device
lands at the same point and the diagram is unreadable until the user drags them
apart one by one. Positions of our own ride in ``# kgui:`` comments, so this is
needed exactly when a scenario comes from outside — which is the case the
import path exists for.

**Why layering rather than a force-directed spring model.** A spring layout is
a few lines and looks organic, but it optimises for even edge lengths and does
nothing about crossings, which is what makes a network diagram hard to read. It
is also iterative and unstable: the same lab laid out twice looks different,
which is unsettling when you reopen your own work. This is the middle of the
classical Sugiyama method instead — layer by distance from a root, then order
within each layer by the barycentre of each vertex's neighbours — which
attacks crossings directly and is deterministic.

**Collision domains are vertices too.** A segment shared by three or more
devices is drawn as its own node on the canvas, so laying out only the devices
would arrange one graph and draw another.

Pure: no I/O, no rendering, no knowledge of pixels beyond the spacing
constants. That keeps the whole thing testable by counting crossings.
"""

from __future__ import annotations

from collections import defaultdict, deque

from kathara_gui.domain.model import Position, Topology

__all__ = [
    "SPACING",
    "arrange",
    "needs_layout",
    "count_crossings",
]

#: Distance between neighbouring devices, in canvas units.
#:
#: Generous on purpose. A device is drawn with its interface labels *outside*
#: the box and an address beside each one, so the readable width of a device is
#: far greater than the box itself — the reported complaint about distribution
#: was exactly this. Columns are wider than rows because the labels extend
#: sideways.
SPACING = {"x": 260, "y": 170}

#: Barycentre ordering converges quickly; more passes buy almost nothing.
_ORDERING_PASSES = 4


def needs_layout(topology: Topology) -> bool:
    """Whether the topology has no usable layout of its own.

    True when every device sits at the same point, which is what an import
    without coordinates produces — and, incidentally, what a brand-new empty
    scenario has, where the answer does not matter.
    """
    positions = {(node.position.x, node.position.y) for node in topology.nodes}
    return len(positions) <= 1 and len(topology.nodes) > 1


def _graph(topology: Topology) -> tuple[dict[str, set[str]], set[str]]:
    """Adjacency of the graph as it is *drawn*, and which vertices are domains.

    A collision domain joining two devices is drawn as a direct line between
    them; one joining three or more is drawn as its own node with a spoke to
    each device. Both are reproduced here so the layout matches the picture.
    """
    members: dict[str, list[str]] = defaultdict(list)
    for node in topology.nodes:
        for interface in node.interfaces:
            members[interface.collision_domain].append(node.name)

    adjacency: dict[str, set[str]] = {node.name: set() for node in topology.nodes}
    domains: set[str] = set()

    for domain, attached in members.items():
        unique = sorted(set(attached))
        if len(unique) == 2:
            first, second = unique
            adjacency[first].add(second)
            adjacency[second].add(first)
        elif len(unique) > 2:
            key = f"\x00cd:{domain}"  # cannot collide with a device name
            domains.add(key)
            adjacency[key] = set(unique)
            for name in unique:
                adjacency[name].add(key)

    return adjacency, domains


def _components(adjacency: dict[str, set[str]]) -> list[list[str]]:
    """Connected groups, largest first, each in a stable order."""
    seen: set[str] = set()
    found: list[list[str]] = []

    for start in sorted(adjacency):
        if start in seen:
            continue
        group: list[str] = []
        queue = deque([start])
        seen.add(start)
        while queue:
            current = queue.popleft()
            group.append(current)
            for neighbour in sorted(adjacency[current]):
                if neighbour not in seen:
                    seen.add(neighbour)
                    queue.append(neighbour)
        found.append(group)

    return sorted(found, key=lambda g: (-len(g), g[0]))


def _distances(adjacency: dict[str, set[str]], start: str) -> dict[str, int]:
    depth = {start: 0}
    queue = deque([start])
    while queue:
        current = queue.popleft()
        for neighbour in sorted(adjacency[current]):
            if neighbour not in depth:
                depth[neighbour] = depth[current] + 1
                queue.append(neighbour)
    return depth


def _root(adjacency: dict[str, set[str]], group: list[str]) -> str:
    """The vertex to layer from: the graph's centre.

    Rooting at the *most connected* vertex is the obvious choice and the wrong
    one. In a two-tier campus lab the distribution switches outrank the core
    router on degree, because each carries several hosts, so the layout hangs
    the whole network off a middle layer and the core ends up in row two.

    The centre — the vertex whose furthest neighbour is nearest — is what
    matches intuition: it is the backbone router in a campus, the hub in a
    star, and any vertex in a ring. Degree breaks the tie, then the name, so
    the same lab always lays out the same way.
    """
    scored = [
        (max(_distances(adjacency, name).values()), -len(adjacency[name]), name)
        for name in group
    ]
    return min(scored)[2]


def _layers(adjacency: dict[str, set[str]], group: list[str]) -> list[list[str]]:
    """Breadth-first layers, rooted at the graph's centre."""
    root = _root(adjacency, group)

    depth = {root: 0}
    queue = deque([root])
    while queue:
        current = queue.popleft()
        for neighbour in sorted(adjacency[current]):
            if neighbour not in depth:
                depth[neighbour] = depth[current] + 1
                queue.append(neighbour)

    layered: dict[int, list[str]] = defaultdict(list)
    for name in group:
        layered[depth.get(name, 0)].append(name)
    return [sorted(layered[level]) for level in sorted(layered)]


def _layer_crossings(
    adjacency: dict[str, set[str]], upper: list[str], lower: list[str]
) -> int:
    """Crossings between two adjacent layers, by counting inverted pairs.

    Two links cross exactly when their endpoints appear in opposite order in
    the two layers, which is cheaper and more exact than measuring geometry.
    """
    rank_upper = {name: i for i, name in enumerate(upper)}
    rank_lower = {name: i for i, name in enumerate(lower)}

    edges = [
        (rank_upper[a], rank_lower[b])
        for a in upper
        for b in adjacency[a]
        if b in rank_lower
    ]

    crossings = 0
    for i, (a1, b1) in enumerate(edges):
        for a2, b2 in edges[i + 1 :]:
            if (a1 - a2) * (b1 - b2) < 0:
                crossings += 1
    return crossings


def _total_crossings(adjacency: dict[str, set[str]], ordered: list[list[str]]) -> int:
    return sum(
        _layer_crossings(adjacency, ordered[i], ordered[i + 1])
        for i in range(len(ordered) - 1)
    )


def _order(adjacency: dict[str, set[str]], layers: list[list[str]]) -> list[list[str]]:
    """Reduce crossings by repeated barycentre ordering.

    Each vertex moves to the average position of its neighbours in the
    neighbouring layer, sweeping down and then up. Ties keep their previous
    position, so the result is deterministic.

    **The best pass is kept, not the last one.** Barycentre ordering is known
    to oscillate rather than converge, and measuring showed it: on a dense
    twelve-node graph the final sweep left *more* crossings than the plain
    breadth-first order it started from. Scoring each pass and returning the
    best makes the method safe — it can now only improve on where it began.
    """
    ordered = [list(layer) for layer in layers]
    best, best_score = [list(layer) for layer in ordered], _total_crossings(adjacency, ordered)

    def sweep(index: int, reference: int) -> None:
        positions = {name: i for i, name in enumerate(ordered[reference])}
        current = {name: i for i, name in enumerate(ordered[index])}

        def barycentre(name: str) -> tuple[float, int]:
            neighbours = [positions[n] for n in adjacency[name] if n in positions]
            if not neighbours:
                # Nothing to be pulled towards: stay put rather than drift to
                # the left edge, which would shuffle unrelated vertices.
                return (current[name], current[name])
            return (sum(neighbours) / len(neighbours), current[name])

        ordered[index] = sorted(ordered[index], key=barycentre)

    for _ in range(_ORDERING_PASSES):
        for index in range(1, len(ordered)):
            sweep(index, index - 1)
        for index in range(len(ordered) - 2, -1, -1):
            sweep(index, index + 1)

        score = _total_crossings(adjacency, ordered)
        if score < best_score:
            best, best_score = [list(layer) for layer in ordered], score

    return best


def _place(ordered: list[list[str]], origin_x: float, origin_y: float) -> dict[str, Position]:
    """Give each vertex a coordinate, centring every row on the widest one."""
    widest = max((len(layer) for layer in ordered), default=1)
    placed: dict[str, Position] = {}

    for level, layer in enumerate(ordered):
        # Centred, so a small row sits under the middle of a large one rather
        # than hugging the left edge and dragging its links sideways.
        offset = (widest - len(layer)) / 2
        for index, name in enumerate(layer):
            placed[name] = Position(
                x=origin_x + (index + offset) * SPACING["x"],
                y=origin_y + level * SPACING["y"],
            )
    return placed


def arrange(topology: Topology) -> dict[str, Position]:
    """Positions for every device in ``topology``.

    Returns device positions only. Collision-domain nodes are laid out too,
    because they occupy space in the drawing, but the canvas draws a segment
    between the devices around it. A segment can be given a place of its own
    by dragging it; tidying releases it back to that default, so the layout
    computed here is the one drawn.
    """
    if not topology.nodes:
        return {}

    adjacency, domains = _graph(topology)
    devices = {node.name for node in topology.nodes}

    placed: dict[str, Position] = {}
    origin_x = 0.0

    for group in _components(adjacency):
        ordered = _order(adjacency, _layers(adjacency, group))
        positions = _place(ordered, origin_x, 0.0)
        placed.update(positions)

        # Start the next disconnected group clear of this one, with a gap wide
        # enough that they read as separate networks rather than one.
        widest = max((len(layer) for layer in ordered), default=1)
        origin_x += (widest + 1) * SPACING["x"]

    return {name: position for name, position in placed.items() if name in devices}


def count_crossings(topology: Topology, positions: dict[str, Position]) -> int:
    """How many pairs of links cross, for a given layout.

    Exists to make the claim testable. "Fewer crossings" is the whole point of
    choosing layering over a spring model, and an untested layout algorithm is
    an opinion.
    """
    segments: list[tuple[float, float, float, float]] = []
    seen: set[tuple[str, str]] = set()

    adjacency, _ = _graph(topology)
    centres: dict[str, Position] = dict(positions)

    # A domain vertex has no stored position; place it at the mean of its
    # members, which is where the canvas draws it.
    for name, neighbours in adjacency.items():
        if name in centres:
            continue
        known = [centres[n] for n in neighbours if n in centres]
        if known:
            centres[name] = Position(
                x=sum(p.x for p in known) / len(known),
                y=sum(p.y for p in known) / len(known),
            )

    for name, neighbours in adjacency.items():
        for neighbour in neighbours:
            key = tuple(sorted((name, neighbour)))
            if key in seen or name not in centres or neighbour not in centres:
                continue
            seen.add(key)  # type: ignore[arg-type]
            a, b = centres[name], centres[neighbour]
            segments.append((a.x, a.y, b.x, b.y))

    def orientation(ax: float, ay: float, bx: float, by: float, cx: float, cy: float) -> int:
        value = (by - ay) * (cx - bx) - (bx - ax) * (cy - by)
        return (value > 1e-9) - (value < -1e-9)

    crossings = 0
    for i, (ax, ay, bx, by) in enumerate(segments):
        for cx, cy, dx, dy in segments[i + 1 :]:
            # Links sharing an endpoint meet there by design; that is not a
            # crossing.
            if len({(ax, ay), (bx, by)} & {(cx, cy), (dx, dy)}):
                continue
            d1 = orientation(ax, ay, bx, by, cx, cy)
            d2 = orientation(ax, ay, bx, by, dx, dy)
            d3 = orientation(cx, cy, dx, dy, ax, ay)
            d4 = orientation(cx, cy, dx, dy, bx, by)
            if d1 != d2 and d3 != d4:
                crossings += 1

    return crossings
