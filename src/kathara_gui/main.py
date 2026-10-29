"""FastAPI application factory.

The server is reachable from any process on the machine, and it can execute
commands inside containers. A web page the user happens to be visiting can
therefore attempt requests against ``127.0.0.1``. Three cheap defences, applied
here rather than left to deployment:

1. Bind loopback only (see :mod:`kathara_gui.cli`).
2. Require a per-session token, minted at startup, on every API call.
3. Reject cross-origin requests outright, which blocks DNS rebinding.
"""

from __future__ import annotations

import secrets
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from kathara_gui import __version__
from kathara_gui.api import addressing, lab, preferences, project, topology
from kathara_gui.project.session import configure_session

STATIC_DIR = Path(__file__).parent / "static"

# Paths served without a token so the browser can bootstrap: the page itself
# carries the token in its query string and sends it as a header afterwards.
_PUBLIC_PATHS = frozenset(["/", "/index.html", "/favicon.ico"])
_TOKEN_HEADER = "x-kgui-token"

#: Said at startup and on the page when an installation has no interface (F45).
#: `uv tool install .` before the interface was built gave a server with no
#: page at all, and a bare 404 gave no hint why.
MISSING_INTERFACE = (
    "This installation has no interface: it was installed before the interface was "
    "built. In the project folder, run install.cmd (Windows) or ./install.sh (macOS, "
    "Linux), which builds it and installs again. In a source checkout run by "
    "`uv run`, `npm --prefix frontend run build` is enough."
)


def interface_built(static_dir: Path = STATIC_DIR) -> bool:
    return (static_dir / "index.html").is_file()


def create_app(
    token: str | None = None, workspace: Path | None = None, static_dir: Path = STATIC_DIR
) -> FastAPI:
    """Build the application.

    ``token`` of ``None`` mints a fresh one. ``workspace`` is where labs are
    generated; ``None`` uses `kathara-labs` beside the working directory.
    """
    app = FastAPI(title="Kathara GUI", version=__version__)
    app.state.token = token or secrets.token_urlsafe(32)
    app.state.workspace = configure_session(workspace).workspace_root

    @app.middleware("http")
    async def guard(request: Request, call_next):
        path = request.url.path

        # A browser sends Origin on cross-site requests. Same-origin fetches
        # from our own page either omit it or match us exactly, so anything
        # else is another site probing localhost.
        origin = request.headers.get("origin")
        if origin is not None:
            expected = {f"http://{request.headers.get('host', '')}"}
            if origin not in expected:
                return JSONResponse(
                    {"detail": "Cross-origin requests are not permitted."}, status_code=403
                )

        if not (path in _PUBLIC_PATHS or path.startswith("/assets/")):
            supplied = request.headers.get(_TOKEN_HEADER) or request.query_params.get("token")
            if not supplied or not secrets.compare_digest(supplied, app.state.token):
                return JSONResponse(
                    {"detail": "Invalid or missing session token."}, status_code=401
                )

        return await call_next(request)

    @app.exception_handler(OSError)
    async def operating_system_refused(request: Request, exc: OSError) -> JSONResponse:
        """A refusal from the file system as a reason, not a bare 500.

        Found in the Windows test run (step 0.8): a workspace path ending in a
        line break made every Save fail with WinError 123, and the interface
        showed nothing but "Not saved yet". The path is quoted with control
        characters made visible, since an invisible one was the whole problem.
        """
        where = ""
        if exc.filename:
            shown = str(exc.filename).replace("\r", "\\r").replace("\n", "\\n")
            where = f" Path: {shown}"
        reason = exc.strerror or str(exc) or exc.__class__.__name__
        return JSONResponse(
            {"detail": f"The operating system refused: {reason}.{where}"}, status_code=500
        )

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    app.include_router(topology.router)
    app.include_router(addressing.router)
    app.include_router(lab.router)
    app.include_router(project.router)
    app.include_router(preferences.router)

    # Mounted last so API routes win. Absent in a source checkout that has not
    # built the frontend yet, and in a copy installed before it was built.
    if interface_built(static_dir):
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    else:
        # The reason, where the user is looking, rather than a 404 (F45).
        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
        async def missing_interface() -> str:
            return (
                '<!doctype html><html lang="en"><meta charset="utf-8">'
                "<title>Kathara GUI: no interface</title>"
                '<body style="font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; '
                'margin: 3rem auto; padding: 0 1rem">'
                f"<h1>Kathara GUI has no interface</h1><p>{MISSING_INTERFACE}</p>"
                "</body></html>"
            )

    return app
