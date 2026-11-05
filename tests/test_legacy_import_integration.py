"""Netkit and Quagga labs, imported and deployed: does OSPF actually come up (F60)?

A unit test can show where the files were put; only the routing suite can show
that it reads them. Three labs, the same three routers in two areas: Netkit's
layout with no image, run on ``kathara/quagga`` with ``/etc/zebra`` copied to
``/etc/quagga``; Kathará's Quagga layout, run as it is; and Netkit's layout with
the routers naming ``kathara/frr``, merged into ``frr.conf``. Requires Docker;
``pytest -m docker``.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from kathara_gui.domain.model import Topology
from kathara_gui.kathara import connection, runner, state
from kathara_gui.project.scenario import adopt_legacy_routing, load, set_lab_name
from tests.test_legacy_import import _tick, frr_named_lab, netkit_lab, quagga_lab

pytestmark = pytest.mark.docker

#: OSPF's dead interval is 40 s; an adjacency and the routes behind it come well within.
CONVERGENCE = 90.0


def _deployed(folder: Path, name: str) -> Iterator[tuple[Topology, Path]]:
    set_lab_name(folder, name)
    adopt_legacy_routing(folder)
    topology = load(folder).topology
    report = runner.deploy(topology, folder, confirm=True)
    assert not report.message or "Could not" not in report.message, report.message
    try:
        yield topology, folder
    finally:
        runner.undeploy(topology, folder)


@pytest.fixture
def netkit(tmp_path: Path) -> Iterator[tuple[Topology, Path]]:
    yield from _deployed(netkit_lab(tmp_path / "netkit"), "kgui-netkit-integration")


@pytest.fixture
def frr_named(tmp_path: Path) -> Iterator[tuple[Topology, Path]]:
    yield from _deployed(frr_named_lab(tmp_path / "frr"), "kgui-frr-named-integration")


@pytest.fixture
def quagga(tmp_path: Path) -> Iterator[tuple[Topology, Path]]:
    yield from _deployed(quagga_lab(tmp_path / "quagga"), "kgui-quagga-integration")


def _vtysh(folder: Path, device: str, command: str) -> str:
    from Kathara.parser.netkit.LabParser import LabParser

    lab = LabParser.parse(str(folder))
    output, _ = state._run(connection.manager(), lab, device, ["vtysh", "-c", command])
    return output


def _vtysh_config(folder: Path, device: str, *lines: str) -> None:
    """Configure a router as a student would, in vtysh's configure mode."""
    from Kathara.parser.netkit.LabParser import LabParser

    command = ["vtysh", "-c", "configure terminal"]
    for line in lines:
        command += ["-c", line]
    lab = LabParser.parse(str(folder))
    state._run(connection.manager(), lab, device, command)


def _eventually(check: Callable[[], str], expected: str) -> str:
    deadline = time.monotonic() + CONVERGENCE
    output = ""
    while time.monotonic() < deadline:
        output = check()
        if expected in output:
            return output
        time.sleep(3)
    raise AssertionError(f"{expected!r} never appeared; last output:\n{output}")


def _check_ospf(folder: Path) -> None:
    # bb, the border router, is fully adjacent with r1 in area 0 and r2 in area 1.
    _eventually(lambda: _vtysh(folder, "bb", "show ip ospf neighbor"), "Full")
    # r2, in area 1, learns area 0's network across the border router.
    _eventually(lambda: _vtysh(folder, "r2", "show ip route"), "10.0.0.0/24")
    # And r1 learns pc1's network from inside area 1.
    _eventually(lambda: _vtysh(folder, "r1", "show ip route"), "200.0.0.0/24")


def test_a_netkit_lab_runs_on_quagga(netkit: tuple[Topology, Path]) -> None:
    topology, folder = netkit
    assert {n.image for n in topology.nodes if n.kind == "router"} == {"kathara/quagga"}
    _check_ospf(folder)


def test_a_capture_on_quagga_survives_a_redeploy(netkit: tuple[Topology, Path]) -> None:
    """F61: the capture wrote Quagga's configuration to etc/frr/frr.conf, which
    kathara/quagga never reads, so a redeploy lost it."""
    topology, folder = netkit
    _vtysh_config(folder, "bb", "router ospf", "area 0.0.0.9 stub")
    _eventually(lambda: _vtysh(folder, "bb", "show running-config"), "area 0.0.0.9 stub")

    report = state.capture(topology, folder)

    assert "bb/etc/quagga/ospfd.conf" in [c.path for c in report.captured]
    assert "area 0.0.0.9 stub" in (folder / "bb" / "etc" / "quagga" / "ospfd.conf").read_text()
    assert not (folder / "bb" / "etc" / "frr").exists()

    runner.undeploy(topology, folder)
    runner.deploy(topology, folder, confirm=True)
    _eventually(lambda: _vtysh(folder, "bb", "show running-config"), "area 0.0.0.9 stub")


def test_bgp_ticked_on_a_quagga_router_runs_and_is_captured(tmp_path: Path) -> None:
    """F62: ticking BGP on an imported Quagga router wrote bgpd=yes but no
    bgpd.conf, so the image never started bgpd and vtysh dropped "router bgp 1"."""
    folder = netkit_lab(tmp_path / "netkit")
    set_lab_name(folder, "kgui-quagga-bgp-integration")
    adopt_legacy_routing(folder)
    topology = _tick(load(folder).topology, "bb", "bgpd")
    runner.deploy(topology, folder, confirm=True)
    try:
        _vtysh_config(folder, "bb", "router bgp 65001", "bgp router-id 9.9.9.9")
        _eventually(lambda: _vtysh(folder, "bb", "show running-config"), "router bgp 65001")

        report = state.capture(topology, folder)

        assert "bb/etc/quagga/bgpd.conf" in [c.path for c in report.captured]
        bgpd = (folder / "bb" / "etc" / "quagga" / "bgpd.conf").read_text()
        assert "router bgp 65001" in bgpd

        runner.undeploy(topology, folder)
        runner.deploy(topology, folder, confirm=True)
        _eventually(lambda: _vtysh(folder, "bb", "show running-config"), "router bgp 65001")
        # OSPF, from the file imported, still runs beside it.
        _eventually(lambda: _vtysh(folder, "bb", "show ip ospf neighbor"), "Full")
    finally:
        runner.undeploy(topology, folder)


def test_a_netkit_lab_naming_frr_is_converted_and_routes(
    frr_named: tuple[Topology, Path],
) -> None:
    topology, folder = frr_named
    assert {n.image for n in topology.nodes if n.kind == "router"} == {"kathara/frr"}
    _check_ospf(folder)
    # The deprecated "ospf cost 90" under eth0 was converted and taken.
    assert "ip ospf cost 90" in _vtysh(folder, "bb", "show running-config")


def test_a_quagga_lab_still_runs_quagga(quagga: tuple[Topology, Path]) -> None:
    topology, folder = quagga
    assert {n.image for n in topology.nodes if n.kind == "router"} == {"kathara/quagga"}
    _check_ospf(folder)
