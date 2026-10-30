"""The topology the user is currently editing.

A single in-memory document, held by the server so that the browser can be
reloaded without losing work and so that deployment always acts on the same
topology the canvas shows.

Deliberately not a general multi-document store. The application is local and
single-user; :class:`Session` exists to give that assumption one obvious place
to change when Capability 7 (collaboration) arrives, rather than having the
current topology reached for from a dozen routers.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

from kathara_gui.domain.model import Topology
from kathara_gui.domain.naming import lab_name_problem, safe_dir_name
from kathara_gui.features import Features
from kathara_gui.project import scenario


class ScenarioNameError(ValueError):
    """The lab cannot be written under its name. ``taken`` when another
    scenario has it, or its folder could not be renamed; otherwise the name
    itself is unusable."""

    def __init__(self, message: str, *, taken: bool = False) -> None:
        super().__init__(message)
        self.taken = taken


@dataclass(frozen=True)
class Persisted:
    folder: Path
    #: The folder's previous name, when writing it renamed the folder.
    renamed_from: str | None = None


def folder_name(name: str) -> str:
    """The folder a lab called ``name`` lives in: the name itself (test 3E.2).

    A name the rule refuses, from a lab written elsewhere, still needs a folder
    to be opened from, so it falls back to the old transformation.
    """
    return name if lab_name_problem(name) is None else safe_dir_name(name)


class Session:
    """Holds the topology being edited, plus where it came from on disk.

    Access is mutex-guarded: uvicorn serves requests concurrently, and two
    overlapping writes to a nested model could otherwise interleave.
    """

    def __init__(self, workspace_root: Path | None = None) -> None:
        self._lock = threading.RLock()
        self._topology = Topology(name="untitled")
        self._path: Path | None = None
        # One snapshot per lab folder, not one for the session: a lab keeps
        # running while another scenario is open, and reopening it must find
        # its own snapshot, not the other one's (test 3E.2).
        self._deployed: dict[Path, Topology] = {}
        self._dirty = False
        self._features = Features()
        # Resolved once, at construction. Re-reading the process's working
        # directory later would mean the answer could change under us.
        root = Path(workspace_root) if workspace_root else default_workspace_root()
        self._workspace_root = root.expanduser().resolve()

    @property
    def workspace_root(self) -> Path:
        """Where labs are generated when they have no folder of their own."""
        return self._workspace_root

    def lab_dir(self, topology: Topology | None = None) -> Path:
        """The directory this lab is generated into and deployed from.

        A lab that has been saved somewhere deploys from that folder, so the
        files the user edits and the files that run are the same ones. An
        unsaved lab gets a folder in the workspace named after it.

        ``topology`` names the lab being acted on. Callers must pass the one
        they were given rather than relying on the session's: a deploy
        computes the directory *before* adopting the request, so without this
        a lab called "bgp exam" was written to a folder named after whatever
        the session held before — usually "untitled".
        """
        with self._lock:
            if self._path is not None:
                return self._path
            named = topology if topology is not None else self._topology
            return self._workspace_root / folder_name(named.name)

    def persist(self, topology: Topology, *, copy: bool = False) -> Persisted:
        """Write ``topology`` into the folder named after it, and adopt it.

        One routine for Save, Save as, Export and Deploy, because each of them
        writes the lab to disk, and a deploy that wrote somewhere Save did not
        would leave two copies disagreeing (test 3E.2). The folder is the lab's
        name, exactly:

        - A name another scenario's folder already has is refused. Kathará
          knows a lab by its name, so two folders with one name are one lab to
          it, and deploying either stops the other.
        - A renamed lab's folder is renamed with it, keeping what is in it: a
          captured ``frr.conf``, a manual, notes. Except for ``copy`` (Save
          as), which leaves the original where it is.
        """
        with self._lock:
            name = topology.name
            problem = lab_name_problem(name)
            if problem:
                raise ScenarioNameError(problem)

            target = self._workspace_root / name
            current = None if copy else self._path
            own = current is not None and self._key(current) == self._key(target)
            # Compared case-insensitively whatever the host, so a scenario
            # made on Linux does not collide with another on a Mac.
            taken = self._workspace_root.is_dir() and any(
                child.name.lower() == name.lower() for child in self._workspace_root.iterdir()
            )
            if taken and not own:
                raise ScenarioNameError(
                    f"There is already a scenario called {name!r} in the workspace. "
                    "Open it, or choose another name.",
                    taken=True,
                )

            renamed_from = None
            if current is not None and current.is_dir() and current.name != name:
                try:
                    if own:
                        # Exam to exam: one folder to Windows and macOS, so
                        # through a temporary name.
                        step = current.with_name(f".{current.name}.renaming")
                        current.rename(step)
                        step.rename(target)
                    else:
                        current.rename(target)
                except OSError as exc:
                    raise ScenarioNameError(
                        f"Could not rename the folder {current.name!r} to {name!r}: "
                        f"{exc.strerror or exc}. Close any window or terminal open in "
                        "it, and try again.",
                        taken=True,
                    ) from exc
                renamed_from = current.name

            scenario.save(topology, target, features=self._features)
            self._topology = topology
            self._path = target
            self._dirty = False
            return Persisted(folder=target, renamed_from=renamed_from)

    @property
    def features(self) -> Features:
        """Which assistive features this scenario permits (Capability 8)."""
        with self._lock:
            return self._features

    def adopt_settings(self, features: Features) -> None:
        """The switches of a scenario just opened."""
        with self._lock:
            self._features = features

    def set_features(self, features: Features) -> Features:
        """Change the switches (FR-28), and write them at once."""
        with self._lock:
            self._features = features
            self._write_settings()
            return self._features

    def _write_settings(self) -> None:
        # The switches are the scenario's, not the design's, so they are
        # written at once rather than waiting for the next Save: a switch that
        # waited for Save would look set and not be. A scenario with no
        # folder yet gets them with its first save.
        if self._path is not None and self._path.is_dir():
            scenario.write_settings(self._path, self._features)

    @property
    def topology(self) -> Topology:
        with self._lock:
            return self._topology

    @property
    def path(self) -> Path | None:
        """The scenario folder this topology was opened from or saved to.

        One path, not two. An earlier design kept a `.kgui` package file
        alongside the lab directory, which meant two things could disagree
        about what the scenario was; the folder is now the document, and the
        export is a zip of it.
        """
        with self._lock:
            return self._path

    @property
    def dirty(self) -> bool:
        """True when there are edits not yet written to disk."""
        with self._lock:
            return self._dirty

    def replace(self, topology: Topology, *, dirty: bool = True) -> Topology:
        """Swap in a new topology, e.g. after an edit or an import."""
        with self._lock:
            self._topology = topology
            self._dirty = dirty
            return self._topology

    @property
    def deployed_topology(self) -> Topology | None:
        """The topology as it was when the lab was last deployed.

        Held so the interface can say *how* the canvas has drifted from what is
        running. The running containers cannot answer that themselves: they
        know their own state, not which edits have happened since.

        The snapshot of the lab in the scenario now open, found by its folder.
        """
        with self._lock:
            return self._deployed.get(self._key(self.lab_dir()))

    def mark_deployed(self, topology: Topology | None) -> None:
        """Record what the open scenario's lab was deployed as, or ``None``
        once it is stopped. Other labs' snapshots are left alone."""
        with self._lock:
            key = self._key(self.lab_dir(topology))
            if topology is None:
                self._deployed.pop(key, None)
            else:
                self._deployed[key] = topology

    def forget_deployed(self) -> None:
        """Every lab has been stopped (``kathara wipe``)."""
        with self._lock:
            self._deployed.clear()

    @staticmethod
    def _key(folder: Path) -> Path:
        # Case-insensitive on Windows and macOS, where `Exam` and `exam` are
        # one folder.
        return Path(str(folder).lower())

    def mark_saved(self, folder: Path) -> None:
        """Record that the scenario lives in ``folder`` and is up to date.

        The folder becomes what deployment generates into, so a scenario
        opened from elsewhere runs the files it arrived with — including any
        configuration captured before it was shared.
        """
        with self._lock:
            self._path = Path(folder)
            self._dirty = False

    def reset(self) -> Topology:
        with self._lock:
            self._topology = Topology(name="untitled")
            self._path = None
            self._dirty = False
            # Feature toggles belong to the scenario, so a new one starts
            # from the permissive default rather than inheriting an exam's
            # restrictions.
            self._features = Features()
            return self._topology


def default_workspace_root() -> Path:
    """`kathara-labs` beside wherever the application was launched.

    Deliberately visible rather than hidden in the home directory: Kathará
    identifies a lab by its directory, so a lab you cannot easily `cd` into is
    a lab you cannot reach with `kathara connect`.
    """
    return Path.cwd() / "kathara-labs"


# The application's single session. Injected via a dependency so tests can
# supply their own rather than mutating global state.
_session: Session | None = None


def configure_session(workspace_root: Path | None = None) -> Session:
    """Create the process-wide session. Called once, at startup."""
    global _session
    _session = Session(workspace_root=workspace_root)
    return _session


def get_session() -> Session:
    global _session
    if _session is None:
        _session = Session()
    return _session
