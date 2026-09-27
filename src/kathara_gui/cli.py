"""Console entry point: start the local server and open the browser at it."""

from __future__ import annotations

import argparse
import socket
import threading
import webbrowser
from pathlib import Path

import uvicorn

from kathara_gui import __version__
from kathara_gui.main import create_app

HOST = "127.0.0.1"


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
