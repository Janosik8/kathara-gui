"""Filesystem helpers that keep generated artifacts Linux-container-safe.

Every file this application generates (``lab.conf``, ``.startup``, ``frr.conf``)
is executed or parsed *inside a Linux container*, regardless of the host OS.
Python's default text mode translates ``\\n`` to ``\\r\\n`` on Windows, and a
stray carriage return breaks shell scripts in ways that are painful to debug
(``bash`` reports ``command not found`` for a command that is plainly there).

All generated-file writes must go through :func:`write_text_lf`.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath

__all__ = ["write_text_lf", "to_posix", "normalize_lf"]


def normalize_lf(text: str) -> str:
    """Collapse CRLF and lone CR to LF."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def write_text_lf(path: Path, text: str, *, ensure_trailing_newline: bool = True) -> None:
    """Write ``text`` to ``path`` with LF endings on every platform.

    ``newline=""`` disables Python's newline translation, so the bytes written
    are exactly the bytes given. We normalize first so callers may pass text
    that already contains CRLF (e.g. pulled from a Windows-edited file).
    """
    body = normalize_lf(text)
    if ensure_trailing_newline and body and not body.endswith("\n"):
        body += "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(body)


def to_posix(path: str | Path) -> str:
    """Render a path with forward slashes, for embedding in generated files.

    ``lab.conf`` and shell scripts are consumed by Linux, so a Windows
    backslash path would be interpreted as escape sequences.
    """
    return PurePosixPath(Path(path).as_posix()).as_posix()
