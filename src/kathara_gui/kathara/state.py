"""Pulling configuration back out of running containers.

Capability 5, and the half of this application that the prior art has no
answer for at all. A student spends an hour configuring BGP inside a
container; without this, that hour exists only in a running Docker container
and is lost the moment the lab is stopped.

**The running configuration, not the file on disk.** FRR keeps its live
configuration in memory, and `/etc/frr/frr.conf` only matches it if somebody
remembered to `write memory` — which, in a teaching lab, is exactly what
nobody does. So the capture asks the daemon what it is actually running,
through `vtysh`, rather than reading a file that is usually stale.

What is captured is written into the lab directory at
`<device>/etc/frr/frr.conf`, which is where Kathará copies files from on the
next deployment. Hibernating and resuming is therefore just capture, then
deploy — no separate restore step, and the same files travel inside a `.kgui`
package.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from Kathara.manager.Kathara import Kathara
from Kathara.parser.netkit.LabParser import LabParser

from kathara_gui.domain.model import Topology
from kathara_gui.fsutil import write_text_lf

__all__ = ["Captured", "CaptureReport", "capture", "recover_addresses", "parse_ip_addr"]

#: Where FRR reads its configuration from inside the container, and therefore
#: where a captured configuration has to be placed to be restored.
FRR_CONFIG = "etc/frr/frr.conf"

#: `show running-config` prefaces the configuration with progress chatter that
#: is not valid configuration. Everything before the first of these is dropped.
_CONFIG_STARTS = ("!", "frr version", "frr defaults", "hostname")


@dataclass(frozen=True)
class Captured:
    device: str
    #: Path relative to the lab directory.
    path: str
    lines: int


@dataclass
class CaptureReport:
    captured: list[Captured] = field(default_factory=list)
    #: Devices nothing was taken from, and why. Reported rather than hidden:
    #: silence would look like success.
    skipped: list[tuple[str, str]] = field(default_factory=list)
    message: str | None = None

    @property
    def any_captured(self) -> bool:
        return bool(self.captured)


def clean_running_config(output: str) -> str:
    """Strip `vtysh` chatter, leaving only the configuration itself.

    ``show running-config`` begins with lines such as "Building
    configuration..." and a blank line, which are progress output rather than
    configuration and would be rejected if fed back to FRR.
    """
    lines = output.replace("\r\n", "\n").split("\n")
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(_CONFIG_STARTS):
            return "\n".join(lines[index:]).strip() + "\n"
    return ""


def _run(manager: Any, lab: Any, device: str, command: list[str]) -> tuple[str, int]:
    try:
        stdout, _, exit_code = manager.exec(
            device,
            command,
            lab=lab,
            # Never wait=True: it polls stdin, which no web backend has.
            wait=False,
            stream=False,
        )
    except Exception as exc:  # noqa: BLE001 - a stopped container is a result
        return str(exc), 1

    text = stdout.decode(errors="replace") if isinstance(stdout, bytes) else str(stdout or "")
    return text, exit_code


#: A line of `ip -o -4 addr show`, e.g.
#: ``2: eth0    inet 10.0.0.1/24 brd ... scope global eth0``
_IP_ADDR_LINE = re.compile(r"^\d+:\s+(\w+)\s+inet\s+(\S+)", re.MULTILINE)

_ETH = re.compile(r"^eth(\d+)$")


def parse_ip_addr(output: str) -> dict[int, str]:
    """Addresses reported by ``ip -o -4 addr show``, by interface number.

    Loopback and anything not called ``ethN`` is ignored: the model has no
    place for them, and Kathará numbers a device's links as ``eth0`` upwards.
    """
    found: dict[int, str] = {}
    for device, address in _IP_ADDR_LINE.findall(output):
        number = _ETH.match(device)
        if not number:
            continue
        try:
            cidr = str(ipaddress.ip_interface(address))
        except ValueError:
            continue
        found.setdefault(int(number.group(1)), cidr)
    return found


def recover_addresses(topology: Topology, lab_dir: Path) -> Topology:
    """Read each running device's live interface addresses into the topology.

    This is how a capture works for a PC. A host keeps no routing daemon, so
    there is nothing for ``vtysh`` to report; its addressing lives in
    ``<device>.startup``, which is *generated from the model*. Writing that file
    directly would be overwritten by the next save and would leave the canvas
    showing an address the device no longer has — so the model is what gets
    updated, and the file follows from it.

    Overwrites addresses that differ, because the running device is the
    authority here: the user changed it there deliberately and asked for it to
    be captured.
    """
    lab_dir = Path(lab_dir)
    if not topology.nodes:
        return topology

    manager = Kathara.get_instance()
    try:
        lab = LabParser.parse(str(lab_dir))
    except Exception:  # noqa: BLE001 - no lab on disk means nothing is running
        return topology

    nodes = []
    for node in topology.nodes:
        output, exit_code = _run(manager, lab, node.name, ["ip", "-o", "-4", "addr", "show"])
        live = parse_ip_addr(output) if exit_code == 0 else {}

        if not live:
            nodes.append(node)
            continue

        interfaces = [
            iface.model_copy(update={"ip": live[iface.number]})
            if iface.number in live and live[iface.number] != iface.ip
            else iface
            for iface in node.interfaces
        ]
        nodes.append(node.model_copy(update={"interfaces": interfaces}))

    return topology.model_copy(update={"nodes": nodes})


def capture(topology: Topology, lab_dir: Path) -> CaptureReport:
    """Capture what each running device is configured with, into ``lab_dir``.

    Blocking, like the rest of this package; expose it through a synchronous
    endpoint so FastAPI runs it in a threadpool.
    """
    lab_dir = Path(lab_dir)
    if not topology.nodes:
        return CaptureReport(message="There is nothing to capture.")

    manager = Kathara.get_instance()
    try:
        lab = LabParser.parse(str(lab_dir))
    except Exception as exc:  # noqa: BLE001
        return CaptureReport(
            message=f"The lab is not on disk. Deploy it before capturing. ({exc})"
        )

    report = CaptureReport()

    for node in topology.nodes:
        output, exit_code = _run(
            manager, lab, node.name, ["vtysh", "-c", "show running-config"]
        )

        if exit_code != 0:
            # No vtysh, or the device is not running. Either way there is no
            # routing configuration to take, which is normal for a PC.
            report.skipped.append((node.name, "no running FRR configuration"))
            continue

        config = clean_running_config(output)
        if not config:
            report.skipped.append((node.name, "FRR returned no configuration"))
            continue

        target = lab_dir / node.name / FRR_CONFIG
        write_text_lf(target, config)
        report.captured.append(
            Captured(
                device=node.name,
                path=f"{node.name}/{FRR_CONFIG}",
                lines=len(config.strip().splitlines()),
            )
        )

    if not report.captured:
        report.message = (
            "Nothing to capture: no device is running a routing configuration. "
            "Deploy the lab and configure a router first."
        )
    return report
