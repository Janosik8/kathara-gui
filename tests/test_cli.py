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
