"""Laying a lab out by autonomous system and OSPF area, and zones round each.

Two uses. **Tidy layout**, and an import with no coordinates, move the devices:
each AS side by side, and inside a lab, or an AS, with several OSPF areas, the
backbone in the middle and every other area above or below it, beside the
border routers that join it to the backbone. **The zones button** moves
nothing, and draws a zone round each group where its devices already stand.

Which devices are in which group is decided by
:mod:`~kathara_gui.domain.asgroups` and :mod:`~kathara_gui.domain.areas`;
this module only places them. Pure: the caller reads the configuration files.
"""

from __future__ import annotations

import itertools
from collections import defaultdict
from dataclasses import dataclass, field

from kathara_gui.domain.areas import area_edges, area_groups, area_label
from kathara_gui.domain.asgroups import as_groups, asn_from_config
from kathara_gui.domain.layout import SPACING, arrange
from kathara_gui.domain.model import Position, Topology, Zone

__all__ = ["Group", "clustered_layout", "routing_groups", "zones_around"]

#: Room between a zone's edge and the devices inside it, for their labels.
#: The same as ``canvas/zones.ts``, so these zones look like one drawn by hand.
_PADDING = {"x": 70, "y": 60}
#: About how much a device occupies from its position, which is its top-left
#: corner: the picture, its name and a loopback under it.
_DEVICE = {"x": 90, "y": 90}
#: Room between two autonomous systems side by side, so their zones do not touch.
_GAP = SPACING["x"]
#: Room between the backbone and an area beside it: less than between
#: systems, because a link crosses it, from a border router to its area.
_AREA_GAP = 80
#: An AS zone drawn round devices already placed: more room than an area's,
#: so it encloses the area zones inside it with its name clear of theirs.
_NEST = {"x": 30, "y": 40}
#: Where a border router's edge of a zone runs, from its position: through
#: the middle of its picture, so it stands half in one area and half in the next.
_CENTRE = {"x": 36, "y": 26}
#: Room round a segment's pill and its name, inside its area's zone.
_SEGMENT = 30
#: How far a segment with one device left on it is drawn from that device,
#: and in which directions: ``STUB_DISTANCE`` and ``STUB_DIRECTIONS`` in
#: ``canvas/layout.ts``, so the zone holds the segment where it is drawn.
_STUB_DISTANCE = 150
_STUB_DIRECTIONS = ((1, 0), (0, 1), (-1, 0), (0, -1), (1, 0.6), (-1, 0.6), (-1, -0.6), (1, -0.6))


@dataclass
class Group:
    """An autonomous system or an OSPF area, and the devices drawn in it."""

    id: str
    name: str
    members: list[str]
    #: The OSPF number of an area, which picks the backbone; None for an AS.
    area: int | None = None
    #: The areas inside an AS.
    inner: list[Group] = field(default_factory=list)
    #: An area's border routers, which its zone runs through rather than round.
    borders: list[str] = field(default_factory=list)
    #: An area's segments, which its zone holds.
    segments: list[str] = field(default_factory=list)
    #: Every area's border routers and segments, in the lab or the AS this
    #: area is in: which side of the backbone each area goes on.
    edges: dict[int, tuple[list[str], list[str]]] = field(default_factory=dict)


def _areas(
    groups: dict[int, list[str]],
    edges: dict[int, tuple[list[str], list[str]]],
    within: set[str] | None,
) -> list[Group]:
    """One group per area with devices in ``within``; none unless there are two."""
    found = []
    edges = {
        area: ([n for n in borders if within is None or n in within], segments)
        for area, (borders, segments) in edges.items()
    }
    for area, names in groups.items():
        inside = [n for n in names if within is None or n in within]
        if inside:
            label = area_label(area)
            borders, segments = edges.get(area, ([], []))
            found.append(
                Group(
                    id=f"area{label.replace('.', '-')}",
                    name=f"Area {label}",
                    members=inside,
                    area=area,
                    borders=borders,
                    segments=segments,
                    edges=edges,
                )
            )
    return found if len(found) >= 2 else []


