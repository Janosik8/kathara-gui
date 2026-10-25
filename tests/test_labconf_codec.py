"""Round-trip fidelity for the lab.conf codec.

Two properties matter more than any single case:

* **Non-destructive import.** A hand-written lab must survive import and
  re-export without losing options this model does not interpret. Otherwise
  migrating an existing library of scenarios silently corrupts them.
* **Position preservation.** Canvas coordinates must survive a trip through
  the file, because that is the whole reason the comment block exists.
"""

from __future__ import annotations

import pytest

from kathara_gui.domain.codec.labconf import parse, serialize
from kathara_gui.domain.model import Interface, Node, Position, Topology

# A lab as someone would write it by hand: quoted and unquoted values, an
# inline comment, a MAC address, and options the model does not model.
LEGACY = """\
LAB_NAME="BGP exercise"
LAB_AUTHOR="Kathara Authors"

# The core routers
r1[0]="A"
r1[1]="B/02:42:ac:11:00:02"
r1[image]="kathara/frr"
r1[mem]=256m
r1[port]="8080:80"

r2[0]=A          # same collision domain as r1
r2[image]="kathara/frr"

pc1[0]="B"
pc1[bridged]="true"
"""


def test_parses_devices_interfaces_and_metadata() -> None:
    result = parse(LEGACY)
    topo = result.topology

    assert topo.name == "BGP exercise"
    assert topo.author == "Kathara Authors"
    assert [n.name for n in topo.nodes] == ["r1", "r2", "pc1"]

    r1 = topo.node("r1")
    assert r1 is not None
    assert [i.collision_domain for i in r1.interfaces] == ["A", "B"]
    assert r1.interface(1).mac_address == "02:42:ac:11:00:02"
    assert r1.image == "kathara/frr"
    assert r1.memory == "256m"


def test_unquoted_values_and_inline_comments_are_handled() -> None:
    r2 = parse(LEGACY).topology.node("r2")
    assert r2 is not None
    # `r2[0]=A          # same collision domain as r1`
    assert r2.interfaces[0].collision_domain == "A"


def test_bridged_is_read_as_a_boolean() -> None:
    assert parse(LEGACY).topology.node("pc1").bridged is True


def test_unmodelled_options_are_preserved_verbatim() -> None:
    """`port` has no model field; losing it would corrupt an imported lab."""
    r1 = parse(LEGACY).topology.node("r1")
    assert r1.extra_options["port"] == "8080:80"
    assert 'r1[port]="8080:80"' in serialize(parse(LEGACY).topology)


def test_legacy_lab_survives_a_round_trip() -> None:
    once = parse(LEGACY).topology
    twice = parse(serialize(once)).topology
    assert twice.model_dump() == once.model_dump()


def test_serialize_is_idempotent() -> None:
    """Saving an unchanged lab must not churn the file."""
    first = serialize(parse(LEGACY).topology)
    assert serialize(parse(first).topology) == first


def test_ordinary_comments_are_not_mistaken_for_metadata() -> None:
    assert parse(LEGACY).warnings == []


# -- the reason the comment block exists ------------------------------


def _positioned() -> Topology:
    return Topology(
        name="positioned",
        nodes=[
            Node(
                name="r1",
                kind="router",
                position=Position(x=120.0, y=340.0),
                daemons=["zebra", "ospfd"],
                interfaces=[Interface(number=0, collision_domain="A", ip="10.0.0.1/24")],
            ),
            Node(
                name="pc1",
                kind="pc",
                position=Position(x=-40.5, y=12.25),
                interfaces=[Interface(number=0, collision_domain="A", ip="10.0.0.2/24")],
            ),
        ],
    )


def test_positions_survive_the_file() -> None:
    topo = parse(serialize(_positioned())).topology
    assert topo.node("r1").position.x == 120.0
    assert topo.node("r1").position.y == 340.0
    # Negative and fractional coordinates are ordinary on a pannable canvas.
    assert topo.node("pc1").position.x == -40.5
    assert topo.node("pc1").position.y == 12.25


