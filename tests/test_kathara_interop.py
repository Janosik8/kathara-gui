"""Cross-validation against Kathara's own parser.

The codec's central bet is that extra state can ride along in ``#`` comments
without disturbing Kathara. Asserting that against our own parser would be
circular, so these tests feed generated labs to **Kathara's** ``LabParser`` and
check it sees what we intended.

No Docker daemon is involved — parsing is pure — so this runs in the normal
suite on every platform.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from Kathara.parser.netkit.LabParser import LabParser

from kathara_gui.domain.model import Interface, Node, Position, Topology
from kathara_gui.project.labdir import write_lab


@pytest.fixture
def triangle() -> Topology:
    """Three routers in a ring — the acceptance-test topology, with layout."""
    nodes = [
        Node(
            name="r1",
            kind="router",
            position=Position(x=100, y=50),
            daemons=["zebra", "ospfd"],
            interfaces=[
                Interface(number=0, collision_domain="A", ip="10.0.0.1/24"),
                Interface(number=1, collision_domain="C", ip="10.0.2.1/24"),
            ],
        ),
        Node(
            name="r2",
            kind="router",
            position=Position(x=200, y=250),
            daemons=["zebra", "ospfd"],
            interfaces=[
                Interface(number=0, collision_domain="A", ip="10.0.0.2/24"),
                Interface(number=1, collision_domain="B", ip="10.0.1.1/24"),
            ],
        ),
        Node(
            name="r3",
            kind="router",
            position=Position(x=0, y=250),
            daemons=["zebra", "ospfd"],
            interfaces=[
                Interface(number=0, collision_domain="B", ip="10.0.1.2/24"),
                Interface(number=1, collision_domain="C", ip="10.0.2.2/24"),
            ],
        ),
    ]
    return Topology(name="ospf-triangle", author="test", nodes=nodes)


def test_kathara_reads_our_generated_lab(tmp_path: Path, triangle: Topology) -> None:
    lab_dir = write_lab(triangle, tmp_path / "lab")
    lab = LabParser.parse(str(lab_dir))

    assert sorted(lab.machines) == ["r1", "r2", "r3"]
    assert sorted(lab.links) == ["A", "B", "C"]


def test_kathara_sees_the_intended_wiring(tmp_path: Path, triangle: Topology) -> None:
    lab = LabParser.parse(str(write_lab(triangle, tmp_path / "lab")))

    # Each collision domain is a point-to-point link between two routers.
    for cd, expected in (("A", {"r1", "r2"}), ("B", {"r2", "r3"}), ("C", {"r1", "r3"})):
        attached = {
            name
            for name, machine in lab.machines.items()
            if any(i.link.name == cd for i in machine.interfaces.values())
        }
        assert attached == expected, f"collision domain {cd}"


def test_our_comment_block_does_not_confuse_kathara(tmp_path: Path, triangle: Topology) -> None:
    """The metadata is present in the file, yet invisible to Kathara."""
    lab_dir = write_lab(triangle, tmp_path / "lab")
    text = (lab_dir / "lab.conf").read_text()
    assert "kgui:node" in text  # we really did write it

    lab = LabParser.parse(str(lab_dir))
    assert len(lab.machines) == 3  # and Kathara ignored it entirely
    assert "kgui" not in lab.machines


def test_lab_metadata_reaches_kathara(tmp_path: Path, triangle: Topology) -> None:
    lab = LabParser.parse(str(write_lab(triangle, tmp_path / "lab")))
    assert lab.name == "ospf-triangle"


def test_images_reach_kathara(tmp_path: Path) -> None:
    topo = Topology(
        nodes=[Node(name="r1", image="kathara/frr", interfaces=[
            Interface(number=0, collision_domain="A")
        ])]
    )
    lab = LabParser.parse(str(write_lab(topo, tmp_path / "lab")))
    assert lab.machines["r1"].get_image() == "kathara/frr"


# -- generated artifacts ----------------------------------------------


def test_startup_scripts_configure_the_addressing(tmp_path: Path, triangle: Topology) -> None:
    lab_dir = write_lab(triangle, tmp_path / "lab")
    script = (lab_dir / "r1.startup").read_text()
    assert "ip address add 10.0.0.1/24 dev eth0" in script
    assert "ip address add 10.0.2.1/24 dev eth1" in script


def test_no_generated_file_contains_a_carriage_return(tmp_path: Path, triangle: Topology) -> None:
    """The cross-platform guard: CR would break these scripts in the container."""
    lab_dir = write_lab(triangle, tmp_path / "lab")
    written = [p for p in lab_dir.rglob("*") if p.is_file()]
    assert written, "expected the writer to produce files"
    for path in written:
        assert b"\r" not in path.read_bytes(), f"{path.name} contains CR"


def test_frr_daemons_file_enables_the_selected_protocols(
    tmp_path: Path, triangle: Topology
) -> None:
    lab_dir = write_lab(triangle, tmp_path / "lab")
    daemons = (lab_dir / "r1" / "etc" / "frr" / "daemons").read_text()
    assert "ospfd=yes" in daemons
    assert "bgpd=no" in daemons


def test_zebra_is_always_enabled_when_any_daemon_is(tmp_path: Path) -> None:
    """A protocol daemon without zebra yields a router that silently does nothing."""
    topo = Topology(nodes=[Node(name="r1", daemons=["bgpd"])])
    lab_dir = write_lab(topo, tmp_path / "lab")
    assert "zebra=yes" in (lab_dir / "r1" / "etc" / "frr" / "daemons").read_text()


def test_devices_without_daemons_get_no_frr_directory(tmp_path: Path) -> None:
    topo = Topology(nodes=[Node(name="pc1", kind="pc")])
    lab_dir = write_lab(topo, tmp_path / "lab")
    assert not (lab_dir / "pc1" / "etc" / "frr").exists()


def test_unrelated_files_survive_regeneration(tmp_path: Path, triangle: Topology) -> None:
    """A lab directory often also holds a manual or student notes."""
    lab_dir = tmp_path / "lab"
    lab_dir.mkdir()
    manual = lab_dir / "manual.pdf"
    manual.write_bytes(b"%PDF-1.4 fake")

    write_lab(triangle, lab_dir)
    assert manual.read_bytes() == b"%PDF-1.4 fake"


# -- device images ------------------------------------------------------


def test_a_router_reaches_kathara_with_a_routing_image(tmp_path: Path) -> None:
    """A router on kathara/base has no FRR, so no vtysh and no routing at all.

    The editor sets the image when the device is created, because serialize
    only writes an image line when one is set and Kathará's own default is
    kathara/base for everything.
    """
    topo = Topology(
        nodes=[
            Node(
                name="r1",
                kind="router",
                image="kathara/frr",
                interfaces=[Interface(number=0, collision_domain="A")],
            )
        ]
    )
    lab = LabParser.parse(str(write_lab(topo, tmp_path / "lab")))
    assert lab.machines["r1"].get_image() == "kathara/frr"


def test_an_unset_image_still_produces_no_image_line(tmp_path: Path) -> None:
    """Import must stay non-destructive: a lab that named no image keeps
    naming none, so re-exporting it does not silently add one."""
    topo = Topology(
        nodes=[Node(name="r1", interfaces=[Interface(number=0, collision_domain="A")])]
    )
    lab_conf = (write_lab(topo, tmp_path / "lab") / "lab.conf").read_text()
    assert "[image]" not in lab_conf
