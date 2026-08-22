"""Waiting for a device's startup script to finish, without a terminal.

Kathara's own ``exec(..., wait=True)`` cannot be used from this application.
Internally it polls ``sys.stdin`` with :func:`select.select` so that an
interactive CLI user can press a key to stop waiting. A web backend has no
terminal on stdin: under pytest the call raises ``UnsupportedOperation``, and
running detached it would be equally wrong.

Kathara marks completion by creating ``/tmp/EOS`` inside the container at the
end of the startup script. Polling for that file gives the same guarantee with
no stdin involved, and lets the caller choose its own timeout — which a GUI
needs anyway, to keep showing progress rather than blocking.
"""

from __future__ import annotations

import time
from typing import Any

# Kathara writes this once a device's .startup script has run to completion.
EOS_MARKER = "/tmp/EOS"

DEFAULT_TIMEOUT = 60.0
DEFAULT_INTERVAL = 0.5


class StartupTimeout(TimeoutError):
    """A device did not finish its startup script within the allotted time."""


def is_startup_complete(manager: Any, machine_name: str, lab: Any) -> bool:
    """True once ``machine_name`` has finished running its startup script."""
    # wait=False keeps Kathara from entering its stdin-polling wait loop.
    _, _, exit_code = manager.exec(
        machine_name, ["cat", EOS_MARKER], lab=lab, wait=False, stream=False
    )
    return exit_code == 0


def wait_for_startup(
    manager: Any,
    machine_name: str,
    lab: Any,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    interval: float = DEFAULT_INTERVAL,
) -> None:
    """Block until ``machine_name`` has finished starting, or raise.

    Raises :class:`StartupTimeout` rather than returning a flag, because a
    caller that ignored a False here would go on to report misleading
    diagnostics for a device that simply had not booted yet.
    """
    deadline = time.monotonic() + timeout
    while True:
        if is_startup_complete(manager, machine_name, lab):
            return
        if time.monotonic() >= deadline:
            raise StartupTimeout(
                f"Device {machine_name!r} did not finish its startup script "
                f"within {timeout:g}s."
            )
        time.sleep(interval)


def wait_for_lab(
    manager: Any,
    lab: Any,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    interval: float = DEFAULT_INTERVAL,
) -> None:
    """Wait for every device in ``lab``.

    The timeout is a budget for the whole lab, not per device, so a large
    topology cannot multiply into an unbounded wait.
    """
    deadline = time.monotonic() + timeout
    for name in lab.machines:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise StartupTimeout(f"Lab did not finish starting within {timeout:g}s.")
        wait_for_startup(manager, name, lab, timeout=remaining, interval=interval)
