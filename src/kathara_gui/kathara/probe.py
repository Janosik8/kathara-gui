"""Checking that the environment can actually run a lab.

Most first-run failures are environmental rather than bugs: Docker is not
started, Windows is set to Windows containers, WSL2 is missing. Left to
surface on their own they arrive as a stack trace from deep inside a library,
which tells the user nothing about what to do.

Each check therefore reports a *remedy*, not just a fault. The UI shows these
before offering to deploy anything.
"""

from __future__ import annotations

import platform
import shutil
from dataclasses import dataclass
from enum import StrEnum

__all__ = ["Status", "Check", "ProbeReport", "probe"]


class Status(StrEnum):
    OK = "ok"
    #: The lab cannot be deployed until this is resolved.
    BLOCKED = "blocked"
    #: Worth knowing, but deployment can proceed.
    ADVISORY = "advisory"


@dataclass(frozen=True)
class Check:
    name: str
    status: Status
    detail: str
    #: What the user should do. Empty when there is nothing to do.
    remedy: str = ""


@dataclass
class ProbeReport:
    checks: list[Check]

    @property
    def can_deploy(self) -> bool:
        return not any(c.status is Status.BLOCKED for c in self.checks)

    @property
    def blockers(self) -> list[Check]:
        return [c for c in self.checks if c.status is Status.BLOCKED]


def _check_docker() -> Check:
    """Is a Docker daemon reachable, and is it serving Linux containers?"""
    try:
        import docker
    except ImportError:  # pragma: no cover - docker is a hard dependency
        return Check(
            "Docker SDK",
            Status.BLOCKED,
            "The docker Python package is not installed.",
            "Reinstall Kathara GUI: uv tool install --force kathara-gui",
        )

    try:
        client = docker.from_env()
        info = client.info()
    except Exception as exc:
        return Check(
            "Docker daemon",
            Status.BLOCKED,
            f"Could not reach the Docker daemon: {exc}",
            "Start Docker Desktop (or the docker service on Linux) and wait for it to "
            "report that it is running.",
        )

    os_type = str(info.get("OSType", "")).lower()
    if os_type and os_type != "linux":
        # The classic Windows misconfiguration. Kathara images are Linux only.
        return Check(
            "Docker daemon",
            Status.BLOCKED,
            f"Docker is serving {os_type} containers.",
            "Switch Docker Desktop to Linux containers: right-click the tray icon and "
            'choose "Switch to Linux containers".',
        )

    version = info.get("ServerVersion", "unknown")
    return Check("Docker daemon", Status.OK, f"Running, version {version}, Linux containers.")


def _check_kathara() -> Check:
    try:
        from Kathara.manager.Kathara import Kathara
    except ImportError:  # pragma: no cover - kathara is a hard dependency
        return Check(
            "Kathará",
            Status.BLOCKED,
            "The Kathara Python package is not installed.",
            "Reinstall Kathara GUI: uv tool install --force kathara-gui",
        )

    try:
        manager = Kathara.get_instance()
        return Check(
            "Kathará", Status.OK, f"Using the {manager.get_formatted_manager_name()} manager."
        )
    except Exception as exc:
        return Check(
            "Kathará",
            Status.BLOCKED,
            f"Kathará could not start: {exc}",
            "Check that Docker is running, then run `kathara check` in a terminal.",
        )


def _check_windows_backend() -> Check | None:
    """Windows-only advisories that Kathará inherits."""
    if platform.system() != "Windows":
        return None

    # WSL2 is required for the Docker backend Kathara supports. We cannot
    # detect the backend reliably from here, so this is an advisory rather
    # than a blocker: a false blocker would be worse than a reminder.
    return Check(
        "Windows setup",
        Status.ADVISORY,
        "Kathará on Windows requires Docker Desktop 2.5 or newer using the WSL2 backend.",
        'Ensure "Use Windows Containers" is off, and share the drive holding your labs in '
        "Docker Desktop's settings.",
    )


def _check_kathara_cli() -> Check:
    """A separate CLI is optional, but useful for `kathara connect`."""
    if shutil.which("kathara"):
        return Check("Kathará CLI", Status.OK, "Available on PATH.")
    return Check(
        "Kathará CLI",
        Status.ADVISORY,
        "No `kathara` command on PATH.",
        "Not required — the application talks to Kathará directly, and the Laboratory "
        "panel gives a `docker exec` command that opens a shell on a device without it. "
        "Install the CLI if you prefer `kathara connect`.",
    )


def probe() -> ProbeReport:
    """Run every environment check."""
    checks = [_check_docker(), _check_kathara(), _check_kathara_cli()]
    windows = _check_windows_backend()
    if windows is not None:
        checks.append(windows)
    return ProbeReport(checks=checks)
