"""OSPF areas and autonomous systems: who is in which, the layout, and the zones.

The fixture is the user's own lab ``test-kgui-ospf``: r1, r2 and r3 in the
backbone, r2 a border router to areas 1 and 3, r3 to area 2, and r4, r6 and
r7 with an empty ``frr.conf``, so in no area at all.
"""

from __future__ import annotations

import itertools
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kathara_gui.domain.areas import area_groups, area_label, ospf_areas_from_config
from kathara_gui.domain.clusters import Group, clustered_layout, routing_groups, zones_around
from kathara_gui.domain.layout import arrange, count_crossings
from kathara_gui.domain.model import Interface, Node, Position, Topology, Zone
from kathara_gui.main import create_app
from kathara_gui.project import scenario
from kathara_gui.project.session import Session, get_session


def node(name: str, kind: str, *links: tuple[str, str | None]) -> Node:
    return Node(
        name=name,
        kind=kind,  # type: ignore[arg-type]
        interfaces=[
            Interface(number=i, collision_domain=d, ip=ip) for i, (d, ip) in enumerate(links)
        ],
    )


def ospf_lab() -> Topology:
    return Topology(
        name="ospf",
        nodes=[
            node(
                "r1", "router", ("A", "10.0.0.1/24"), ("B", "10.0.1.1/24"), ("D", "192.168.0.1/24")
            ),
            node(
                "r2",
                "router",
                ("B", "10.0.1.2/24"),
                ("C", "10.0.3.1/24"),
                ("E", "192.168.1.1/24"),
                ("G", "11.0.0.1/24"),
            ),
            node("r3", "router", ("A", "10.0.0.2/24"), ("C", "10.0.3.2/24"), ("F", "12.0.0.1/24")),
            node("r4", "router", ("D", "192.168.0.2/24"), ("E", "192.168.1.2/24")),
            node("r5", "router", ("F", "12.0.0.2/24"), ("L", "13.0.0.1/24")),
            node("r6", "router", ("G", "11.0.0.2/24"), ("H", "11.0.1.1/24")),
            node("r7", "router", ("H", "11.0.1.2/24")),
            node("pc1", "pc", ("L", "13.0.0.2/24")),
        ],
    )


CONFIGS = {
    "r1": "router ospf\n network 10.0.0.0/24 area 0\n network 10.0.1.0/24 area 0\n"
    " network 192.168.0.0/24 area 1\nexit\n",
    "r2": "interface eth2\n ip ospf cost 20\nexit\n!\nrouter ospf\n"
    " network 10.0.1.0/24 area 0\n network 10.0.3.0/24 area 0\n"
    " network 11.0.0.0/24 area 3\n network 192.168.1.0/24 area 1\nexit\n",
    "r3": "router ospf\n network 10.0.0.0/16 area 0.0.0.0\n network 12.0.0.0/24 area 2\n",
    "r4": "hostname r4\n",
    "r5": "router ospf\n network 12.0.0.0/23 area 2\n area 2 stub\n",
    "r6": "",
}


# -- reading areas --------------------------------------------------------------


def test_areas_are_read_plain_or_dotted_and_compared_by_value() -> None:
    config = ospf_areas_from_config("router ospf\nnetwork 10.0.0.0/16 area 0.0.0.0\n")
    assert config.networks[0][1] == 0
    assert ospf_areas_from_config("network 10.0.0.0/8 area 1.1.1.1").networks[0][1] == 16843009
    assert (area_label(0), area_label(3), area_label(16843009)) == ("0", "3", "1.1.1.1")


def test_a_network_wider_than_the_subnet_holds_the_interface() -> None:
    config = ospf_areas_from_config("router ospf\n network 10.0.0.0/16 area 0\n")
    assert config.area_of(Interface(number=0, collision_domain="A", ip="10.0.5.1/24")) == 0
    assert config.area_of(Interface(number=0, collision_domain="A", ip="11.0.0.1/24")) is None


def test_the_longest_prefix_wins() -> None:
    config = ospf_areas_from_config("network 10.0.0.0/8 area 0\nnetwork 10.1.0.0/16 area 4\n")
    assert config.area_of(Interface(number=0, collision_domain="A", ip="10.1.0.1/24")) == 4


def test_an_area_set_on_the_interface_itself_is_read() -> None:
    config = ospf_areas_from_config("interface eth1\n ip ospf area 7\nexit\nrouter ospf\n")
    assert config.area_of(Interface(number=1, collision_domain="A")) == 7
    assert config.area_of(Interface(number=0, collision_domain="A")) is None


def test_bgp_networks_are_not_areas() -> None:
    assert not ospf_areas_from_config("router bgp 10\n network 10.0.0.0/16\n")


# -- who is in which area ---------------------------------------------------------


