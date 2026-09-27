"""The console entry point: how it starts, and how it stops."""

from __future__ import annotations

from typing import Any

import pytest

from kathara_gui import cli


@pytest.fixture(autouse=True)
def _restore_ctrl_c() -> Any:
    """main() ignores SIGINT on its way out; don't let that outlive a test."""
    import signal

    previous = signal.getsignal(signal.SIGINT)
    yield
    signal.signal(signal.SIGINT, previous)


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
    monkeypatch.setattr(cli.runner, "running_everywhere", lambda: [])

    assert cli.main(["--no-browser", "--port", "8199"]) == 0
    out = capsys.readouterr().out
    assert "Kathara GUI stopped." in out
    assert "still deployed" not in out
    # The app has no startup or shutdown hooks, and the lifespan task is the
    # thing that was cancelled mid-shutdown.
    assert calls["lifespan"] == "off"


# -- labs left behind at exit -------------------------------------------


def _interrupt(app: Any, **kwargs: Any) -> None:
    raise KeyboardInterrupt


def test_stopping_with_a_lab_deployed_says_it_is_still_running(
    monkeypatch: pytest.MonkeyPatch, capsys: Any
) -> None:
    """Requested in the Windows test run (step 0.6).

    Containers outlive the application on purpose (D9), but someone pressing
    Ctrl+C cannot see that and would assume the lab stopped with it.
    """
    from kathara_gui.kathara.runner import DeployedDevice

    left = [
        DeployedDevice("labA", "r1", "running"),
        DeployedDevice("labA", "r2", "running"),
        DeployedDevice("labB", "pc1", "exited"),
    ]
    monkeypatch.setattr(cli.uvicorn, "run", _interrupt)
    monkeypatch.setattr(cli.runner, "running_everywhere", lambda: left)

    assert cli.main(["--no-browser", "--port", "8199"]) == 0
    out = capsys.readouterr().out
    assert "3 devices in 2 labs are still deployed" in out
    assert "Stop every lab" in out


def test_a_failing_check_at_exit_still_stops_cleanly(
    monkeypatch: pytest.MonkeyPatch, capsys: Any
) -> None:
    """A late second Ctrl+C, or Docker gone away, must not bring a traceback back."""

    def broken() -> list[Any]:
        raise KeyboardInterrupt

    monkeypatch.setattr(cli.uvicorn, "run", _interrupt)
    monkeypatch.setattr(cli.runner, "running_everywhere", broken)

    assert cli.main(["--no-browser", "--port", "8199"]) == 0
    assert "Kathara GUI stopped." in capsys.readouterr().out


def test_a_ctrl_c_arriving_after_exit_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    """The duplicated Windows Ctrl+C can land during interpreter shutdown.

    Found in the user's transcript: "Kathara GUI stopped.", then "Exception
    ignored in atexit callback … KeyboardInterrupt". The last thing main()
    does is stop listening for it. Recorded rather than applied, so the test
    process itself keeps responding to Ctrl+C.
    """
    installed: list[Any] = []
    monkeypatch.setattr(cli.uvicorn, "run", _interrupt)
    monkeypatch.setattr(cli.runner, "running_everywhere", lambda: [])
    monkeypatch.setattr(cli.signal, "signal", lambda sig, handler: installed.append((sig, handler)))

    assert cli.main(["--no-browser", "--port", "8199"]) == 0
    assert installed[-1] == (cli.signal.SIGINT, cli.signal.SIG_IGN)


def test_the_notice_counts_in_words() -> None:
    assert cli.shutdown_notice(0, 0) is None
    one = cli.shutdown_notice(1, 1)
    assert one is not None and one.startswith("1 device in 1 lab is still deployed")
    many = cli.shutdown_notice(5, 2)
    assert many is not None and many.startswith("5 devices in 2 labs are still deployed")


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
