"""The console entry point: how it starts, and how it stops."""

from __future__ import annotations

from typing import Any

import pytest

from kathara_gui import cli


def test_ctrl_c_stops_quietly(monkeypatch: pytest.MonkeyPatch, capsys: Any) -> None:
    """Found on Windows: stopping looked like a crash.

    Ctrl+C in a console reaches every attached process, so the server behind
    `uv run` receives it twice. uvicorn re-raises it after shutting down, and
    the cancelled lifespan task was logged as an ERROR with two tracebacks.
    Stopping is what the user asked for; it must end with a plain message.
    """
    calls: dict[str, Any] = {}

    def interrupted(app: Any, **kwargs: Any) -> None:
        calls.update(kwargs)
        raise KeyboardInterrupt

    monkeypatch.setattr(cli.uvicorn, "run", interrupted)

    assert cli.main(["--no-browser", "--port", "8199"]) == 0
    assert "Kathara GUI stopped." in capsys.readouterr().out
    # The app has no startup or shutdown hooks, and the lifespan task is the
    # thing that was cancelled mid-shutdown.
    assert calls["lifespan"] == "off"


# -- is the served interface the one in the source? --------------------


def _checkout(root: Any, *, built: bool) -> tuple[Any, Any]:
    frontend = root / "frontend"
    (frontend / "src").mkdir(parents=True)
    (frontend / "src" / "App.tsx").write_text("export {}")
    (frontend / "index.html").write_text("<html></html>")
    static = root / "static"
    static.mkdir()
    if built:
        (static / "index.html").write_text("<html>built</html>")
    return frontend, static


def _age(path: Any, seconds: float) -> None:
    import os

    stamp = path.stat().st_mtime - seconds
    os.utime(path, (stamp, stamp))


def test_a_missing_build_is_named_with_the_commands_to_fix_it(tmp_path: Any) -> None:
    frontend, static = _checkout(tmp_path, built=False)
    message = cli.frontend_staleness(frontend, static, npm="npm.cmd")
    assert message is not None
    assert "not been built" in message
    assert "npm.cmd --prefix frontend ci" in message


def test_a_build_older_than_its_source_is_reported(tmp_path: Any) -> None:
    """The silent case: after a pull, the old interface against the new backend."""
    frontend, static = _checkout(tmp_path, built=True)
    _age(static / "index.html", 60)
    message = cli.frontend_staleness(frontend, static)
    assert message is not None
    assert "older than its source" in message
    assert "npm --prefix frontend run build" in message


def test_an_up_to_date_build_says_nothing(tmp_path: Any) -> None:
    frontend, static = _checkout(tmp_path, built=True)
    for source in [frontend / "src" / "App.tsx", frontend / "index.html"]:
        _age(source, 60)
    assert cli.frontend_staleness(frontend, static) is None


def test_an_installed_release_is_never_warned_about(tmp_path: Any) -> None:
    """No frontend/ beside the package: nothing to compare, and no Node needed."""
    static = tmp_path / "static"
    static.mkdir()
    assert cli.frontend_staleness(tmp_path / "frontend", static) is None
