"""Zones (FR-10) and autonomous systems drawn as clusters (9B.2).

A zone is a named area drawn behind devices. It travels in ``lab.conf`` as a
``# kgui:zone`` comment, so Kathará never sees it; and a BGP lab opened from
elsewhere gets one per autonomous system, around that system's devices.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from kathara_gui.domain.asgroups import as_groups, asn_from_config, clustered_layout
from kathara_gui.domain.codec.labconf import parse, serialize
from kathara_gui.domain.model import Interface, Node, Position, Topology, Zone
from kathara_gui.project import scenario


def zone(**changes: object) -> Zone:
    return Zone(
        **{
            "id": "z1",
            "name": "Area 0",
            "shape": "ellipse",
            "position": Position(x=40, y=-20.5),
            "width": 420,
            "height": 260,
            **changes,
        }
    )


# -- zones in lab.conf ----------------------------------------------------------


@pytest.mark.parametrize("name", ["Area 0", "AS 65001 — ISP", "a=b c%d", ""])
def test_a_zone_round_trips_through_lab_conf(name: str) -> None:
    topology = Topology(name="lab", zones=[zone(name=name)])
    text = serialize(topology)
    assert "# kgui:zone z1 shape=ellipse pos=40,-20.5 size=420,260" in text
    assert parse(text).topology.zones == topology.zones


def test_zones_are_comments_kathara_ignores() -> None:
    text = serialize(Topology(name="lab", zones=[zone()]))
    assert all(line.startswith("#") for line in text.splitlines() if "zone" in line)


def test_a_damaged_zone_is_reported_and_left_out() -> None:
    result = parse("# kgui:v1\n# kgui:zone z1 shape=ellipse pos=0,0 size=wide\nr1[0]=\"A\"\n")
    assert result.topology.zones == []
    assert any("z1" in warning for warning in result.warnings)


def test_an_unknown_shape_is_refused() -> None:
    with pytest.raises(ValidationError):
        zone(shape="hexagon")


def test_two_zones_cannot_share_an_id() -> None:
    with pytest.raises(ValidationError):
        Topology(zones=[zone(), zone(name="other")])


def test_a_lab_without_zones_writes_no_zone_records() -> None:
    assert "kgui:zone" not in serialize(Topology(name="lab"))


# -- autonomous systems ---------------------------------------------------------


def test_the_as_number_is_read_from_frr_and_quagga_configuration() -> None:
    frr = "hostname r1\n!\nrouter bgp 65001\n neighbor 10.0.0.2 remote-as 2\n"
    assert asn_from_config(frr) == 65001
    assert asn_from_config("router ospf\n network 10.0.0.0/8 area 0\n") is None
    # A commented-out line is not a declaration.
    assert asn_from_config("! router bgp 7\n") is None


def two_systems() -> Topology:
    """AS 1: r1, sw1, pc1. AS 2: r2, pc2. r1 and r2 peer over X."""

    def node(name: str, kind: str, *domains: str) -> Node:
        return Node(
            name=name,
            kind=kind,  # type: ignore[arg-type]
            interfaces=[Interface(number=i, collision_domain=d) for i, d in enumerate(domains)],
        )

    return Topology(
        name="bgp",
        nodes=[
            node("r1", "router", "X", "A"),
            node("sw1", "switch", "A", "B"),
            node("pc1", "pc", "B"),
            node("r2", "router", "X", "C"),
            node("pc2", "pc", "C"),
        ],
    )


def test_hosts_and_switches_join_the_as_of_the_routers_they_hang_off() -> None:
    groups = as_groups(two_systems(), {"r1": 1, "r2": 2})
    assert groups == {1: ["r1", "sw1", "pc1"], 2: ["r2", "pc2"]}


def test_a_device_between_two_systems_belongs_to_neither() -> None:
    topology = two_systems()
    topology.nodes.append(
        Node(
            name="ix",
            kind="switch",
            interfaces=[
                Interface(number=0, collision_domain="A"),
                Interface(number=1, collision_domain="C"),
            ],
        )
    )
    groups = as_groups(topology, {"r1": 1, "r2": 2})
    assert "ix" not in groups[1] + groups[2]


def inside(position: Position, z: Zone) -> bool:
    return (
        z.position.x <= position.x <= z.position.x + z.width
        and z.position.y <= position.y <= z.position.y + z.height
    )


def test_each_system_is_laid_out_inside_its_own_zone_and_the_zones_do_not_overlap() -> None:
    topology = two_systems()
    positions, zones = clustered_layout(topology, as_groups(topology, {"r1": 1, "r2": 2}))
    assert [z.name for z in zones] == ["AS 1", "AS 2"]
    as1, as2 = zones
    for name in ("r1", "sw1", "pc1"):
        assert inside(positions[name], as1) and not inside(positions[name], as2)
    for name in ("r2", "pc2"):
        assert inside(positions[name], as2) and not inside(positions[name], as1)
    assert as1.position.x + as1.width < as2.position.x
    assert set(positions) == {n.name for n in topology.nodes}


# -- an imported BGP lab ----------------------------------------------------------


def write_bgp_lab(folder: Path) -> None:
    """Two systems, as a public lab would have them: no coordinates at all."""
    folder.mkdir(parents=True)
    (folder / "lab.conf").write_text(
        'r1[0]="X"\nr1[1]="A"\npc1[0]="A"\nr2[0]="X"\nr2[1]="C"\npc2[0]="C"\n',
        encoding="utf-8",
    )
    for name, asn in (("r1", 65001), ("r2", 65002)):
        frr = folder / name / "etc" / "frr"
        frr.mkdir(parents=True)
        (frr / "frr.conf").write_text(f"router bgp {asn}\n", encoding="utf-8")


def test_an_imported_bgp_lab_opens_with_a_zone_per_system(tmp_path: Path) -> None:
    write_bgp_lab(tmp_path / "bgp")
    loaded = scenario.load(tmp_path / "bgp")
    assert [z.name for z in loaded.topology.zones] == ["AS 65001", "AS 65002"]
    as1 = loaded.topology.zones[0]
    assert inside(loaded.topology.node("pc1").position, as1)  # type: ignore[union-attr]


def test_the_zones_are_kept_once_saved_and_not_recomputed(tmp_path: Path) -> None:
    write_bgp_lab(tmp_path / "bgp")
    loaded = scenario.load(tmp_path / "bgp")
    moved = loaded.topology.model_copy(
        update={"zones": [loaded.topology.zones[0].model_copy(update={"name": "Customer"})]}
    )
    scenario.save(moved, tmp_path / "bgp")
    assert [z.name for z in scenario.load(tmp_path / "bgp").topology.zones] == ["Customer"]


def test_a_lab_with_one_system_gets_no_zone(tmp_path: Path) -> None:
    write_bgp_lab(tmp_path / "bgp")
    conf = tmp_path / "bgp" / "r2" / "etc" / "frr" / "frr.conf"
    conf.write_text("router bgp 65001\n", encoding="utf-8")
    assert scenario.load(tmp_path / "bgp").topology.zones == []