def routing_groups(topology: Topology, configs: dict[str, str]) -> list[Group]:
    """The groups to draw: autonomous systems, with their areas inside, or areas.

    One AS, or one area, is a lab with nothing to separate, so it gives no group.
    ``configs`` is each device's routing configuration, by name.
    """
    asns = {name: asn for name, text in configs.items() if (asn := asn_from_config(text))}
    systems = as_groups(topology, asns)
    areas = area_groups(topology, configs)
    edges = area_edges(topology, configs)
    if len(systems) >= 2:
        return [
            Group(
                id=f"as{asn}",
                name=f"AS {asn}",
                members=names,
                inner=_areas(areas, edges, set(names)),
            )
            for asn, names in systems.items()
        ]
    return _areas(areas, edges, None)


# -- laying out ------------------------------------------------------------------


@dataclass
class _Block:
    """Devices and zones laid out together, from (0, 0) to (width, height)."""

    positions: dict[str, Position]
    zones: list[Zone]
    width: float
    height: float

    def moved(self, dx: float, dy: float) -> _Block:
        return _Block(
            {n: Position(x=p.x + dx, y=p.y + dy) for n, p in self.positions.items()},
            [
                z.model_copy(
                    update={"position": Position(x=z.position.x + dx, y=z.position.y + dy)}
                )
                for z in self.zones
            ],
            self.width,
            self.height,
        )


def _arranged(topology: Topology, names: list[str]) -> _Block | None:
    """``names`` laid out on their own, as if nothing else were in the lab."""
    inside = set(names)
    local = arrange(
        topology.model_copy(update={"nodes": [n for n in topology.nodes if n.name in inside]})
    )
    if not local:
        return None
    # Each box as (left, top, right, bottom): the devices, and a segment with
    # one device on it, which is drawn some way off it.
    boxes = [(p.x, p.y, p.x + _DEVICE["x"], p.y + _DEVICE["y"]) for p in local.values()]
    for node in topology.nodes:
        if node.name not in local:
            continue
        for interface in node.interfaces:
            domain = interface.collision_domain
            if len(topology.members(domain)) == 1:
                x, y = _centre(local[node.name])
                dx, dy = _stub_direction(domain)
                x, y = x + dx * _STUB_DISTANCE, y + dy * _STUB_DISTANCE
                boxes.append((x - _SEGMENT, y - _SEGMENT, x + _SEGMENT, y + _SEGMENT))
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    return _Block(
        {n: Position(x=p.x - left, y=p.y - top) for n, p in local.items()},
        [],
        max(b[2] for b in boxes) - left,
        max(b[3] for b in boxes) - top,
    )


def _group_block(topology: Topology, group: Group) -> _Block | None:
    """A group laid out, its areas inside it if it has any, with its zone round it."""
    if group.inner:
        in_areas = {n for area in group.inner for n in area.members}
        content = _compose(
            topology, group.inner, [n for n in group.members if n not in in_areas]
        )
    else:
        content = _arranged(topology, group.members)
    if content is None:
        return None
    inner = content.moved(_PADDING["x"], _PADDING["y"])
    width = content.width + 2 * _PADDING["x"]
    height = content.height + 2 * _PADDING["y"]
    zone = Zone(id=group.id, name=group.name, width=width, height=height)
    # The outer zone first, so it is drawn behind the areas inside it.
    return _Block(inner.positions, [zone, *inner.zones], width, height)


def _row(blocks: list[_Block], gap: float) -> _Block | None:
    """Blocks side by side, left to right."""
    if not blocks:
        return None
    positions: dict[str, Position] = {}
    zones: list[Zone] = []
    x = 0.0
    for block in blocks:
        placed = block.moved(x, 0)
        positions |= placed.positions
        zones += placed.zones
        x += block.width + gap
    return _Block(positions, zones, x - gap, max(b.height for b in blocks))


def _neighbours(topology: Topology) -> dict[str, set[str]]:
    found: dict[str, set[str]] = defaultdict(set)
    for domain in topology.referenced_collision_domains():
        names = [node.name for node, _ in topology.members(domain)]
        for name in names:
            found[name].update(n for n in names if n != name)
    return found


#: The four sides of the backbone an area can be drawn on, in order of preference:
#: above and below first, as OSPF is drawn on a whiteboard.
_SIDES = ("top", "bottom", "left", "right")
_OPPOSITE = {"top": "bottom", "bottom": "top", "left": "right", "right": "left"}
#: More areas than this round one backbone are given sides in turn, not searched.
_SEARCHED = 6


