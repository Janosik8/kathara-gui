"""Hibernating a lab: configure, capture, stop, redeploy, and find it intact.

This is Capability 5 end to end, and the thing the prior art cannot do at all.
Requires a running Docker daemon; enable with ``pytest -m docker``.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from kathara_gui.domain.model import Interface, Node, Topology
from kathara_gui.kathara import runner, state
from kathara_gui.project import scenario

pytestmark = pytest.mark.docker

#: FRR rather than the base image: there is no routing daemon to interrogate
#: otherwise, which is the whole point here.
IMAGE = "kathara/frr"


@pytest.fixture
def lab_dir(tmp_path: Path) -> Path:
    return tmp_path / "labs" / "capture"


@pytest.fixture
def topology() -> Iterator[Topology]:
    yield Topology(
        name="kgui-capture-integration",
        nodes=[
            Node(
                name="r1",
                image=IMAGE,
                daemons=["zebra", "bgpd"],
                interfaces=[Interface(number=0, collision_domain="A", ip="172.31.21.1/24")],
            )
        ],
    )


@pytest.fixture
def deployed(topology: Topology, lab_dir: Path) -> Iterator[Topology]:
    runner.deploy(topology, lab_dir, confirm=True)
    try:
        yield topology
    finally:
        runner.undeploy(topology, lab_dir)


def configure(topology: Topology, lab_dir: Path, command: str) -> None:
    """Configure the router the way a student would, inside the container."""
    from Kathara.manager.Kathara import Kathara
    from Kathara.parser.netkit.LabParser import LabParser

    lab = LabParser.parse(str(lab_dir))
    Kathara.get_instance().exec(
        "r1",
        ["vtysh", "-c", "configure terminal", "-c", command],
        lab=lab,
        wait=False,
        stream=False,
    )


def test_captures_configuration_typed_inside_the_container(
    deployed: Topology, lab_dir: Path
) -> None:
    configure(deployed, lab_dir, "router bgp 65001")

    report = state.capture(deployed, lab_dir)

    assert report.any_captured
    assert report.captured[0].device == "r1"
    written = (lab_dir / "r1" / "etc" / "frr" / "frr.conf").read_text()
    assert "router bgp 65001" in written


def test_the_capture_is_valid_configuration_not_chatter(
    deployed: Topology, lab_dir: Path
) -> None:
    configure(deployed, lab_dir, "router bgp 65001")
    state.capture(deployed, lab_dir)

    written = (lab_dir / "r1" / "etc" / "frr" / "frr.conf").read_text()
    assert "Building configuration" not in written
    assert "\r" not in written  # it runs inside a Linux container


def test_configuration_survives_a_stop_and_redeploy(
    deployed: Topology, lab_dir: Path
) -> None:
    """The hibernate-and-resume loop: capture, stop, deploy, still there."""
    configure(deployed, lab_dir, "router bgp 65099")
    state.capture(deployed, lab_dir)

    runner.undeploy(deployed, lab_dir)
    runner.deploy(deployed, lab_dir, confirm=True)

    from Kathara.manager.Kathara import Kathara
    from Kathara.parser.netkit.LabParser import LabParser

    lab = LabParser.parse(str(lab_dir))
    stdout, _, _ = Kathara.get_instance().exec(
        "r1", ["vtysh", "-c", "show running-config"], lab=lab, wait=False, stream=False
    )
    assert "65099" in stdout.decode(errors="replace")


def test_a_captured_lab_travels_inside_an_export(
    deployed: Topology, lab_dir: Path, tmp_path: Path
) -> None:
    """Capability 5's exam submission: one file carrying the student's work."""
    configure(deployed, lab_dir, "router bgp 65123")
    state.capture(deployed, lab_dir)
    scenario.save(deployed, lab_dir)

    archive = scenario.export_zip(lab_dir, tmp_path / "submission.zip")

    # The instructor opens it elsewhere and finds both topology and config.
    marking = scenario.import_archive(archive, tmp_path / "marking")
    assert scenario.load(marking).topology.node("r1") is not None
    assert "65123" in (marking / "r1" / "etc" / "frr" / "frr.conf").read_text()


def test_captured_addresses_reach_the_model(deployed: Topology, lab_dir: Path) -> None:
    """A PC keeps no routing daemon, so its addressing lives in the model.

    Configuring an address by hand and capturing has to change what the canvas
    shows, or the interface goes on reporting an address the device no longer
    has — and the next save would write the stale one back.
    """
    from Kathara.manager.Kathara import Kathara
    from Kathara.parser.netkit.LabParser import LabParser

    lab = LabParser.parse(str(lab_dir))
    manager = Kathara.get_instance()
    original = deployed.node("r1").interfaces[0].ip
    assert original

    # What "I changed the IP address" actually means inside a container.
    for command in (
        ["ip", "address", "del", original, "dev", "eth0"],
        ["ip", "address", "add", "10.77.77.77/24", "dev", "eth0"],
    ):
        manager.exec("r1", command, lab=lab, wait=False, stream=False)

    recovered = state.recover_addresses(deployed, lab_dir)
    addresses = [i.ip for node in recovered.nodes if node.name == "r1" for i in node.interfaces]
    assert addresses == ["10.77.77.77/24"]


def test_a_secondary_address_does_not_displace_the_primary(
    deployed: Topology, lab_dir: Path
) -> None:
    """The model holds one address per interface, so the first one wins.

    Adding a second address is not the same as changing the first, and
    silently promoting it would rewrite a topology the user did not edit.
    """
    from Kathara.manager.Kathara import Kathara
    from Kathara.parser.netkit.LabParser import LabParser

    lab = LabParser.parse(str(lab_dir))
    original = deployed.node("r1").interfaces[0].ip
    Kathara.get_instance().exec(
        "r1", ["ip", "address", "add", "10.88.88.88/24", "dev", "eth0"],
        lab=lab, wait=False, stream=False,
    )

    recovered = state.recover_addresses(deployed, lab_dir)
    assert recovered.node("r1").interfaces[0].ip == original


def test_a_device_without_routing_is_skipped_not_failed(lab_dir: Path) -> None:
    topology = Topology(
        name="kgui-capture-plain",
        nodes=[
            Node(
                name="pc1",
                kind="pc",
                image="kathara/base",
                interfaces=[Interface(number=0, collision_domain="A", ip="172.31.22.1/24")],
            )
        ],
    )
    try:
        runner.deploy(topology, lab_dir, confirm=True)
        report = state.capture(topology, lab_dir)

        assert report.any_captured is False
        assert report.skipped == [("pc1", "no running FRR configuration")]
        assert report.message is not None
    finally:
        runner.undeploy(topology, lab_dir)


def test_capturing_before_deploying_explains_itself(topology: Topology, tmp_path: Path) -> None:
    report = state.capture(topology, tmp_path / "never-written")
    assert report.any_captured is False
    assert report.message is not None
    assert "Deploy it" in report.message


# -- loopbacks (bugs 28 and 30) ------------------------------------------------


@pytest.fixture
def with_loopback(lab_dir: Path) -> Iterator[Topology]:
    topology = Topology(
        name="kgui-loopback-integration",
        nodes=[
            Node(
                name="r1",
                image=IMAGE,
                daemons=["zebra"],
                loopbacks=["10.255.0.1/32"],
                interfaces=[Interface(number=0, collision_domain="A", ip="172.31.22.1/24")],
            )
        ],
    )
    runner.deploy(topology, lab_dir, confirm=True)
    try:
        yield topology
    finally:
        runner.undeploy(topology, lab_dir)


def shell(lab_dir: Path, command: list[str]) -> str:
    from Kathara.manager.Kathara import Kathara
    from Kathara.parser.netkit.LabParser import LabParser

    lab = LabParser.parse(str(lab_dir))
    stdout, _, _ = Kathara.get_instance().exec("r1", command, lab=lab, wait=False, stream=False)
    return stdout.decode(errors="replace") if isinstance(stdout, bytes) else str(stdout)


def test_a_loopback_from_the_canvas_is_on_lo_in_the_container(
    with_loopback: Topology, lab_dir: Path
) -> None:
    assert "10.255.0.1/32" in shell(lab_dir, ["ip", "-o", "-4", "addr", "show", "dev", "lo"])


def test_a_loopback_added_inside_the_container_is_captured_into_the_startup_file(
    with_loopback: Topology, lab_dir: Path
) -> None:
    """Bug 30: "I set a lo address but capturing did not put it in the startup files"."""
    shell(lab_dir, ["ip", "address", "add", "10.255.0.2/32", "dev", "lo"])

    updated = state.recover_addresses(with_loopback, lab_dir)
    assert updated.node("r1").loopbacks == ["10.255.0.1/32", "10.255.0.2/32"]

    # The .startup file follows the model, as the capture endpoint does.
    scenario.save(updated, lab_dir)
    assert "ip address add 10.255.0.2/32 dev lo" in (lab_dir / "r1.startup").read_text()