def test_border_routers_are_in_the_backbone_and_unconfigured_routers_in_no_area() -> None:
    groups = area_groups(ospf_lab(), CONFIGS)
    # r4, r6 and r7 say nothing about OSPF, so which area they were meant for is
    # unknown; areas 1 and 3 therefore have no device of their own.
    assert groups == {0: ["r1", "r2", "r3"], 2: ["r5", "pc1"]}


def test_a_host_takes_the_area_of_its_segment_and_hosts_behind_it_follow() -> None:
    topology = ospf_lab()
    topology.nodes.append(node("sw1", "switch", ("L", None), ("M", None)))
    topology.nodes.append(node("pc2", "pc", ("M", None)))
    assert area_groups(topology, CONFIGS)[2] == ["r5", "pc1", "sw1", "pc2"]


def test_nothing_spreads_through_a_router_in_no_area() -> None:
    topology = ospf_lab()
    topology.nodes.append(node("pc9", "pc", ("H", None)))
    assert all("pc9" not in names for names in area_groups(topology, CONFIGS).values())


# -- the groups drawn ---------------------------------------------------------------


def test_two_areas_are_groups_and_one_is_not() -> None:
    groups = routing_groups(ospf_lab(), CONFIGS)
    assert [(g.id, g.name) for g in groups] == [("area0", "Area 0"), ("area2", "Area 2")]
    only_backbone = {n: t for n, t in CONFIGS.items() if n != "r5"}
    assert routing_groups(ospf_lab(), only_backbone) == []


def two_systems_with_areas() -> tuple[Topology, dict[str, str]]:
    """AS 10: an OSPF backbone and a stub area 1.1.1.1. AS 100: one router."""
    topology = Topology(
        name="complex",
        nodes=[
            node("bb1", "router", ("A", "10.0.0.1/24"), ("E", "100.0.0.1/30")),
            node("bb3", "router", ("A", "10.0.0.3/24"), ("O", "140.0.0.1/30")),
            node("r1", "router", ("E", "100.0.0.2/30")),
            node("as100r1", "router", ("O", "140.0.0.2/30")),
        ],
    )
    configs = {
        "bb1": "router ospf\nnetwork 10.0.0.0/16 area 0.0.0.0\nnetwork 100.0.0.0/30 area 1.1.1.1\n",
        "bb3": "router ospf\nnetwork 10.0.0.0/16 area 0.0.0.0\nrouter bgp 10\n",
        "r1": "router ospf\nnetwork 100.0.0.0/30 area 1.1.1.1\n",
        "as100r1": "router bgp 100\n network 50.0.0.0/16\n",
    }
    return topology, configs


def test_areas_are_drawn_inside_their_autonomous_system() -> None:
    topology, configs = two_systems_with_areas()
    groups = routing_groups(topology, configs)
    assert [g.name for g in groups] == ["AS 10", "AS 100"]
    assert [(a.id, a.name, a.members) for a in groups[0].inner] == [
        ("area0", "Area 0", ["bb1", "bb3"]),
        ("area1-1-1-1", "Area 1.1.1.1", ["r1"]),
    ]
    assert groups[1].inner == []


# -- laying them out ---------------------------------------------------------------


def inside(position: Position, zone: Zone) -> bool:
    return (
        zone.position.x <= position.x <= zone.position.x + zone.width
        and zone.position.y <= position.y <= zone.position.y + zone.height
    )


def overlap(a: Zone, b: Zone) -> bool:
    return not (
        a.position.x + a.width <= b.position.x
        or b.position.x + b.width <= a.position.x
        or a.position.y + a.height <= b.position.y
        or b.position.y + b.height <= a.position.y
    )


def centre(position: Position) -> tuple[float, float]:
    """Where a zone's edge crosses a border router: the middle of its picture."""
    return position.x + 36, position.y + 26


def test_each_area_is_laid_out_in_its_zone_beside_the_backbone() -> None:
    topology = ospf_lab()
    groups = routing_groups(topology, CONFIGS)
    positions, zones = clustered_layout(topology, groups)
    assert set(positions) == {n.name for n in topology.nodes}
    backbone, area2 = zones
    assert not overlap(backbone, area2)
    # Area 2's own devices are inside it; its border router r3 is on the edge
    # the two zones share.
    for name in ("r5", "pc1"):
        assert inside(positions[name], area2) and not inside(positions[name], backbone)
    x, y = centre(positions["r3"])
    assert on_edge(x, y, backbone) and on_edge(x, y, area2)
    # Devices in no area are not inside any zone.
    for name in ("r4", "r6", "r7"):
        assert not any(inside(positions[name], z) for z in zones)