def _sides(faces: dict[str, list[int]], areas: list[int]) -> dict[int, str]:
    """Which side of the backbone each area is drawn on.

    A border router stands on the side facing its other area, or on the corner
    between two sides when it joins two areas. So two of its areas must not be
    given opposite sides, nor three different ones; within that, the areas are
    spread over the sides, above and below first.
    """
    if len(areas) > _SEARCHED:
        return {area: _SIDES[i % 2] for i, area in enumerate(areas)}
    best: dict[int, str] = {}
    best_cost = float("inf")
    for choice in itertools.product(_SIDES, repeat=len(areas)):
        side = dict(zip(areas, choice, strict=True))
        cost = 0
        for found in faces.values():
            used = {side[a] for a in found}
            if len(used) > 2 or any(_OPPOSITE[s] in used for s in used):
                cost += 100
        cost += sum(choice.count(s) ** 2 for s in _SIDES)
        cost += sum(1 for s in choice if s in ("left", "right"))
        if cost < best_cost:
            best, best_cost = side, cost
    return best


def _spot(sides: list[str]) -> tuple[str | None, str | None]:
    """Where on the backbone a border router stands: (top or bottom, left or right).

    Both for a corner, one for a side.
    """
    vertical = next((s for s in sides if s in ("top", "bottom")), None)
    horizontal = next((s for s in sides if s in ("left", "right")), None)
    return vertical, horizontal


def _backbone_block(
    topology: Topology,
    members: list[str],
    spots: dict[str, tuple[str | None, str | None]],
    min_width: float = 0,
    min_height: float = 0,
) -> _Block:
    """The backbone as a rectangle: border routers on its sides and corners.

    Each border router stands on the side facing its other area, so the border
    routers of one area are in a line, and the area's zone meets the
    backbone's along it. A router joining two other areas stands on the
    corner between their sides. The rest of the backbone is in the middle.
    """
    corners: dict[tuple[str, str], str] = {}
    on_side: dict[str, list[str]] = defaultdict(list)
    for name in members:
        if name not in spots:
            continue
        vertical, horizontal = spots[name]
        if vertical and horizontal and (vertical, horizontal) not in corners:
            corners[(vertical, horizontal)] = name
        else:
            on_side[vertical or horizontal or "top"].append(name)
    interior = [n for n in members if n not in spots]
    inner = _arranged(topology, interior) if interior else None

    across = max(len(on_side["top"]), len(on_side["bottom"]))
    down = max(len(on_side["left"]), len(on_side["right"]))
    width = max(
        (across + 1) * SPACING["x"], inner.width + SPACING["x"] if inner else 0, min_width
    )
    height = max(
        (down + 1) * SPACING["y"], inner.height + SPACING["y"] if inner else 0, min_height
    )

    positions: dict[str, Position] = {}
    edge = {"top": 0.0, "bottom": height, "left": 0.0, "right": width}
    for (vertical, horizontal), name in corners.items():
        positions[name] = Position(x=edge[horizontal], y=edge[vertical])
    for side, names in on_side.items():
        for i, name in enumerate(names):
            if side in ("top", "bottom"):
                at = Position(x=width * (i + 1) / (len(names) + 1), y=edge[side])
            else:
                at = Position(x=edge[side], y=height * (i + 1) / (len(names) + 1))
            positions[name] = at
    if inner is not None:
        dx = (width + _DEVICE["x"] - inner.width) / 2
        dy = (height + _DEVICE["y"] - inner.height) / 2
        positions |= inner.moved(dx, dy).positions
    return _Block(positions, [], width + _DEVICE["x"], height + _DEVICE["y"])


def _framed(topology: Topology, names: list[str], group: Group | None) -> _Block | None:
    """``names`` laid out with room round them, and the group's zone if any."""
    content = _arranged(topology, names)
    if content is None:
        return None
    inner = content.moved(_PADDING["x"], _PADDING["y"])
    width = content.width + 2 * _PADDING["x"]
    height = content.height + 2 * _PADDING["y"]
    zones = [Zone(id=group.id, name=group.name, width=width, height=height)] if group else []
    return _Block(inner.positions, zones, width, height)


