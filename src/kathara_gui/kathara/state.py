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
next deployment. A device on a Quagga image runs one process per daemon, each
reading its own `/etc/quagga/<daemon>.conf`, so it is captured daemon by daemon
with ``vtysh -d`` into those files instead (F61). Hibernating and resuming is
therefore just capture, then deploy — no separate restore step, and the same
files travel inside a `.kgui` package.
"""

from __future__ import annotations

import contextlib
import ipaddress
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from Kathara.parser.netkit.LabParser import LabParser

from kathara_gui.domain.model import Node, Topology
from kathara_gui.fsutil import write_text_lf
from kathara_gui.kathara import connection

__all__ = [
    "Captured",
    "CaptureReport",
    "capture",
    "live_addresses",
    "parse_ip_addr",
    "parse_ip_addr_all",
    "frr_interface_addresses",
    "frr_loopbacks",
    "parse_ip_addr_loopbacks",
    "recover_addresses",
]

#: Where FRR reads its configuration from inside the container, and therefore
#: where a captured configuration has to be placed to be restored.
FRR_CONFIG = "etc/frr/frr.conf"

#: Where Quagga reads each daemon's configuration from inside the container.
QUAGGA_DIR = "etc/quagga"


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
    #: Every address each device's FRR configuration holds, by interface name.
    #: An address FRR holds survives a redeploy in ``frr.conf``, so a capture
    #: that leaves it out of the model has not lost it.
    frr_addresses: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    #: Files removed because the device's image never reads them (F61), relative
    #: to the lab directory: an ``frr.conf`` beside a Quagga router's own files.
    removed: list[str] = field(default_factory=list)
    #: Devices whose routing configuration is Quagga's, not FRR's.
    quagga: set[str] = field(default_factory=set)

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
    return {number: addresses[0] for number, addresses in parse_ip_addr_all(output).items()}


def parse_ip_addr_all(output: str) -> dict[int, list[str]]:
    """Every address on each ``ethN``, the primary first.

    The model keeps one address per interface, so a capture keeps the first
    (:func:`parse_ip_addr`); the rest are what it has to say it left out.
    """
    found: dict[int, list[str]] = {}
    for device, address in _IP_ADDR_LINE.findall(output):
        number = _ETH.match(device)
        if not number:
            continue
        try:
            cidr = str(ipaddress.ip_interface(address))
        except ValueError:
            continue
        addresses = found.setdefault(int(number.group(1)), [])
        if cidr not in addresses:
            addresses.append(cidr)
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
    return frr_interface_addresses(config).get("lo", [])


def frr_interface_addresses(config: str) -> dict[str, list[str]]:
    """Addresses an FRR configuration puts on each interface, by its name."""
    found: dict[str, list[str]] = {}
    inside: str | None = None
    for line in config.replace("\r\n", "\n").split("\n"):
        if not line.strip() or line.strip() == "!" or not line[0].isspace():
            # A block ends at "!" or at the next top-level line. The name is
            # the second word: "interface eth0 vrf red" is still eth0.
            words = line.split()
            inside = words[1] if len(words) >= 2 and words[0] == "interface" else None
            continue
        if inside and (match := _FRR_ADDRESS.match(line)):
            try:
                address = str(ipaddress.ip_interface(match.group(1)))
            except ValueError:
                continue
            addresses = found.setdefault(inside, [])
            if address not in addresses:
                addresses.append(address)
    return found


def live_addresses(topology: Topology, lab_dir: Path) -> dict[str, dict[int, str]]:
    """Each running device's actual interface addresses, by device name.

    Cheap enough to ask on every status check — measured at about 50ms per
    container — which is what lets the interface notice a change made inside a
    container rather than waiting to be told.

    A device that answered appears even with no address at all, so that an
    address deleted inside it reads as gone (test 4B.2) rather than as a
    device that could not be read.
    """
    lab_dir = Path(lab_dir)
    if not topology.nodes:
        return {}

    try:
        manager = connection.manager()
        lab = LabParser.parse(str(lab_dir))
    except Exception:  # noqa: BLE001 - no daemon or no lab on disk: nothing is running
        return {}

    found: dict[str, dict[int, str]] = {}
    for node in topology.nodes:
        output, exit_code = _run(manager, lab, node.name, ["ip", "-o", "-4", "addr", "show"])
        if exit_code == 0:
            found[node.name] = parse_ip_addr(output)
    return found


def _is_ipv4(address: str | None) -> bool:
    return address is not None and ipaddress.ip_interface(address).version == 4


def recover_addresses(
    topology: Topology,
    lab_dir: Path,
    frr_owned: dict[str, list[str]] | None = None,
    left_out: dict[str, dict[int, list[str]]] | None = None,
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
    be captured. An IPv4 address the device no longer has is cleared (test
    4B.2): ``ip -o -4 addr`` lists only addressed interfaces, and Kathará
    creates every ``ethN``, so an interface missing from an answer that did
    come back has no address. An IPv6 address is kept, as it was not asked for.

    ``frr_owned`` names, per device, the loopbacks FRR's own configuration
    holds (:func:`frr_loopbacks`). Those are not copied into the model: they
    are already restored from ``frr.conf``, and a second copy in ``.startup``
    would outlive any attempt to remove them in the editor (F31).

    ``left_out``, when given, is filled with the IPv4 addresses the model had
    no place for, per device and ``ethN``: a second address on an interface
    (the model keeps one, the primary), and any address on an ``ethN`` the
    design does not have (test 4B.1 moves one there). Reported rather than
    dropped in silence, which would look like a complete capture.
    """
    frr_owned = frr_owned or {}
    lab_dir = Path(lab_dir)
    if not topology.nodes:
        return topology

    try:
        manager = connection.manager()
        lab = LabParser.parse(str(lab_dir))
    except Exception:  # noqa: BLE001 - no daemon or no lab on disk: nothing is running
        return topology

    nodes = []
    for node in topology.nodes:
        output, exit_code = _run(manager, lab, node.name, ["ip", "-o", "-4", "addr", "show"])
        if exit_code != 0:
            # Not running, or not answering: nothing learned, nothing changed.
            nodes.append(node)
            continue
        every = parse_ip_addr_all(output)
        live = {number: addresses[0] for number, addresses in every.items()}
        if left_out is not None:
            known = {iface.number for iface in node.interfaces}
            extra = {
                number: addresses[1:] if number in known else addresses
                for number, addresses in every.items()
            }
            if extra := {number: a for number, a in extra.items() if a}:
                left_out[node.name] = extra

        interfaces = [
            iface.model_copy(update={"ip": live[iface.number]})
            if iface.number in live and live[iface.number] != iface.ip
            else iface.model_copy(update={"ip": None})
            if iface.number not in live and _is_ipv4(iface.ip)
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

    try:
        manager = connection.manager()
    except connection.DockerUnavailable as exc:
        return CaptureReport(message=str(exc))
    try:
        lab = LabParser.parse(str(lab_dir))
    except Exception as exc:  # noqa: BLE001
        return CaptureReport(
            message=f"The lab is not on disk. Deploy it before capturing. ({exc})"
        )

    report = CaptureReport()

    for node in topology.nodes:
        if node.runs_quagga:
            _capture_quagga(manager, lab, node, lab_dir, report)
            continue
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

        if held := frr_interface_addresses(config):
            report.frr_addresses[node.name] = held
        if owned := held.get("lo"):
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


def _capture_quagga(
    manager: Any, lab: Any, node: Node, lab_dir: Path, report: CaptureReport
) -> None:
    """Capture a Quagga router daemon by daemon, each into its own file (F61).

    Quagga has no integrated ``frr.conf``: each daemon is its own process and
    reads ``/etc/quagga/<daemon>.conf``. ``vtysh -d <daemon>`` asks one daemon
    alone for what it is running, which is exactly that file's content. The
    capture used to write the whole running configuration to ``frr.conf``,
    which ``kathara/quagga`` never reads, so a redeploy lost what was captured.
    """
    texts: list[str] = []
    for daemon in node.quagga_daemons:
        output, exit_code = _run(
            manager, lab, node.name, ["vtysh", "-d", daemon, "-c", "show running-config"]
        )
        config = clean_running_config(output) if exit_code == 0 else ""
        if not config:
            if exit_code != 0 and daemon == "zebra":
                # No vtysh or not running: nothing at all to take.
                report.skipped.append((node.name, "no running Quagga configuration"))
                return
            report.skipped.append((node.name, f"Quagga's {daemon} returned no configuration"))
            continue
        relative = f"{node.name}/{QUAGGA_DIR}/{daemon}.conf"
        write_text_lf(lab_dir / relative, config)
        report.captured.append(
            Captured(device=node.name, path=relative, lines=len(config.strip().splitlines()))
        )
        texts.append(config)

    if not texts:
        return
    report.quagga.add(node.name)
    # Left by the capture before F61, or by an FRR past: never read by Quagga,
    # and taken for the device's configuration by anything reading the folder.
    for name in ("frr.conf", "daemons"):
        stray = lab_dir / node.name / "etc" / "frr" / name
        if stray.is_file():
            stray.unlink()
            report.removed.append(f"{node.name}/etc/frr/{name}")
    with contextlib.suppress(OSError):
        (lab_dir / node.name / "etc" / "frr").rmdir()

    held = frr_interface_addresses("\n".join(texts))
    if held:
        report.frr_addresses[node.name] = held
    if owned := held.get("lo"):
        report.frr_loopbacks[node.name] = owned