def test_border_routers_of_one_area_stand_in_a_line_with_its_zone_along_it() -> None:
    """The user's lab once r4 is configured: r1 and r2 both join Area 1."""
    topology = ospf_lab()
    configs = CONFIGS | {"r4": "router ospf\n network 192.168.0.0/16 area 1\n"}
    positions, zones = clustered_layout(topology, routing_groups(topology, configs))
    by_name = {z.name: z for z in zones}
    assert set(by_name) == {"Area 0", "Area 1", "Area 2"}
    (x1, y1), (x2, y2) = centre(positions["r1"]), centre(positions["r2"])
    assert y1 == y2
    for name in ("Area 0", "Area 1"):
        assert on_edge(x1, y1, by_name[name]) and on_edge(x2, y2, by_name[name])
    # r2 is in three areas, so it stands on a corner of each zone it is in.
    for name in ("Area 0", "Area 1"):
        z = by_name[name]
        assert x2 in (z.position.x, z.position.x + z.width)
        assert y2 in (z.position.y, z.position.y + z.height)
    for a, b in itertools.combinations(zones, 2):
        assert not overlap(a, b), (a.name, b.name)


def test_grouping_by_area_crosses_no_more_links_than_the_plain_layout() -> None:
    """Measured on the user's lab: the plain layout crosses 2, this one none."""
    topology = ospf_lab()
    positions, _ = clustered_layout(topology, routing_groups(topology, CONFIGS))
    assert count_crossings(topology, positions) <= count_crossings(topology, arrange(topology))


def test_area_zones_sit_inside_their_system_and_apart_from_each_other() -> None:
    topology, configs = two_systems_with_areas()
    positions, zones = clustered_layout(topology, routing_groups(topology, configs))
    as10, backbone, stub, as100 = zones
    assert [z.name for z in zones] == ["AS 10", "Area 0", "Area 1.1.1.1", "AS 100"]
    for area in (backbone, stub):
        assert inside(area.position, as10)
        assert inside(
            Position(x=area.position.x + area.width, y=area.position.y + area.height), as10
        )
    assert not overlap(backbone, stub)
    assert not overlap(as10, as100)
    assert inside(positions["r1"], stub) and not inside(positions["r1"], backbone)


# -- zones round devices where they stand -------------------------------------------


def test_zones_around_moves_nothing_and_encloses_each_group() -> None:
    topology, configs = two_systems_with_areas()
    placed = {"bb1": (0, 0), "bb3": (300, 0), "r1": (0, 300), "as100r1": (900, 0)}
    topology = topology.model_copy(
        update={
            "nodes": [
                n.model_copy(update={"position": Position(x=x, y=y)})
                for n in topology.nodes
                for name, (x, y) in placed.items()
                if n.name == name
            ]
        }
    )
    zones = {z.name: z for z in zones_around(topology, routing_groups(topology, configs))}
    assert set(zones) == {"AS 10", "Area 0", "Area 1.1.1.1", "AS 100"}
    for name, zone in (("bb3", "Area 0"), ("r1", "Area 1.1.1.1"), ("as100r1", "AS 100")):
        assert inside(topology.node(name).position, zones[zone])  # type: ignore[union-attr]
    # The AS encloses its areas, with room for its own name above theirs.
    assert zones["AS 10"].position.y < zones["Area 0"].position.y
    assert zones["AS 10"].position.x < zones["Area 0"].position.x


def placed_as_tidied() -> Topology:
    """The user's lab where Tidy layout put it (test-kgui-ospf-bad-layout)."""
    at = {
        "r1": (200, 230), "r2": (64, 400), "r3": (336, 400), "r4": (128, 0),
        "r5": (330, 690), "r6": (70, 630), "r7": (70, 800), "pc1": (330, 860),
    }  # fmt: skip
    topology = ospf_lab()
    for n in topology.nodes:
        n.position = Position(x=at[n.name][0], y=at[n.name][1])
    return topology


def on_edge(x: float, y: float, zone: Zone) -> bool:
    left, top = zone.position.x, zone.position.y
    right, bottom = left + zone.width, top + zone.height
    within = left <= x <= right and top <= y <= bottom
    return within and min(abs(x - left), abs(x - right), abs(y - top), abs(y - bottom)) < 1


def test_an_area_zone_runs_through_its_border_routers_not_round_them() -> None:
    """r1, r2 and r3 each have interfaces in two areas or more: drawn whole
    inside Area 0, r3's interface in Area 2 would be in the wrong zone."""
    topology = placed_as_tidied()
    zones = {z.name: z for z in zones_around(topology, routing_groups(topology, CONFIGS))}
    assert set(zones) == {"Area 0", "Area 2"}
    for name in ("r1", "r2", "r3"):
        p = topology.node(name).position  # type: ignore[union-attr]
        assert on_edge(p.x + 36, p.y + 26, zones["Area 0"]), name
    r3 = topology.node("r3").position  # type: ignore[union-attr]
    assert on_edge(r3.x + 36, r3.y + 26, zones["Area 2"])
    # The area's own devices are inside it whole, with room for their names.
    for name in ("r5", "pc1"):
        p = topology.node(name).position  # type: ignore[union-attr]
        assert inside(p, zones["Area 2"]) and not inside(p, zones["Area 0"])
        assert inside(Position(x=p.x + 90, y=p.y + 90), zones["Area 2"])
    # Routers with no OSPF configuration are in neither.
    for name in ("r4", "r6", "r7"):
        p = topology.node(name).position  # type: ignore[union-attr]
        assert not any(inside(p, z) for z in zones.values()), name


