"""Capturing a Quagga router writes where Quagga reads (F61).

The capture used to put a Quagga router's whole running configuration in
``etc/frr/frr.conf``, which ``kathara/quagga`` never reads, so the next deploy
lost what was captured. Docker is faked here: ``vtysh`` answers from a table.
The real thing is in ``test_legacy_import_integration.py``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from kathara_gui.domain.model import Interface, Node, Topology
from kathara_gui.kathara import connection, state

RUNNING = "Building configuration...\n\nCurrent configuration:\n!\n"

#: What each daemon of a Quagga router answers to ``vtysh -d``.
QUAGGA = {
    "zebra": RUNNING + "hostname bb0\n!\ninterface eth0\n ip address 10.0.0.3/24\n!\n",
    "ospfd": RUNNING + "hostname ospfd\n!\nrouter ospf\n network 10.0.0.0/16 area 0.0.0.0\n"
    " area 0.0.0.9 stub\n!\n",
}
#: What an FRR router answers to plain ``vtysh -c``.
FRR = RUNNING + "frr version 10\nrouter ospf\n network 10.0.0.0/16 area 0\n!\n"


@pytest.fixture
def commands(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, list[str]]]:
    """Every command run, by device; ``vtysh`` answers as the tables above."""
    seen: list[tuple[str, list[str]]] = []

    def run(manager: Any, lab: Any, device: str, command: list[str]) -> tuple[str, int]:
        seen.append((device, command))
        if command[:2] == ["vtysh", "-d"]:
            text = QUAGGA.get(command[2], "")
            return text, 0 if text else 1
        if command[0] == "vtysh":
            return FRR, 0
        return "", 1

    monkeypatch.setattr(connection, "manager", lambda: object())
    monkeypatch.setattr(state.LabParser, "parse", staticmethod(lambda path: object()))
    monkeypatch.setattr(state, "_run", run)
    return seen


def _topology(image: str) -> Topology:
    return Topology(
        name="t",
        nodes=[
            Node(
                name="bb0",
                image=image,
                daemons=["zebra", "ospfd"],
                interfaces=[Interface(number=0, collision_domain="A", ip="10.0.0.3/24")],
            )
        ],
    )


def test_a_quagga_router_is_captured_daemon_by_daemon(
    tmp_path: Path, commands: list[tuple[str, list[str]]]
) -> None:
    report = state.capture(_topology("kathara/quagga"), tmp_path)

    assert [c.path for c in report.captured] == [
        "bb0/etc/quagga/zebra.conf",
        "bb0/etc/quagga/ospfd.conf",
    ]
    ospfd = (tmp_path / "bb0" / "etc" / "quagga" / "ospfd.conf").read_text()
    assert "area 0.0.0.9 stub" in ospfd
    assert "Building configuration" not in ospfd
    zebra = (tmp_path / "bb0" / "etc" / "quagga" / "zebra.conf").read_text()
    assert "ip address 10.0.0.3/24" in zebra
    assert not (tmp_path / "bb0" / "etc" / "frr").exists()
    assert ("bb0", ["vtysh", "-d", "ospfd", "-c", "show running-config"]) in commands
    # The addresses Quagga holds are known, as FRR's are.
    assert report.frr_addresses["bb0"] == {"eth0": ["10.0.0.3/24"]}
    assert report.quagga == {"bb0"}


def test_a_stray_frr_conf_beside_quagga_is_removed_and_said(
    tmp_path: Path, commands: list[tuple[str, list[str]]]
) -> None:
    """What the capture before F61 left in every Quagga router's folder."""
    frr = tmp_path / "bb0" / "etc" / "frr"
    frr.mkdir(parents=True)
    (frr / "frr.conf").write_text("router ospf\n", encoding="utf-8")
    (frr / "daemons").write_text("ospfd=yes\n", encoding="utf-8")

    report = state.capture(_topology("kathara/quagga"), tmp_path)

    assert report.removed == ["bb0/etc/frr/frr.conf", "bb0/etc/frr/daemons"]
    assert not frr.exists()


def test_an_frr_router_is_captured_as_before(
    tmp_path: Path, commands: list[tuple[str, list[str]]]
) -> None:
    report = state.capture(_topology("kathara/frr"), tmp_path)

    assert [c.path for c in report.captured] == ["bb0/etc/frr/frr.conf"]
    assert not (tmp_path / "bb0" / "etc" / "quagga").exists()
    assert report.quagga == set()
    assert report.removed == []
