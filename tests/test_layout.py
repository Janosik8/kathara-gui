"""Arranging a topology that arrives without coordinates.

An imported lab has no layout, so every device lands on the same point and the
diagram is unreadable. What the algorithm is *for* is stated as a measurement
here — crossings counted before and after — because an untested layout
algorithm is an opinion.
"""

from __future__ import annotations

import itertools
import random

import pytest

from kathara_gui.domain import layout
from kathara_gui.domain.layout import SPACING, arrange, count_crossings, needs_layout
from kathara_gui.domain.model import Interface, Node, Position, Topology


def build(edges: list[tuple[str, str]]) -> Topology:
    """A topology from a list of links, each on its own collision domain."""
    interfaces: dict[str, list[str]] = {}
    for index, (a, b) in enumerate(edges):
        domain = f"CD{index}"
        interfaces.setdefault(a, []).append(domain)
        interfaces.setdefault(b, []).append(domain)
    return Topology(
        name="generated",
        nodes=[
            Node(
                name=name,
                interfaces=[
                    Interface(number=i, collision_domain=d) for i, d in enumerate(domains)
                ],
            )
            for name, domains in sorted(interfaces.items())
        ],
    )


def unordered_layout(topology: Topology) -> dict[str, Position]:
    """Layered, but without the crossing-reduction pass.

    The baseline that matters: it isolates what barycentre ordering buys, and
    catches the case where ordering makes things worse — which it did, until
    the best pass was kept rather than the last.
    """
    adjacency, _ = layout._graph(topology)
    placed: dict[str, Position] = {}
    origin = 0.0
    for group in layout._components(adjacency):
        layers = layout._layers(adjacency, group)
        placed.update(layout._place(layers, origin, 0.0))
        origin += (max(len(layer) for layer in layers) + 1) * SPACING["x"]
    devices = {node.name for node in topology.nodes}
    return {name: p for name, p in placed.items() if name in devices}


def random_layout(topology: Topology, seed: int) -> dict[str, Position]:
    rng = random.Random(seed)
    return {
        node.name: Position(x=rng.uniform(0, 1200), y=rng.uniform(0, 800))
        for node in topology.nodes
    }


RING = [(f"r{i}", f"r{(i + 1) % 6}") for i in range(6)]
STAR = [("core", f"r{i}") for i in range(7)]
CAMPUS = [
    ("core", "d1"),
    ("core", "d2"),
    ("d1", "pc1"),
    ("d1", "pc2"),
    ("d2", "pc3"),
    ("d2", "pc4"),
]
MESH5 = list(itertools.combinations([f"r{i}" for i in range(5)], 2))


def dense(seed: int, nodes: int, links: int) -> list[tuple[str, str]]:
    rng = random.Random(seed)
    names = [f"n{i}" for i in range(nodes)]
    return sorted({tuple(sorted(rng.sample(names, 2))) for _ in range(links)})  # type: ignore[misc]


# -- what the algorithm is for -----------------------------------------


@pytest.mark.parametrize("edges", [RING, STAR, CAMPUS, dense(7, 12, 18), dense(11, 20, 30)])
def test_ordering_never_makes_a_layout_worse(edges: list[tuple[str, str]]) -> None:
    """Barycentre ordering oscillates rather than converging.

    Measured: on a dense twelve-node graph the final sweep left seventeen
    crossings where the plain breadth-first order had four. Scoring each pass
    and keeping the best is what makes the method safe.
    """
    topology = build(edges)
    before = count_crossings(topology, unordered_layout(topology))
    after = count_crossings(topology, arrange(topology))

    assert after <= before


@pytest.mark.parametrize(("edges", "label"), [(dense(11, 20, 30), "20"), (dense(3, 30, 45), "30")])
def test_a_tangled_graph_comes_out_far_cleaner_than_chance(
    edges: list[tuple[str, str]], label: str
) -> None:
    topology = build(edges)
    chance = sorted(count_crossings(topology, random_layout(topology, s)) for s in range(15))[7]
    arranged = count_crossings(topology, arrange(topology))

    assert arranged < chance / 2, f"{label} nodes: {arranged} against {chance} by chance"


@pytest.mark.parametrize("edges", [RING, STAR, CAMPUS, [(f"r{i}", f"r{i + 1}") for i in range(7)]])
def test_the_ordinary_teaching_topologies_come_out_without_crossings(
    edges: list[tuple[str, str]],
) -> None:
    """Rings, stars, chains and campus trees are what students actually draw."""
    topology = build(edges)
    assert count_crossings(topology, arrange(topology)) == 0