def test_border_routers_in_a_line_still_give_a_zone_with_room_inside() -> None:
    topology = placed_as_tidied()
    for n in topology.nodes:
        if n.name in ("r1", "r2", "r3"):
            n.position = Position(x=n.position.x, y=400)
    backbone = zones_around(topology, routing_groups(topology, CONFIGS))[0]
    assert backbone.name == "Area 0" and backbone.height >= 120


def test_no_groups_no_zones() -> None:
    assert zones_around(ospf_lab(), []) == []
    assert zones_around(ospf_lab(), [Group(id="x", name="X", members=["nobody"])]) == []


# -- from disk: import, Tidy layout and the zones button ------------------------------


def write_lab(folder: Path, topology: Topology, configs: dict[str, str]) -> None:
    """A lab as found elsewhere: lab.conf without coordinates, and frr.conf files."""
    folder.mkdir(parents=True, exist_ok=True)
    lines = []
    for n in topology.nodes:
        lines += [f'{n.name}[{i.number}]="{i.collision_domain}"' for i in n.interfaces]
        startup = "".join(
            f"ip address add {i.ip} dev eth{i.number}\n" for i in n.interfaces if i.ip
        )
        (folder / f"{n.name}.startup").write_text(startup, encoding="utf-8")
    (folder / "lab.conf").write_text("\n".join(lines) + "\n", encoding="utf-8")
    for name, text in configs.items():
        frr = folder / name / "etc" / "frr"
        frr.mkdir(parents=True, exist_ok=True)
        (frr / "frr.conf").write_text(text, encoding="utf-8")


def test_an_imported_ospf_lab_opens_with_a_zone_per_area(tmp_path: Path) -> None:
    write_lab(tmp_path / "ospf", ospf_lab(), CONFIGS)
    loaded = scenario.load(tmp_path / "ospf").topology
    assert [z.name for z in loaded.zones] == ["Area 0", "Area 2"]
    assert inside(loaded.node("r5").position, loaded.zones[1])  # type: ignore[union-attr]


def test_ospfd_conf_from_quagga_days_is_read(tmp_path: Path) -> None:
    folder = tmp_path / "old"
    folder.mkdir()
    (folder / "r1" / "etc" / "quagga").mkdir(parents=True)
    (folder / "r1" / "etc" / "quagga" / "ospfd.conf").write_text(
        "router ospf\n network 10.0.0.0/8 area 4\n", encoding="utf-8"
    )
    configs = scenario.read_routing_configs(ospf_lab(), folder)
    assert "area 4" in configs["r1"]


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(token="t")
    session = Session(workspace_root=tmp_path)
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app, headers={"X-KGUI-Token": "t"}) as test_client:
        yield test_client


def test_tidy_layout_groups_by_area_and_returns_no_zones(
    client: TestClient, tmp_path: Path
) -> None:
    # An unsaved lab is generated into the workspace folder named after it.
    write_lab(tmp_path / "ospf", ospf_lab(), CONFIGS)
    body = client.post("/api/topology/arrange", json=ospf_lab().model_dump()).json()
    assert body["groups"] == ["Area 0", "Area 2"]
    assert set(body["positions"]) == {n.name for n in ospf_lab().nodes}
    assert "zones" not in body


def test_tidy_layout_without_configuration_is_the_plain_layout(client: TestClient) -> None:
    body = client.post("/api/topology/arrange", json=ospf_lab().model_dump()).json()
    assert body["groups"] == []
    assert body["positions"] == {
        name: p.model_dump() for name, p in arrange(ospf_lab()).items()
    }


def test_the_zones_endpoint_draws_round_the_areas_and_stores_nothing(
    client: TestClient, tmp_path: Path
) -> None:
    write_lab(tmp_path / "ospf", ospf_lab(), CONFIGS)
    zones = client.post("/api/topology/zones", json=ospf_lab().model_dump()).json()["zones"]
    assert [(z["id"], z["name"]) for z in zones] == [("area0", "Area 0"), ("area2", "Area 2")]
    assert client.get("/api/topology").json()["topology"]["zones"] == []


def test_the_zones_endpoint_finds_nothing_in_a_lab_without_configuration(
    client: TestClient,
) -> None:
    assert client.post("/api/topology/zones", json=ospf_lab().model_dump()).json() == {
        "zones": []
    }
