"""Console entry point: start the local server and open the browser at it."""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

from kathara_gui import __version__
from kathara_gui.main import STATIC_DIR, create_app

HOST = "127.0.0.1"

#: Where the interface is built from — present only in a source checkout.
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


def _newest(paths: list[Path]) -> float:
    return max((p.stat().st_mtime for p in paths if p.is_file()), default=0.0)


def frontend_staleness(frontend: Path, static: Path, npm: str = "npm") -> str | None:
    """Why the served interface may not match its source, or None if it does.

    `uv run kathara-gui` serves whatever is already in ``static/`` and never
    rebuilds it. That is right — end users need no Node (NFR-03) — but in a
    source checkout it means a `git pull` that changes the frontend starts
    cleanly and silently serves the *old* interface against the *new* backend,
    which looks exactly like "the fix did not work". A missing build at least
    fails visibly, as a blank page; a stale one does not.

    Only a source checkout has ``frontend/``; an installed release ships the
    build and has nothing to compare against, so it is never warned about.
    Warns only: never blocks startup, and never runs npm itself.
    """
    if not (frontend / "src").is_dir():
        return None

    built = static / "index.html"
    if not built.is_file():
        return (
            "The interface has not been built, so the page will be blank. Run:\n"
            f"  {npm} --prefix frontend ci\n"
            f"  {npm} --prefix frontend run build"
        )

    sources = [*(frontend / "src").rglob("*"), frontend / "index.html"]
    if _newest(sources) > built.stat().st_mtime:
        return (
            "The interface is older than its source code, so you may be seeing an "
            "old version of it. Rebuild with:\n"
            f"  {npm} --prefix frontend run build"
        )
    return None


def _free_port() -> int:
    """Ask the OS for an unused port.

    Hardcoding 8000 collides with whatever else the user is running, which is
    a common and confusing first-run failure.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        return sock.getsockname()[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kathara-gui", description="Kathara topology GUI")
    parser.add_argument("--version", action="version", version=f"kathara-gui {__version__}")
    parser.add_argument("--port", type=int, default=None, help="Port (default: an unused one)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser")
    parser.add_argument("--check", action="store_true", help="Verify startup, then exit")
    parser.add_argument(
        "--workspace",
        type=Path,
        default=None,
        help="Directory for generated labs (default: ./kathara-labs)",
    )
    args = parser.parse_args(argv)

    port = args.port or _free_port()
    app = create_app(workspace=args.workspace)
    url = f"http://{HOST}:{port}/?token={app.state.token}"

    # npm.cmd on Windows: in PowerShell's default Restricted policy, plain `npm`
    # resolves to npm.ps1 and is refused (F22).
    stale = frontend_staleness(
        FRONTEND_DIR, STATIC_DIR, npm="npm.cmd" if sys.platform == "win32" else "npm"
    )
    if stale:
        print(f"Warning: {stale}\n", flush=True)

    if args.check:
        print(f"kathara-gui {__version__} OK", flush=True)
        return 0

    # flush matters: stdout is block-buffered when it is not a terminal, so a
    # user piping to a file or a log would never see the URL — and the token in
    # it is the only way to reach the application.
    # The workspace is printed because Kathará keys a lab by its directory:
    # without knowing it, `kathara connect` cannot be used at all.
    print(
        f"Kathara GUI running at:\n  {url}\n\n"
        f"Labs are written to:\n  {app.state.workspace}\n\n"
        "Press Ctrl+C to stop.",
        flush=True,
    )
    if not args.no_browser:
        # Deferred so the server is accepting connections before the tab loads.
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()

    try:
        # lifespan="off": the application has no startup or shutdown hooks, and
        # the lifespan task was what broke on Windows. Ctrl+C in a console
        # reaches every process attached to it, so the server launched by
        # `uv run` receives it twice; uvicorn treats the second as "force exit",
        # skips the orderly shutdown, and the cancelled lifespan task was
        # logged as an ERROR with two chained tracebacks — a clean stop that
        # looked like a crash (bug reported in bugs/pwsh.txt).
        uvicorn.run(app, host=HOST, port=port, log_level="info", lifespan="off")
    except KeyboardInterrupt:
        # uvicorn re-raises the signal after shutting down so that the exit
        # status reflects it; stopping is what the user asked for, not a fault.
        pass
    print("Kathara GUI stopped.", flush=True)
    return 0
