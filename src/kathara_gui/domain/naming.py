"""Validation of device names so a topology stays portable across hosts.

A Kathara device name becomes a *directory name* in the lab folder. That makes
it subject to the host filesystem's rules, which differ sharply:

* Windows reserves device names such as ``con`` and ``nul``. Creating a
  directory with one of these fails, and the failure is easy to misread as a
  Kathara bug rather than a filesystem one.
* Windows forbids ``<>:"/\\|?*`` and trailing dots or spaces.
* macOS (APFS, case-insensitive by default) treats ``R1`` and ``r1`` as the
  same directory; Linux does not. A topology authored on Linux can therefore
  collapse into fewer devices when opened on a Mac.

Validating at the point of entry keeps a lab authored on any OS openable on
every other one.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

__all__ = ["NameError_", "validate_device_name", "check_unique_names", "RESERVED_WINDOWS_NAMES"]

# Reserved DOS device names, still special-cased by the Win32 API today.
RESERVED_WINDOWS_NAMES = frozenset(
    ["con", "prn", "aux", "nul"]
    + [f"com{i}" for i in range(1, 10)]
    + [f"lpt{i}" for i in range(1, 10)]
)

_FORBIDDEN_CHARS = set('<>:"/\\|?*')
_VALID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

# Kathara/Docker tolerate long names, but deep lab trees hit the Windows
# 260-character MAX_PATH limit. Keep individual segments short.
MAX_NAME_LENGTH = 48


class NameError_(ValueError):
    """Raised when a device name would not survive a round trip across hosts."""


def validate_device_name(name: str) -> None:
    """Raise :class:`NameError_` if ``name`` is unsafe on any supported host."""
    if not name:
        raise NameError_("Device name cannot be empty.")

    if len(name) > MAX_NAME_LENGTH:
        raise NameError_(
            f"Device name {name!r} is longer than {MAX_NAME_LENGTH} characters, "
            "which risks exceeding the Windows path limit."
        )

    bad = sorted(_FORBIDDEN_CHARS & set(name))
    if bad:
        raise NameError_(
            f"Device name {name!r} contains characters not allowed in a "
            f"directory name on Windows: {' '.join(bad)}"
        )

    if name != name.strip() or name.endswith("."):
        raise NameError_(
            f"Device name {name!r} cannot begin or end with a space, or end with a dot; "
            "Windows silently strips these."
        )

    # The reserved name applies with or without an extension: `con.txt` is
    # just as unusable as `con`.
    stem = name.split(".", 1)[0].lower()
    if stem in RESERVED_WINDOWS_NAMES:
        raise NameError_(
            f"Device name {name!r} is a reserved Windows device name. "
            f"Creating its lab directory would fail on Windows. Try {name}1 instead."
        )

    if not _VALID_PATTERN.match(name):
        raise NameError_(
            f"Device name {name!r} must start with a letter or digit and contain "
            "only letters, digits, dots, dashes and underscores."
        )


def check_unique_names(names: Iterable[str]) -> None:
    """Raise if any two names differ only by case.

    Such a pair works on Linux but silently merges on a case-insensitive
    macOS or Windows filesystem.
    """
    seen: dict[str, str] = {}
    for name in names:
        key = name.lower()
        if key in seen and seen[key] != name:
            raise NameError_(
                f"Device names {seen[key]!r} and {name!r} differ only by case. "
                "They would collide on macOS and Windows."
            )
        seen[key] = name
