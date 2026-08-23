"""Console entry point: start the local server and open the browser at it."""

from __future__ import annotations

import argparse
import socket
import threading
import webbrowser

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
    args = parser.parse_args(argv)

    port = args.port or _free_port()
    app = create_app()
    url = f"http://{HOST}:{port}/?token={app.state.token}"

    if args.check:
        print(f"kathara-gui {__version__} OK", flush=True)
        return 0

    # flush matters: stdout is block-buffered when it is not a terminal, so a
    # user piping to a file or a log would never see the URL — and the token in
    # it is the only way to reach the application.
    print(f"Kathara GUI running at:\n  {url}\n\nPress Ctrl+C to stop.", flush=True)
    if not args.no_browser:
        # Deferred so the server is accepting connections before the tab loads.
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()

    uvicorn.run(app, host=HOST, port=port, log_level="info")
    return 0
