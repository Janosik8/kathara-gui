"""Whether an installed copy carries the interface (F45, note 5).

`uv tool install .` installed a server with no interface: every page was a 404.
The build backend, hatchling, leaves out whatever `.gitignore` lists, and the
built interface in `src/kathara_gui/static/` is gitignored on purpose (it is a
build product). No unit test runs the server from a wheel, so nothing noticed.

This builds the wheel the way `uv tool install` does and looks inside it. It
needs the interface built first, as every install does, and skips otherwise.
"""

from __future__ import annotations

import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "src" / "kathara_gui" / "static"


@pytest.mark.skipif(
    not (STATIC / "index.html").is_file(),
    reason="the interface is not built; run npm --prefix frontend run build",
)
@pytest.mark.skipif(shutil.which("uv") is None, reason="uv is not on PATH")
def test_the_wheel_carries_the_built_interface(tmp_path: Path) -> None:
    subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(tmp_path), str(ROOT)],
        check=True,
        capture_output=True,
    )
    (wheel,) = tmp_path.glob("*.whl")
    names = zipfile.ZipFile(wheel).namelist()

    assert "kathara_gui/static/index.html" in names
    assert any(n.startswith("kathara_gui/static/assets/") and n.endswith(".js") for n in names)