def test_a_campus_tree_is_laid_out_as_a_hierarchy() -> None:
    """Core on top, distribution beneath it, hosts at the bottom.

    Rooting at the most connected vertex put the *distribution* switches first,
    because each carries several hosts. Rooting at the graph's centre is what
    matches how anyone would draw this by hand.
    """
    positions = arrange(build(CAMPUS))

    assert positions["core"].y < positions["d1"].y < positions["pc1"].y
    assert positions["d1"].y == positions["d2"].y
    assert positions["pc1"].y == positions["pc4"].y


# -- readability -------------------------------------------------------


@pytest.mark.parametrize("edges", [RING, STAR, CAMPUS, MESH5, dense(11, 20, 30)])
def test_no_two_devices_land_on_the_same_spot(edges: list[tuple[str, str]]) -> None:
    positions = arrange(build(edges))
    points = [(p.x, p.y) for p in positions.values()]
    assert len(set(points)) == len(points)


@pytest.mark.parametrize("edges", [RING, STAR, CAMPUS, dense(11, 20, 30)])
def test_neighbours_in_a_row_leave_room_for_their_labels(
    edges: list[tuple[str, str]],
) -> None:
    """A device's interface labels and addresses sit outside its box, so the
    readable width is well beyond the icon — the reported complaint."""
    positions = list(arrange(build(edges)).values())
    for a, b in itertools.combinations(positions, 2):
        if a.y == b.y:
            assert abs(a.x - b.x) >= SPACING["x"]


def test_separate_networks_are_placed_apart() -> None:
    topology = build([("a1", "a2"), ("a2", "a3"), ("b1", "b2"), ("b2", "b3")])
    positions = arrange(topology)

    left = max(positions[n].x for n in ("a1", "a2", "a3"))
    right = min(positions[n].x for n in ("b1", "b2", "b3"))
    assert right > left, "the two networks overlap"


def test_a_shared_segment_is_laid_out_as_the_node_it_is_drawn_as() -> None:
    """Three devices on one collision domain are drawn as a hub, not a
    triangle, so laying out only the devices would arrange a different graph
    from the one on screen."""
    topology = Topology(
        name="shared",
        nodes=[
            Node(name=f"pc{i}", interfaces=[Interface(number=0, collision_domain="A")])
            for i in range(3)
        ],
    )
    positions = arrange(topology)
    assert len({(p.x, p.y) for p in positions.values()}) == 3


# -- stability ---------------------------------------------------------


@pytest.mark.parametrize("edges", [RING, CAMPUS, dense(11, 20, 30)])
def test_the_same_topology_lays_out_the_same_way_every_time(
    edges: list[tuple[str, str]],
) -> None:
    """Reopening your own work should not rearrange it."""
    topology = build(edges)
    assert arrange(topology) == arrange(topology)


def test_every_device_gets_a_position() -> None:
    topology = build(dense(11, 20, 30))
    positions = arrange(topology)
    assert set(positions) == {node.name for node in topology.nodes}


def test_a_device_with_no_links_is_still_placed() -> None:
    topology = Topology(name="lonely", nodes=[Node(name="r1"), Node(name="r2")])
    positions = arrange(topology)
    assert len({(p.x, p.y) for p in positions.values()}) == 2


def test_an_empty_topology_is_not_an_error() -> None:
    assert arrange(Topology(name="empty")) == {}


# -- when it should run ------------------------------------------------


def test_a_lab_with_no_coordinates_needs_arranging() -> None:
    """Every device at the origin: what an import without positions produces."""
    assert needs_layout(build(CAMPUS)) is True


def test_a_lab_that_was_laid_out_is_left_alone() -> None:
    topology = build(CAMPUS)
    for index, node in enumerate(topology.nodes):
        node.position = Position(x=index * 100, y=index * 50)
    assert needs_layout(topology) is False


def test_a_single_device_needs_nothing() -> None:
    assert needs_layout(Topology(name="one", nodes=[Node(name="r1")])) is False


# -- the measurement itself --------------------------------------------


def test_count_crossings_sees_a_crossing() -> None:
    """An X: two links whose endpoints alternate."""
    topology = build([("a", "c"), ("b", "d")])
    positions = {
        "a": Position(x=0, y=0),
        "b": Position(x=100, y=0),
        "c": Position(x=100, y=100),
        "d": Position(x=0, y=100),
    }
    assert count_crossings(topology, positions) == 1


def test_count_crossings_ignores_links_that_merely_meet() -> None:
    """Two links from one device share an endpoint by design."""
    topology = build([("hub", "a"), ("hub", "b")])
    positions = {
        "hub": Position(x=50, y=0),
        "a": Position(x=0, y=100),
        "b": Position(x=100, y=100),
    }
    assert count_crossings(topology, positions) == 0
