"""Kathará's manager, with a Docker connection that is known to be alive.

Kathará's manager is a process-wide singleton, and so is the Docker client
inside it: one pool of connections, opened when this application first asks,
and kept for as long as it runs. Docker Desktop does not last that long. Quit
it, restart it, or let the machine sleep, and every pooled connection is dead.

On Windows those connections are named pipes, and a dead one fails with
``pywintypes.error: (232, 'WriteFile', 'The pipe is being closed.')``. That is
not an ``OSError``, so urllib3 does not recognise a dropped connection and
does not retry: each stale pipe in the pool fails once, in turn, wherever it
happens to be picked up — found in test 3E.3, as a deploy that failed after
Docker came back (F36).

So every caller goes through :func:`manager`, which pings first and, on a
connection failure, empties the pool and tries once more. Emptying the pool is
all it takes: the client opens fresh connections when next asked.
"""

from __future__ import annotations

from typing import Any

from Kathara.manager.Kathara import Kathara

__all__ = ["DOCKER_NOT_RUNNING", "DockerUnavailable", "is_connection_error", "manager"]

DOCKER_NOT_RUNNING = (
    "Docker is not running. Start Docker Desktop (or the docker service on Linux), "
    "wait until it reports that it is running, then try again."
)

try:  # Windows only: the named-pipe transport raises these.
    from pywintypes import error as _PipeError
except ImportError:  # pragma: no cover - macOS, Linux
    _PipeError = None


class DockerUnavailable(RuntimeError):
    """No Docker daemon answered, even on a fresh connection."""

    def __init__(self, message: str = DOCKER_NOT_RUNNING) -> None:
        super().__init__(message)


def is_connection_error(exc: BaseException) -> bool:
    """Whether ``exc`` means the daemon could not be reached, rather than a refusal.

    A refusal — an image that cannot be pulled, a name already taken — comes
    back from a daemon that answered, as ``docker.errors.APIError``, and is
    not one of these.
    """
    import docker.errors
    import requests.exceptions

    if isinstance(exc, DockerUnavailable):
        return True
    if _PipeError is not None and isinstance(exc, _PipeError):
        return True
    if isinstance(exc, docker.errors.APIError):
        return False
    # DockerException without a response is what docker.from_env raises when
    # there is no daemon at all; OSError covers a stale Unix socket.
    return isinstance(
        exc, requests.exceptions.ConnectionError | docker.errors.DockerException | OSError
    )


def manager() -> Any:
    """Kathará's manager, after making sure its Docker connection works.

    Raises :class:`DockerUnavailable` when no daemon answers. The ping costs a
    few milliseconds, which nothing it guards will notice.
    """
    try:
        instance = Kathara.get_instance()
    except Exception as exc:
        # Kathará connects while constructing itself, so no daemon fails here.
        if is_connection_error(exc):
            raise DockerUnavailable() from exc
        raise

    # Only the Docker manager has a Docker client; Kathará's Kubernetes
    # manager does not, and has nothing here to go stale.
    client = getattr(getattr(instance, "manager", None), "client", None)
    if client is None or not hasattr(client, "ping"):
        return instance

    try:
        client.ping()
    except Exception as exc:  # noqa: BLE001 - anything but a dead connection is re-raised
        if not is_connection_error(exc):
            raise
        client.close()  # drops every pooled connection, stale or not
        try:
            client.ping()
        except Exception as again:  # noqa: BLE001
            if is_connection_error(again):
                raise DockerUnavailable() from again
            raise
    return instance
