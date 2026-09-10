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
from Kathara.utils import generate_urlsafe_hash

from kathara_gui.domain.model import Topology
from kathara_gui.kathara.readiness import StartupTimeout, wait_for_lab
from kathara_gui.project.labdir import write_lab

__all__ = [
    "DeviceState",
    "DeviceStatus",
    "LabStatus",
    "Conflicts",
    "find_conflicts",
    "deploy",
    "undeploy",
    "status",
]


class DeviceState(StrEnum):
    RUNNING = "running"
    #: In the topology but not deployed.
    STOPPED = "stopped"
    #: The container exists but is not running. Docker does not restart
    #: Kathará containers, so a daemon restart, a machine sleeping overnight or
    #: a manual ``docker stop`` all leave the lab in this state: ``kathara
    #: list`` still shows the devices, and ``kathara connect`` fails with a 409
    #: "container is not running". Distinct from STOPPED because the name is
    #: still taken — deploying again needs the old containers removed first.
    EXITED = "exited"
    #: Running, but no longer in the topology — the user deleted it after
    #: deploying, or a stale container was left behind.
    ORPHANED = "orphaned"


@dataclass(frozen=True)
class DeviceStatus:
    name: str
    state: DeviceState


@dataclass(frozen=True)
class Conflicts:
    """Devices already present under the lab name we are about to deploy.

    Present, not running: a container that has exited still owns its name, so
    it blocks a fresh deployment just as a live one does and must be cleared
    the same way.

    Kathará identifies a lab by a hash of its **name**, not its directory
    (``Lab.hash = generate_urlsafe_hash(name)``). Two labs called "untitled" in
    different folders are therefore the same lab as far as Kathará is
    concerned, and deploying one stops the other.

    That is why this cannot be resolved automatically: a redeploy of your own
    lab and a clobbering of somebody else's are indistinguishable from here.
    Only the user knows which it is, so only the user can decide.
    """

    lab_name: str
    #: Existing devices whose names are in the topology being deployed.
    expected: tuple[str, ...] = ()
    #: Present under this lab name but absent from the topology. A strong hint
    #: that a *different* lab is using the same name.
    unexpected: tuple[str, ...] = ()

    @property
    def exists(self) -> bool:
        return bool(self.expected or self.unexpected)

    @property
    def all_devices(self) -> tuple[str, ...]:
        return tuple(sorted({*self.expected, *self.unexpected}))


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
    #: Set when a deploy stopped to ask. Nothing was changed.
    conflicts: Conflicts | None = None

    @property
    def needs_confirmation(self) -> bool:
        return self.conflicts is not None

    @property
    def running(self) -> list[str]:
        return [d.name for d in self.devices if d.state is DeviceState.RUNNING]

    @property
    def exited(self) -> list[str]:
        return [d.name for d in self.devices if d.state is DeviceState.EXITED]

    @property
    def orphaned(self) -> list[str]:
        return [d.name for d in self.devices if d.state is DeviceState.ORPHANED]

    @property
    def deployed(self) -> bool:
        """Whether any container exists, running or not.

        Exited devices count: they still hold their names, so the lab needs
        undeploying before it can be deployed again. Ask :attr:`running` when
        the question is whether the lab actually works.
        """
        return bool(self.running or self.exited)


def find_conflicts(topology: Topology, lab_dir: Path) -> Conflicts:
    """What already exists under this topology's lab name.

    Computed from the name alone, so nothing is written to disk just to find
    out whether asking is necessary. Includes containers that have exited,
    because those still occupy the names we are about to claim.
    """
    our_hash = generate_urlsafe_hash(topology.name)
    ours = {node.name for node in topology.nodes}

    present: set[str] = set()
    try:
        manager = Kathara.get_instance()
        for batch in manager.get_machines_stats():
            for stats in batch.values():
                if getattr(stats, "lab_hash", None) == our_hash:
                    present.add(stats.name)
            break  # the generator re-polls; one snapshot is enough
    except Exception:  # noqa: BLE001 - no daemon means nothing is running
        return Conflicts(lab_name=topology.name)

    return Conflicts(
        lab_name=topology.name,
        expected=tuple(sorted(present & ours)),
        unexpected=tuple(sorted(present - ours)),
    )


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


def deploy(
    topology: Topology, lab_dir: Path, *, confirm: bool = False, timeout: float = 180.0
) -> LabStatus:
    """Start every device in ``topology``, after clearing the way if asked.

    Deploying over a running lab raises ``MachineAlreadyExistsError`` from
    Kathará, so something already running has to be stopped first. But
    stopping it is not always harmless: Kathará keys a lab by a hash of its
    *name*, so a lab called "untitled" in one folder and another called
    "untitled" elsewhere are the same lab to it, and "replacing" one destroys
    the other.

    With ``confirm=False`` this therefore reports the conflict and changes
    nothing, leaving the decision to the user. With ``confirm=True`` it stops
    what is running and deploys.
    """
    if not topology.nodes:
        return LabStatus(message="There is nothing to deploy.")

    manager = Kathara.get_instance()
    notes: list[str] = []

    conflicts = find_conflicts(topology, lab_dir)
    if conflicts.exists and not confirm:
        # Stop and ask. Replacing could be a routine redeploy or could destroy
        # a different lab that happens to share this name; we cannot tell.
        return LabStatus(conflicts=conflicts, lab_dir=str(lab_dir))

    if conflicts.exists:
        count = len(conflicts.all_devices)
        notes.append(f"Stopped {count} device{'s' if count != 1 else ''} already running.")
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
    states: dict[str, DeviceState] = {}

    for name in expected:
        try:
            stats = next(manager.get_machine_stats(name, lab=lab), None)
        except Exception:  # noqa: BLE001 - a missing container is not an error
            stats = None
        states[name] = _state_of(stats)

    devices = [DeviceStatus(name, states[name]) for name in sorted(expected)]
    return LabStatus(devices=devices, lab_dir=str(directory))


def _state_of(stats: Any) -> DeviceState:
    """Read a device's state from Kathará's stats, or its absence.

    Getting stats back is *not* proof of life: Docker keeps reporting a
    container after it stops, so an exited device arrives here with
    ``status == "exited"`` and a pid count of zero. Treating the object's mere
    presence as "running" made the interface claim a healthy lab while every
    ``kathara connect`` failed with a 409.
    """
    if stats is None:
        return DeviceState.STOPPED
    # Anything that is not running cannot be connected to — exited, dead,
    # paused, still being created. The user's next move is the same for all of
    # them, so they do not need separate names here.
    return (
        DeviceState.RUNNING
        if getattr(stats, "status", None) == "running"
        else DeviceState.EXITED
    )
