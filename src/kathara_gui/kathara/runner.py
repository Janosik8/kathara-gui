"""Deploying a topology and reporting what is actually running.

Every call here blocks — deploying pulls images and starts containers — so the
API layer must expose these through synchronous endpoints, which FastAPI runs
in a threadpool. Calling them from an ``async def`` would stall the event loop
and freeze the whole interface for the duration of a deployment.

Never uses Kathará's ``wait=True``: it polls ``sys.stdin`` for a keypress so a
CLI user can skip the wait, which a web backend has no way to satisfy. See
:mod:`kathara_gui.kathara.readiness`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

from Kathara.manager.Kathara import Kathara
from Kathara.parser.netkit.LabParser import LabParser

from kathara_gui.domain.model import Topology
from kathara_gui.kathara.readiness import StartupTimeout, wait_for_lab
from kathara_gui.project.labdir import write_lab

__all__ = [
    "DeviceState",
    "DeviceStatus",
    "LabStatus",
    "deploy",
    "undeploy",
    "status",
]


class DeviceState(StrEnum):
    RUNNING = "running"
    #: In the topology but not deployed.
    STOPPED = "stopped"
    #: Running, but no longer in the topology — the user deleted it after
    #: deploying, or a stale container was left behind.
    ORPHANED = "orphaned"


@dataclass(frozen=True)
class DeviceStatus:
    name: str
    state: DeviceState


@dataclass
class LabStatus:
    """What is running, compared with what the topology says should be.

    The comparison is the point. A user can stop containers from a terminal at
    any time, so the interface must reconcile rather than assume its last
    action still holds.
    """

    devices: list[DeviceStatus] = field(default_factory=list)
    lab_dir: str | None = None
    message: str | None = None

    @property
    def running(self) -> list[str]:
        return [d.name for d in self.devices if d.state is DeviceState.RUNNING]

    @property
    def orphaned(self) -> list[str]:
        return [d.name for d in self.devices if d.state is DeviceState.ORPHANED]

    @property
    def deployed(self) -> bool:
        return bool(self.running)


def _load(topology: Topology, lab_dir: Path) -> tuple[Any, Path]:
    """Write the lab to ``lab_dir`` and hand it to Kathará's parser.

    Deployment goes through the generated files rather than an in-memory Lab
    so that what runs is exactly what the user would get by exporting — if the
    two ever diverged, a lab that worked in the GUI could fail when shared.

    The directory is passed in rather than derived here: Kathará identifies a
    lab by its path, so the caller that knows where the project lives must be
    the one to decide.
    """
    directory = write_lab(topology, Path(lab_dir))
    return LabParser.parse(str(directory)), directory


def deploy(topology: Topology, lab_dir: Path, *, timeout: float = 180.0) -> LabStatus:
    """Start every device in ``topology``, replacing the lab if it is running.

    Deploying over a running lab used to raise ``MachineAlreadyExistsError``
    straight out of Kathará. That made the ordinary working loop — edit,
    deploy, look, edit again — fail unless the user remembered to press Stop
    in between, which is exactly the friction this tool exists to remove.

    So a redeploy tears the old lab down first. The containers are rebuilt
    from the generated files either way, so nothing is preserved across a
    deploy that would not also be lost on a stop; anything worth keeping
    should be exported first (Capability 5).
    """
    if not topology.nodes:
        return LabStatus(message="There is nothing to deploy.")

    manager = Kathara.get_instance()
    notes: list[str] = []

    existing = status(topology, lab_dir)
    if existing.deployed:
        notes.append(f"Replaced the running lab ({len(existing.running)} devices).")
        undeploy(topology, lab_dir)

    try:
        lab, directory = _load(topology, lab_dir)
        manager.deploy_lab(lab)
    except Exception as exc:  # noqa: BLE001 - surfaced to the user, not raised
        # Anything Kathará or Docker refuses: an image that cannot be pulled,
        # a name still held by a container we did not manage to remove. A
        # readable message beats a 500 and a stack trace.
        return LabStatus(message=f"Could not deploy: {_reason(exc)}")

    try:
        wait_for_lab(manager, lab, timeout=timeout)
    except StartupTimeout as exc:
        # The containers exist; their startup scripts have not finished. Worth
        # reporting, but not worth tearing the lab down over.
        notes.append(str(exc))

    result = status(topology, lab_dir)
    result.lab_dir = str(directory)
    result.message = " ".join(notes) or None
    return result


def _reason(exc: Exception) -> str:
    """Kathará's own wording where it has one, else the exception text."""
    text = str(exc).strip()
    return text or exc.__class__.__name__


def undeploy(topology: Topology, lab_dir: Path) -> LabStatus:
    """Stop everything belonging to this lab."""
    manager = Kathara.get_instance()
    try:
        lab, _ = _load(topology, lab_dir)
        manager.undeploy_lab(lab=lab)
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        return LabStatus(message=f"Could not stop the lab cleanly: {exc}")
    return status(topology, lab_dir)


def status(topology: Topology, lab_dir: Path) -> LabStatus:
    """Reconcile the topology against what Docker is actually running."""
    manager = Kathara.get_instance()

    try:
        lab, directory = _load(topology, lab_dir)
    except Exception as exc:  # noqa: BLE001
        return LabStatus(message=f"Could not read the lab: {exc}")

    expected = {node.name for node in topology.nodes}
    running: set[str] = set()

    for name in expected:
        try:
            stats = next(manager.get_machine_stats(name, lab=lab), None)
        except Exception:  # noqa: BLE001 - a missing container is not an error
            stats = None
        if stats is not None:
            running.add(name)

    devices = [
        DeviceStatus(name, DeviceState.RUNNING if name in running else DeviceState.STOPPED)
        for name in sorted(expected)
    ]
    return LabStatus(devices=devices, lab_dir=str(directory))
