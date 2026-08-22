"""Generated files run inside Linux containers, so they must never carry CR.

These tests are the guard against the single most likely cross-platform defect:
Python's text mode emitting CRLF on a Windows host, producing `.startup`
scripts that fail inside the container with confusing errors.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from kathara_gui.fsutil import normalize_lf, to_posix, write_text_lf


def test_writes_lf_even_when_given_crlf(tmp_path: Path) -> None:
    target = tmp_path / "startup"
    write_text_lf(target, "ip link set eth0 up\r\nip addr add 10.0.0.1/24 dev eth0\r\n")

    raw = target.read_bytes()
    assert b"\r" not in raw
    assert raw == b"ip link set eth0 up\nip addr add 10.0.0.1/24 dev eth0\n"


def test_writes_lf_on_the_host_default_newline(tmp_path: Path) -> None:
    """The bytes must be LF regardless of ``os.linesep`` on the running host."""
    target = tmp_path / "lab.conf"
    write_text_lf(target, 'r1[0]="A"\nr2[0]="A"\n')
    assert b"\r" not in target.read_bytes()


def test_lone_cr_is_normalized(tmp_path: Path) -> None:
    target = tmp_path / "f"
    write_text_lf(target, "a\rb")
    assert target.read_bytes() == b"a\nb\n"


def test_trailing_newline_is_added(tmp_path: Path) -> None:
    target = tmp_path / "f"
    write_text_lf(target, "no trailing newline")
    assert target.read_bytes().endswith(b"\n")


def test_trailing_newline_can_be_suppressed(tmp_path: Path) -> None:
    target = tmp_path / "f"
    write_text_lf(target, "exact", ensure_trailing_newline=False)
    assert target.read_bytes() == b"exact"


def test_empty_content_stays_empty(tmp_path: Path) -> None:
    target = tmp_path / "f"
    write_text_lf(target, "")
    assert target.read_bytes() == b""


def test_parent_directories_are_created(tmp_path: Path) -> None:
    target = tmp_path / "lab" / "r1" / "etc" / "frr" / "frr.conf"
    write_text_lf(target, "hostname r1")
    assert target.is_file()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("a\r\nb", "a\nb"), ("a\rb", "a\nb"), ("a\nb", "a\nb"), ("", "")],
)
def test_normalize_lf(raw: str, expected: str) -> None:
    assert normalize_lf(raw) == expected


def test_to_posix_uses_forward_slashes() -> None:
    # Embedded in lab.conf and shell scripts, which Linux consumes.
    assert "\\" not in to_posix(Path("lab") / "r1" / "etc")
    assert to_posix("lab/r1") == "lab/r1"
