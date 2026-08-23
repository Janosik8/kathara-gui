"""Verifying that the baseline network actually works.

Capability 4. Before anyone debugs OSPF, it is worth knowing whether two
directly connected interfaces can reach each other at all — the specification's
example is a student who wired eth0 but configured eth1, and spent the lab
hunting an adjacency problem that was never a routing problem.

Each collision domain is checked pairwise. Everything sharing a domain shares a
wire, so every member should reach every other; a pair that cannot is a
baseline fault, whatever the routing configuration says.

Blocking, like the rest of :mod:`kathara_gui.kathara`. Expose it through a
synchronous endpoint so FastAPI runs it in a threadpool.
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from Kathara.manager.Kathara import Kathara
from Kathara.parser.netkit.LabParser import LabParser

from kathara_gui.domain.model import Topology
from kathara_gui.kathara.runner import lab_dir_for

__all__ = ["Outcome", "LinkCheck", "DiagnosticsReport", "verify"]

PING_COUNT = 2
PING_TIMEOUT_SECONDS = 2


class Outcome(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    #: Could not be tested — no address, or the device is not running.
    SKIPPED = "skipped"


@dataclass(frozen=True)
class LinkCheck:
    collision_domain: str
    source: str
    source_interface: int
    target: str
    target_interface: int
    target_address: str | None
    outcome: Outcome
    detail: str = ""


@dataclass
class DiagnosticsReport:
    checks: list[LinkCheck] = field(default_factory=list)
    message: str | None = None

    @property
    def passed(self) -> int:
        return sum(1 for c in self.checks if c.outcome is Outcome.PASS)

    @property
    def failed(self) -> int:
        return sum(1 for c in self.checks if c.outcome is Outcome.FAIL)

    @property
    def skipped(self) -> int:
        return sum(1 for c in self.checks if c.outcome is Outcome.SKIPPED)

    @property
    def healthy(self) -> bool:
        return self.failed == 0 and self.passed > 0


def _host(address: str | None) -> str | None:
    if not address:
        return None
    try:
        return str(ipaddress.ip_interface(address).ip)
    except ValueError:
        return None


def _ping(manager: Any, lab: Any, source: str, target_ip: str) -> tuple[bool, str]:
    try:
        stdout, stderr, exit_code = manager.exec(
            source,
            ["ping", "-c", str(PING_COUNT), "-W", str(PING_TIMEOUT_SECONDS), target_ip],
            lab=lab,
            # Never wait=True: it polls stdin, which no backend has.
            wait=False,
            stream=False,
        )
    except Exception as exc:  # noqa: BLE001 - a dead container is a result, not a crash
        return False, str(exc)

    out = stdout.decode(errors="replace") if isinstance(stdout, bytes) else str(stdout or "")
    err = stderr.decode(errors="replace") if isinstance(stderr, bytes) else str(stderr or "")

    if exit_code == 0:
        summary = next(
            (line.strip() for line in out.splitlines() if "packet loss" in line), "reachable"
        )
        return True, summary

    reason = err.strip() or out.strip()
    return False, reason.splitlines()[-1].strip() if reason else "no reply"


def verify(topology: Topology) -> DiagnosticsReport:
    """Ping between every pair sharing a collision domain."""
    if not topology.nodes:
        return DiagnosticsReport(message="There is nothing to verify.")

    manager = Kathara.get_instance()
    try:
        lab = LabParser.parse(str(lab_dir_for(topology)))
    except Exception as exc:  # noqa: BLE001
        return DiagnosticsReport(
            message=f"The lab is not on disk. Deploy it before verifying. ({exc})"
        )

    report = DiagnosticsReport()

    for domain in topology.referenced_collision_domains():
        members = topology.members(domain)
        if len(members) < 2:
            continue

        for index, (source_node, source_iface) in enumerate(members):
            for target_node, target_iface in members[index + 1 :]:
                target_ip = _host(target_iface.ip)

                if target_ip is None or _host(source_iface.ip) is None:
                    report.checks.append(
                        LinkCheck(
                            domain,
                            source_node.name,
                            source_iface.number,
                            target_node.name,
                            target_iface.number,
                            target_ip,
                            Outcome.SKIPPED,
                            "Both ends need an address before the link can be tested.",
                        )
                    )
                    continue

                ok, detail = _ping(manager, lab, source_node.name, target_ip)
                report.checks.append(
                    LinkCheck(
                        domain,
                        source_node.name,
                        source_iface.number,
                        target_node.name,
                        target_iface.number,
                        target_ip,
                        Outcome.PASS if ok else Outcome.FAIL,
                        detail,
                    )
                )

    if not report.checks:
        report.message = "No collision domain has two addressed devices to test."
    return report