def _around_backbone(topology: Topology, groups: list[Group], rest: list[str]) -> _Block:
    """Areas round the backbone, each on the side its border routers face.

    The backbone is area 0, or the largest area if there is none. Devices in
    no area, such as a router whose configuration is empty, go with the area
    of the segments they are on, without a zone of their own: beside what they
    are wired to, not apart from it.
    """
    backbone_group = next(
        (g for g in groups if g.area == 0), max(groups, key=lambda g: len(g.members))
    )
    edges = backbone_group.edges
    neighbours = _neighbours(topology)
    faces = {
        name: found
        for name in backbone_group.members
        if (
            found := sorted(
                a for a, (borders, _) in edges.items()
                if a != backbone_group.area and name in borders
            )
        )
    }  # fmt: skip
    side = _sides(faces, sorted({a for found in faces.values() for a in found}))
    spots = {name: _spot([side[a] for a in found]) for name, found in faces.items()}

    # What each area beside the backbone holds: its own devices, and those in
    # no area that sit on its segments or are wired to its devices.
    others = {g.area: g for g in groups if g is not backbone_group}
    content: dict[int, list[str]] = {area: list(g.members) for area, g in others.items()}  # type: ignore[misc]
    segment_area: dict[str, int] = {}
    for area, (_, segments) in sorted(edges.items(), reverse=True):
        if area != backbone_group.area:
            segment_area |= dict.fromkeys(segments, area)
    member_area = {n: area for area, names in content.items() for n in names}
    unplaced: list[list[str]] = []
    for names in _connected(rest, neighbours):
        candidates = {
            segment_area[i.collision_domain]
            for node in topology.nodes
            if node.name in names
            for i in node.interfaces
            if i.collision_domain in segment_area
        }
        wired = {n for name in names for n in neighbours[name]}
        candidates |= {member_area[n] for n in wired if n in member_area}
        if candidates:
            content.setdefault(min(candidates), []).extend(names)
        else:
            unplaced.append(names)

    pending: list[tuple[_Block, list[str], str | None]] = []
    for area, names in content.items():
        if (block := _framed(topology, names, others.get(area))) is not None:
            anchors = [n for n, found in faces.items() if area in found]
            pending.append((block, anchors, side.get(area)))
    for names in unplaced:
        if (block := _framed(topology, names, None)) is not None:
            anchors = [n for n in backbone_group.members if neighbours[n] & set(names)]
            where = next((s for n in anchors for s in spots.get(n, ()) if s), "bottom")
            pending.append((block, anchors, where))

    # An area between two corners has to fit between them: the backbone is
    # made long enough for it.
    width = height = 0.0
    for block, anchors, where in pending:
        corners = {s for n in anchors for s in spots.get(n, ()) if s}
        if where in ("left", "right") and {"top", "bottom"} <= corners:
            height = max(height, block.height)
        if where in ("top", "bottom") and {"left", "right"} <= corners:
            width = max(width, block.width)
    backbone = _backbone_block(topology, backbone_group.members, spots, width, height)

    beside: dict[str, list[tuple[float, _Block]]] = defaultdict(list)
    loose: list[_Block] = []

    def place(block: _Block, anchors: list[str], where: str | None) -> None:
        if not anchors or where is None:
            loose.append(block)
            return
        centres = [_centre(backbone.positions[n]) for n in anchors]
        xs, ys = [c[0] for c in centres], [c[1] for c in centres]
        if where in ("top", "bottom"):
            beside[where].append((sum(xs) / len(xs) - block.width / 2, block))
            return
        # Beside a corner, below or above the line its router stands on, so it
        # stays clear of the area drawn on that side.
        spot_vertical = {spots[n][0] for n in anchors}
        if "top" in spot_vertical:
            y = min(ys)
        elif "bottom" in spot_vertical:
            y = max(ys) - block.height
        else:
            y = sum(ys) / len(ys) - block.height / 2
        beside[where].append((y, block))

    for block, anchors, where in pending:
        place(block, anchors, where)

    out: list[_Block] = [backbone]
    top = min(_centre(p)[1] for p in backbone.positions.values())
    bottom = max(_centre(p)[1] for p in backbone.positions.values())
    left = min(_centre(p)[0] for p in backbone.positions.values())
    right = max(_centre(p)[0] for p in backbone.positions.values())
    for where, row in beside.items():
        edge = float("-inf")
        for at, block in sorted(row, key=lambda ab: ab[0]):
            # Swept along the side, so that no two areas on it overlap.
            at = max(at, edge + _AREA_GAP)
            if where == "top":
                out.append(block.moved(at, top - _AREA_GAP - block.height))
            elif where == "bottom":
                out.append(block.moved(at, bottom + _AREA_GAP))
            elif where == "left":
                out.append(block.moved(left - _AREA_GAP - block.width, at))
            else:
                out.append(block.moved(right + _AREA_GAP, at))
            edge = at + (block.width if where in ("top", "bottom") else block.height)

    far = max(_right(b) for b in out)
    for block in loose:
        out.append(block.moved(far + _AREA_GAP, 0))
        far += _AREA_GAP + block.width
    return _normalised(out)


