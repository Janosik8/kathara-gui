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
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from kathara_gui import __version__
from kathara_gui.api import addressing, lab, topology
from kathara_gui.project.session import configure_session

STATIC_DIR = Path(__file__).parent / "static"

# Paths served without a token so the browser can bootstrap: the page itself
# carries the token in its query string and sends it as a header afterwards.
_PUBLIC_PATHS = frozenset(["/", "/index.html", "/favicon.ico"])
_TOKEN_HEADER = "x-kgui-token"


def create_app(token: str | None = None, workspace: Path | None = None) -> FastAPI:
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

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    app.include_router(topology.router)
    app.include_router(addressing.router)
    app.include_router(lab.router)

    # Mounted last so API routes win. Absent during early development and in
    # a source checkout that has not built the frontend yet.
    if STATIC_DIR.is_dir() and any(STATIC_DIR.iterdir()):
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

    return app
