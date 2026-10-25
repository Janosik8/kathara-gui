"""Loopback addresses (bugs 28 and 30): modelled, written, read back, captured.

``lo`` exists in every container with 127.0.0.1 on it, so a loopback here is
an *extra* address on it: a router ID, or an address that stays reachable
whichever link is down.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from Kathara.parser.netkit.LabParser import LabParser
from pydantic import ValidationError

from kathara_gui.domain.addressing import Severity, validate
from kathara_gui.domain.codec.labconf import parse, serialize
from kathara_gui.domain.codec.startup import parse_loopbacks, render_startup
from kathara_gui.domain.drift import describe_drift
from kathara_gui.domain.model import Interface, Node, Topology
from kathara_gui.kathara import connection, state
from kathara_gui.kathara.state import frr_loopbacks, parse_ip_addr, parse_ip_addr_loopbacks
from kathara_gui.project import scenario
from kathara_gui.project.labdir import write_lab


def router(name: str, *loopbacks: str) -> Node:
    return Node(
        name=name,
        loopbacks=list(loopbacks),
        interfaces=[Interface(number=0, collision_domain="A")],
    )


# -- the model --------------------------------------------------------------


def test_a_loopback_must_be_an_address_in_cidr_form() -> None:
    with pytest.raises(ValidationError, match="not a valid loopback"):
        router("r1", "abc")


def test_127_is_refused_because_every_container_has_it() -> None:
    with pytest.raises(ValidationError, match="already on lo"):
        router("r1", "127.0.0.2/8")


# -- lab.conf ---------------------------------------------------------------


def test_loopbacks_round_trip_through_lab_conf() -> None:
    topology = Topology(nodes=[router("r1", "10.255.0.1/32", "10.255.0.11/32"), router("r2")])
    text = serialize(topology)
    assert "# kgui:lo r1 ip=10.255.0.1/32,10.255.0.11/32" in text
    assert "kgui:lo r2" not in text
    parsed = parse(text).topology
    assert parsed.node("r1").loopbacks == ["10.255.0.1/32", "10.255.0.11/32"]
    assert parsed.node("r2").loopbacks == []


def test_kathara_still_reads_the_lab(tmp_path: Path) -> None:
    lab = LabParser.parse(str(write_lab(Topology(nodes=[router("r1", "1.1.1.1/32")]), tmp_path)))
    assert "r1" in lab.machines


# -- the .startup script ----------------------------------------------------


def test_the_startup_script_puts_each_address_on_lo() -> None:
    script = render_startup(router("r1", "10.255.0.1/32", "2001:db8::1/128"))
    assert "ip address add 10.255.0.1/32 dev lo" in script
    assert "ip address add 2001:db8::1/128 dev lo" in script


def test_a_lab_written_by_hand_keeps_its_loopbacks() -> None:
    script = "\n".join(
        [
            "ip addr add 10.0.0.1/24 dev eth0",
            "ip address add 1.1.1.1/32 dev lo",
            "ifconfig lo:0 2.2.2.2 netmask 255.255.255.255",
            "ip a add 127.0.0.1/8 dev lo  # already there; not ours",
            "# ip address add 9.9.9.9/32 dev lo",
        ]
    )
    assert parse_loopbacks(script) == ["1.1.1.1/32", "2.2.2.2/32"]


def test_opening_a_lab_recovers_its_loopbacks(tmp_path: Path) -> None:
    folder = tmp_path / "foreign"
    folder.mkdir()
    (folder / "lab.conf").write_text('r1[0]="A"\nr2[0]="A"\n', encoding="utf-8")
    (folder / "r1.startup").write_text(
        "ip address add 10.0.0.1/24 dev eth0\nip address add 1.1.1.1/32 dev lo\n",
        encoding="utf-8",
    )
    opened = scenario.load(folder).topology
    assert opened.node("r1").loopbacks == ["1.1.1.1/32"]
    assert opened.node("r1").interfaces[0].ip == "10.0.0.1/24"


# -- capture (bug 30) -------------------------------------------------------

IP_ADDR = """\
1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever
1: lo    inet 10.255.0.1/32 scope global lo\\       valid_lft forever preferred_lft forever
1: lo:0    inet 10.255.0.2/32 scope global lo:0\\       valid_lft forever
2: eth0    inet 10.0.0.1/24 brd 10.0.0.255 scope global eth0\\       valid_lft forever
"""


def test_the_live_loopbacks_are_read_without_127() -> None:
    assert parse_ip_addr_loopbacks(IP_ADDR) == ["10.255.0.1/32", "10.255.0.2/32"]
    # And ethN is read as before, untouched by the alias form.
    assert parse_ip_addr(IP_ADDR) == {0: "10.0.0.1/24"}


# -- checks -----------------------------------------------------------------


def test_one_loopback_on_two_devices_is_a_warning() -> None:
    topology = Topology(nodes=[router("r1", "1.1.1.1/32"), router("r2", "1.1.1.1/32")])
    issues = [i for i in validate(topology) if i.code == "duplicate_loopback"]
    assert [i.severity for i in issues] == [Severity.WARNING]
    assert issues[0].devices == ("r1", "r2")


def test_a_changed_loopback_is_drift() -> None:
    deployed = Topology(nodes=[router("r1", "1.1.1.1/32")])
    current = Topology(nodes=[router("r1", "1.1.1.9/32")])
    assert describe_drift(deployed, current) == ["r1 loopback addresses changed to 1.1.1.9/32"]


# -- loopbacks set in FRR (F31) ---------------------------------------------

RUNNING_CONFIG = """\
!
frr version 8.4
hostname r1
!
interface eth0
 ip address 10.0.0.1/24
exit
!
interface lo
 ip address 10.255.9.9/32
 ip address 10.255.9.10/32
 ipv6 address 2001:db8::9/128
exit
!
interface lo1
 ip address 10.9.9.9/32
exit
!
"""


def test_the_addresses_frr_puts_on_lo_are_found() -> None:
    assert frr_loopbacks(RUNNING_CONFIG) == [
        "10.255.9.9/32",
        "10.255.9.10/32",
        "2001:db8::9/128",
    ]
    assert frr_loopbacks("!\nhostname r1\n!\n") == []


def test_a_loopback_frr_holds_is_not_copied_into_the_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Manager:
        def exec(self, device: str, command: list[str], **_: object) -> tuple[bytes, bytes, int]:
            return IP_ADDR.replace("10.255.0.2", "10.255.9.9").encode(), b"", 0

    monkeypatch.setattr(connection.Kathara, "get_instance", staticmethod(Manager))
    monkeypatch.setattr(state.LabParser, "parse", staticmethod(lambda path: object()))
    topology = Topology(nodes=[router("r1", "10.255.0.1/32")])

    plain = state.recover_addresses(topology, tmp_path)
    assert plain.node("r1").loopbacks == ["10.255.0.1/32", "10.255.9.9/32"]

    owned = state.recover_addresses(topology, tmp_path, {"r1": ["10.255.9.9/32"]})
    assert owned.node("r1").loopbacks == ["10.255.0.1/32"]