def _connected(names: list[str], neighbours: dict[str, set[str]]) -> list[list[str]]:
    """``names`` in groups wired to each other, each in the lab's order."""
    left = list(names)
    found: list[list[str]] = []
    while left:
        group = {left[0]}
        frontier = [left[0]]
        while frontier:
            for n in neighbours[frontier.pop()]:
                if n in left and n not in group:
                    group.add(n)
                    frontier.append(n)
        found.append([n for n in left if n in group])
        left = [n for n in left if n not in group]
    return found


def _right(block: _Block) -> float:
    """How far right a placed block reaches."""
    xs = [z.position.x + z.width for z in block.zones]
    xs += [p.x + _DEVICE["x"] for p in block.positions.values()]
    return max(xs)


def _normalised(blocks: list[_Block]) -> _Block:
    """Placed blocks merged into one, its top-left corner moved to (0, 0)."""
    positions: dict[str, Position] = {}
    zones: list[Zone] = []
    for block in blocks:
        positions |= block.positions
        zones += block.zones
    xs = [z.position.x for z in zones] + [p.x for p in positions.values()]
    ys = [z.position.y for z in zones] + [p.y for p in positions.values()]
    rights = [z.position.x + z.width for z in zones]
    rights += [p.x + _DEVICE["x"] for p in positions.values()]
    bottoms = [z.position.y + z.height for z in zones]
    bottoms += [p.y + _DEVICE["y"] for p in positions.values()]
    left, top = min(xs), min(ys)
    merged = _Block(positions, zones, max(rights) - left, max(bottoms) - top)
    return merged.moved(-left, -top)


def _compose(topology: Topology, groups: list[Group], rest: list[str]) -> _Block | None:
    """Groups laid out together, and the devices in none of them.

    Areas go round the backbone, and so does whatever is in no area; an
    autonomous system goes beside the next, and what is in none to the right.
    """
    if groups and all(g.area is not None for g in groups):
        return _around_backbone(topology, groups, rest)
    placed = [(g, b) for g in groups if (b := _group_block(topology, g)) is not None]
    body = _row([b for _, b in placed], _GAP)
    loose = _arranged(topology, rest) if rest else None
    return _row([b for b in (body, loose) if b is not None], _GAP)


def clustered_layout(
    topology: Topology, groups: list[Group]
) -> tuple[dict[str, Position], list[Zone]]:
    """Positions with each group laid out on its own, and a zone round each.

    The zones are those :func:`zones_around` draws round the devices once placed.
    """
    grouped = {name for group in groups for name in group.members}
    rest = [node.name for node in topology.nodes if node.name not in grouped]
    block = _compose(topology, groups, rest)
    if block is None:
        return {}, []
    # Tidy layout puts a segment moved by hand back between its devices.
    placed = topology.model_copy(
        update={
            "nodes": [
                n.model_copy(update={"position": block.positions.get(n.name, n.position)})
                for n in topology.nodes
            ],
            "collision_domains": [
                cd.model_copy(update={"position": None}) for cd in topology.collision_domains
            ],
        }
    )
    return block.positions, zones_around(placed, groups)


# -- zones round devices where they stand ------------------------------------------


def zones_around(topology: Topology, groups: list[Group]) -> list[Zone]:
    """A zone round each group's devices where they are now; nothing moves.

    An AS with areas inside gets a wider margin, so it encloses their zones.
    An area's zone runs through its border routers, as one is drawn by hand.
    """
    zones: list[Zone] = []
    for group in groups:
        nodes = [n for n in topology.nodes if n.name in set(group.members)]
        if not nodes:
            continue
        if group.area is not None:
            zones.append(_area_zone(topology, group))
            continue
        pad = dict(_PADDING)
        if group.inner:
            pad = {axis: _PADDING[axis] + _NEST[axis] for axis in pad}
        left = min(n.position.x for n in nodes)
        top = min(n.position.y for n in nodes)
        zones.append(
            Zone(
                id=group.id,
                name=group.name,
                position=Position(x=left - pad["x"], y=top - pad["y"]),
                width=max(n.position.x for n in nodes) - left + _DEVICE["x"] + 2 * pad["x"],
                height=max(n.position.y for n in nodes) - top + _DEVICE["y"] + 2 * pad["y"],
            )
        )
        zones += zones_around(topology, group.inner)
    return zones