def test_kind_daemons_and_addresses_survive_the_file() -> None:
    topo = parse(serialize(_positioned())).topology
    assert topo.node("r1").daemons == ["zebra", "ospfd"]
    assert topo.node("pc1").kind == "pc"
    assert topo.node("r1").interface(0).ip == "10.0.0.1/24"


def test_subnet_plan_survives_the_file() -> None:
    topo = _positioned()
    topo.collision_domains[:] = []
    topo = parse(serialize(topo)).topology
    topo.collision_domain("A").subnet = "10.0.0.0/24"
    assert parse(serialize(topo)).topology.collision_domain("A").subnet == "10.0.0.0/24"


def test_generated_file_remains_a_valid_plain_kathara_lab() -> None:
    """Everything extra must live in comments, so `kathara lstart` still works."""
    text = serialize(_positioned())
    functional = [
        line
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    assert 'r1[0]="A"' in functional
    for line in functional:
        assert "kgui" not in line, f"metadata leaked into a functional line: {line}"


def test_a_lab_without_our_comments_still_imports() -> None:
    """Legacy labs have no positions; they default rather than fail."""
    topo = parse('r1[0]="A"\nr2[0]="A"\n').topology
    assert len(topo.nodes) == 2
    assert topo.node("r1").position.x == 0.0


# -- forgiving import --------------------------------------------------


def test_unreadable_lines_are_reported_not_fatal() -> None:
    result = parse('r1[0]="A"\nthis is not valid\n')
    assert len(result.topology.nodes) == 1
    assert any("could not understand" in w for w in result.warnings)


def test_interface_without_a_collision_domain_is_reported() -> None:
    result = parse('r1[0]=""\n')
    assert any("no collision domain" in w for w in result.warnings)


def test_non_numeric_cpus_is_reported() -> None:
    result = parse('r1[0]="A"\nr1[cpus]="lots"\n')
    assert any("not a number" in w for w in result.warnings)


def test_unknown_lab_metadata_is_reported() -> None:
    result = parse('LAB_NONSENSE="x"\nr1[0]="A"\n')
    assert any("unrecognised lab metadata" in w for w in result.warnings)


@pytest.mark.parametrize("cpus,expected", [(2.0, '"2"'), (1.5, '"1.5"')])
def test_cpus_formatting_avoids_pointless_churn(cpus: float, expected: str) -> None:
    topo = Topology(nodes=[Node(name="r1", cpus=cpus)])
    assert f"r1[cpus]={expected}" in serialize(topo)


def test_empty_topology_serializes_without_error() -> None:
    assert serialize(Topology(name="empty")) .strip() == 'LAB_NAME="empty"'


def test_a_moved_shared_segment_keeps_its_place() -> None:
    """Test step 1D.1: a shared segment dragged by hand snapped back.

    Its position travels with the subnet in the same comment record, and a
    segment never moved writes none, so it keeps following its members.
    """
    topo = _positioned()
    topo = parse(serialize(topo)).topology
    topo.collision_domain("A").position = Position(x=310, y=-45.5)

    text = serialize(topo)
    assert "# kgui:cd A pos=310,-45.5" in text
    reread = parse(text).topology
    assert reread.collision_domain("A").position == Position(x=310, y=-45.5)
    assert all(
        cd.position is None for cd in reread.collision_domains if cd.name != "A"
    )


def test_an_unreadable_segment_position_is_reported_not_fatal() -> None:
    text = serialize(_positioned()) + "# kgui:cd A pos=left,up\n"
    result = parse(text)
    assert result.topology.collision_domain("A").position is None
    assert any("could not read position" in w for w in result.warnings)


def test_privileged_round_trips_as_a_typed_field() -> None:
    """Bug 31: a typed switch, not an opaque extra option."""
    topology = Topology(
        nodes=[
            Node(
                name="r1",
                privileged=True,
                interfaces=[Interface(number=0, collision_domain="A")],
            ),
            Node(name="r2", interfaces=[Interface(number=0, collision_domain="A")]),
        ]
    )
    text = serialize(topology)
    assert 'r1[privileged]="true"' in text
    assert "r2[privileged]" not in text
    parsed = parse(text).topology
    assert parsed.node("r1").privileged is True
    assert parsed.node("r1").extra_options == {}
    assert parsed.node("r2").privileged is False
