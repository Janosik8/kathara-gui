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
from pathlib import Path

from kathara_gui.domain.model import Topology
from kathara_gui.domain.naming import safe_dir_name
from kathara_gui.features import Features


class Session:
    """Holds the topology being edited, plus where it came from on disk.

    Access is mutex-guarded: uvicorn serves requests concurrently, and two
    overlapping writes to a nested model could otherwise interleave.
    """

    def __init__(self, workspace_root: Path | None = None) -> None:
        self._lock = threading.RLock()
        self._topology = Topology(name="untitled")
        self._path: Path | None = None
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
            return self._workspace_root / safe_dir_name(named.name)

    @property
    def features(self) -> Features:
        """Which assistive features this scenario permits (Capability 8)."""
        with self._lock:
            return self._features

    def set_features(self, features: Features) -> Features:
        with self._lock:
            self._features = features
            return self._features

    @property
    def topology(self) -> Topology:
        with self._lock:
            return self._topology

    @property
    def path(self) -> Path | None:
        """Directory this topology was loaded from or last saved to."""
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

    def mark_saved(self, path: Path) -> None:
        with self._lock:
            self._path = Path(path)
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
