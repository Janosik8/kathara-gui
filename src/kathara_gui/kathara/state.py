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

__all__ = [
    "Captured",
    "CaptureReport",
    "capture",
    "live_addresses",
    "parse_ip_addr",
    "frr_loopbacks",
    "parse_ip_addr_loopbacks",
    "recover_addresses",
]

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
    #: Loopback addresses each device's FRR configuration holds (F31), which
    #: a capture leaves in ``frr.conf`` rather than copying into the model.
    frr_loopbacks: dict[str, list[str]] = field(default_factory=dict)

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


def parse_ip_addr_loopbacks(output: str) -> list[str]:
    """Addresses on ``lo`` (or an alias such as ``lo:0``) other than 127.0.0.1.

    What a capture reads back as the device's loopbacks (bug 30: an address put
    on ``lo`` inside the container was lost, because only ``ethN`` was read).
    """
    found: list[str] = []
    for device, address in _IP_ADDR_LINE_ANY.findall(output):
        if device.split(":", 1)[0] != "lo":
            continue
        try:
            parsed = ipaddress.ip_interface(address)
        except ValueError:
            continue
        if not parsed.is_loopback and str(parsed) not in found:
            found.append(str(parsed))
    return found


#: As `_IP_ADDR_LINE`, but also matching an alias label such as ``lo:0``.
_IP_ADDR_LINE_ANY = re.compile(r"^\d+:\s+([\w:]+)\s+inet\s+(\S+)", re.MULTILINE)

_FRR_ADDRESS = re.compile(r"^\s+(?:ip|ipv6)\s+address\s+(\S+)")


def frr_loopbacks(config: str) -> list[str]:
    """Addresses an FRR configuration puts on ``lo`` (``interface lo``, then
    ``ip address …`` or ``ipv6 address …``).

    Finding F31. A loopback set in ``vtysh`` is seen twice by a capture: in the
    running configuration, and on ``lo`` in ``ip addr``. Taken into the model
    as well, it would be written to ``.startup`` too, and removing it in the
    editor would then change nothing, because FRR would put it back. So an
    address FRR holds is left to FRR.
    """
    found: list[str] = []
    inside = False
    for line in config.replace("\r\n", "\n").split("\n"):
        if not line.strip() or line.strip() == "!" or not line[0].isspace():
            # A block ends at "!" or at the next top-level line.
            inside = line.split() == ["interface", "lo"]
            continue
        if inside and (match := _FRR_ADDRESS.match(line)):
            try:
                address = str(ipaddress.ip_interface(match.group(1)))
            except ValueError:
                continue
            if address not in found:
                found.append(address)
    return found


def live_addresses(topology: Topology, lab_dir: Path) -> dict[str, dict[int, str]]:
    """Each running device's actual interface addresses, by device name.

    Cheap enough to ask on every status check — measured at about 50ms per
    container — which is what lets the interface notice a change made inside a
    container rather than waiting to be told.
    """
    lab_dir = Path(lab_dir)
    if not topology.nodes:
        return {}

    manager = Kathara.get_instance()
    try:
        lab = LabParser.parse(str(lab_dir))
    except Exception:  # noqa: BLE001 - no lab on disk means nothing is running
        return {}

    found: dict[str, dict[int, str]] = {}
    for node in topology.nodes:
        output, exit_code = _run(manager, lab, node.name, ["ip", "-o", "-4", "addr", "show"])
        if exit_code == 0:
            observed = parse_ip_addr(output)
            if observed:
                found[node.name] = observed
    return found


def recover_addresses(
    topology: Topology,
    lab_dir: Path,
    frr_owned: dict[str, list[str]] | None = None,
) -> Topology:
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

    ``frr_owned`` names, per device, the loopbacks FRR's own configuration
    holds (:func:`frr_loopbacks`). Those are not copied into the model: they
    are already restored from ``frr.conf``, and a second copy in ``.startup``
    would outlive any attempt to remove them in the editor (F31).
    """
    frr_owned = frr_owned or {}
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
        if exit_code != 0:
            # Not running, or not answering: nothing learned, nothing changed.
            nodes.append(node)
            continue
        live = parse_ip_addr(output)

        interfaces = [
            iface.model_copy(update={"ip": live[iface.number]})
            if iface.number in live and live[iface.number] != iface.ip
            else iface
            for iface in node.interfaces
        ]
        # IPv4 only, as for ethN; an IPv6 loopback in the model is kept rather
        # than dropped for not having been asked about.
        owned = set(frr_owned.get(node.name, []))
        v6 = [a for a in node.loopbacks if ipaddress.ip_interface(a).version == 6]
        loopbacks = [a for a in parse_ip_addr_loopbacks(output) + v6 if a not in owned]
        nodes.append(node.model_copy(update={"interfaces": interfaces, "loopbacks": loopbacks}))

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

        if owned := frr_loopbacks(config):
            report.frr_loopbacks[node.name] = owned

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
