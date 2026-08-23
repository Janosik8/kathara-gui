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


class Session:
    """Holds the topology being edited, plus where it came from on disk.

    Access is mutex-guarded: uvicorn serves requests concurrently, and two
    overlapping writes to a nested model could otherwise interleave.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._topology = Topology(name="untitled")
        self._path: Path | None = None
        self._dirty = False

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
            return self._topology


# The application's single session. Injected via a dependency so tests can
# supply their own rather than mutating global state.
_session = Session()


def get_session() -> Session:
    return _session
