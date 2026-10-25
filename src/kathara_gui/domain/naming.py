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

__all__ = [
    "NameError_",
    "validate_device_name",
    "check_unique_names",
    "kathara_name_problem",
    "suggest_kathara_name",
    "safe_dir_name",
    "RESERVED_WINDOWS_NAMES",
]

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


# Kathará's own rule, from `Kathara.model.Machine`: anything else is refused
# at deploy with "Invalid device name". Stricter than portability needs, so it
# is checked separately: a lab with `R1` in it must still open, to be renamed.
_KATHARA_PATTERN = re.compile(r"^[a-z0-9_]{1,30}$")


def kathara_name_problem(name: str) -> str | None:
    """Why Kathará would refuse ``name`` as a device name, or None if it would not."""
    if _KATHARA_PATTERN.match(name):
        return None
    return (
        f"Kathará only accepts device names made of lowercase letters, digits and "
        f"underscores, up to 30 characters, so it would refuse {name!r}. "
        f"Try {suggest_kathara_name(name)!r}."
    )


def suggest_kathara_name(name: str) -> str:
    """The nearest name Kathará accepts: ``R1`` → ``r1``, ``edge-1`` → ``edge_1``."""
    cleaned = re.sub(r"[^a-z0-9_]", "_", name.strip().lower())[:30]
    return cleaned or "r1"


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


def safe_dir_name(name: str) -> str:
    """Turn a lab name into something usable as a directory name.

    A lab name is free text the user typed; a directory name is not. This is
    deliberately more forgiving than :func:`validate_device_name` — a lab may
    reasonably be called "BGP exam, group A" — so it *transforms* rather than
    rejects, replacing anything unsafe with a dash.
    """
    cleaned = "".join(c if c.isalnum() or c in "-_" else "-" for c in name)
    # Collapse runs of dashes so "BGP exam, group A" does not become
    # "BGP-exam--group-A".
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    cleaned = cleaned.strip("-")

    if not cleaned or cleaned.split(".", 1)[0].lower() in RESERVED_WINDOWS_NAMES:
        return "untitled"
    return cleaned[:MAX_NAME_LENGTH]