def _centre(position: Position) -> tuple[float, float]:
    return position.x + _CENTRE["x"], position.y + _CENTRE["y"]


def _stub_direction(name: str) -> tuple[float, float]:
    """``nameIndex`` in ``canvas/layout.ts``: the same name, the same direction."""
    value = 0
    for char in name:
        value = (value * 31 + ord(char)) % 100003
    return _STUB_DIRECTIONS[value % len(_STUB_DIRECTIONS)]


def _segment_centre(topology: Topology, domain: str) -> tuple[float, float] | None:
    """Where a segment is drawn: where the user put it, or between its devices."""
    stored = next((cd.position for cd in topology.collision_domains if cd.name == domain), None)
    if stored is not None:
        return stored.x, stored.y
    points = [_centre(node.position) for node, _ in topology.members(domain)]
    if not points:
        return None
    if len(points) == 1:
        (x, y), (dx, dy) = points[0], _stub_direction(domain)
        return x + dx * _STUB_DISTANCE, y + dy * _STUB_DISTANCE
    return sum(x for x, _ in points) / len(points), sum(y for _, y in points) / len(points)


def _area_zone(topology: Topology, group: Group) -> Zone:
    """An area's zone: round its own devices and segments, through its border routers.

    A border router is in two areas or more, so drawing it whole inside one
    puts its interfaces in the others in the wrong zone. The zone's edge runs
    through the middle of it instead, beside its interfaces in this area.
    """
    borders = set(group.borders)
    own = set(group.segments)
    # Each box as (left, top, right, bottom).
    boxes: list[tuple[float, float, float, float]] = []
    for node in topology.nodes:
        if node.name in borders:
            x, y = _centre(node.position)
            # In three areas or more, it stands on a corner. Otherwise, which way
            # its links into the other area leave: up or down puts it on a top
            # or bottom edge, with room beside it along that edge; sideways, on
            # a left or right one; both, on a corner.
            areas = sum(1 for found, _ in group.edges.values() if node.name in found)
            ways = {"along", "across"} if areas >= 3 else set()
            for interface in node.interfaces if areas < 3 else ():
                if interface.collision_domain in own:
                    continue
                if (at := _segment_centre(topology, interface.collision_domain)) is None:
                    continue
                dx, dy = at[0] - x, at[1] - y
                if dx or dy:
                    ways.add("across" if abs(dy) > abs(dx) else "along")
            pad_x = _PADDING["x"] if ways == {"across"} else 0
            pad_y = _PADDING["y"] if ways == {"along"} else 0
            boxes.append((x - pad_x, y - pad_y, x + pad_x, y + pad_y))
        elif node.name in group.members:
            p = node.position
            boxes.append(
                (
                    p.x - _PADDING["x"],
                    p.y - _PADDING["y"],
                    p.x + _DEVICE["x"] + _PADDING["x"],
                    p.y + _DEVICE["y"] + _PADDING["y"],
                )
            )
    for domain in group.segments:
        centre = _segment_centre(topology, domain)
        if centre is None:
            continue
        # A segment only between border routers lies between them, on the
        # edge; one reaching into the area has room round its name.
        names = {node.name for node, _ in topology.members(domain)}
        pad = 0 if names <= borders else _SEGMENT
        x, y = centre
        boxes.append((x - pad, y - pad, x + pad, y + pad))

    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)
    # Border routers in a line would give a zone with no inside.
    grow_x = max(0.0, 2 * _PADDING["x"] - (right - left)) / 2
    grow_y = max(0.0, 2 * _PADDING["y"] - (bottom - top)) / 2
    return Zone(
        id=group.id,
        name=group.name,
        position=Position(x=left - grow_x, y=top - grow_y),
        width=right - left + 2 * grow_x,
        height=bottom - top + 2 * grow_y,
    )
