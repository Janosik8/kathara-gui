"""HTTP surface for the scenario as a file: save, open, share, capture.

Everything here is the missing half of Capability 5. The package format and
the configuration capture were built and tested first; without this router
they were unreachable, and a format nobody can invoke satisfies none of the
requirements that asked for it.

**Why the browser downloads rather than the server writing where it is told.**
The driving use case is an exam: a student produces a file and submits it to an
e-learning platform, and an instructor opens that submission. That wants the
file in the browser's own download folder, and it wants opening an arbitrary
file the instructor received. Letting the page name a path for the server to
write to would serve the same flows less well while handing a token-gated local
server an arbitrary-write surface. So saving in place is confined to the
workspace, and anything leaving or entering the machine goes through the
browser's own download and upload.

Blocking work — zipping, and `exec` into containers for capture — is exposed
through `def` rather than `async def`, so FastAPI runs it in a threadpool
instead of stalling the event loop.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from kathara_gui.domain.model import Topology
from kathara_gui.domain.naming import safe_dir_name
from kathara_gui.features import Features
from kathara_gui.kathara import state
from kathara_gui.project import kgui
from kathara_gui.project.session import Session, get_session

router = APIRouter(prefix="/api/project", tags=["project"])

#: An uploaded package is held in memory before being written, so it needs a
#: ceiling. A scenario is text — a large one is a few hundred kilobytes — and
#: this leaves room for captured configuration and a manual without letting a
#: single request exhaust the process.
MAX_UPLOAD_BYTES = 32 * 1024 * 1024


class ProjectState(BaseModel):
    """Where the scenario stands: named, saved, and with what allowed."""

    name: str
    project_file: str | None = Field(
        default=None, description="Absolute path of the .kgui this was saved to or opened from."
    )
    dirty: bool
    features: Features
    workspace: str


class SaveRequest(BaseModel):
    topology: Topology
    filename: str | None = Field(
        default=None,
        description="Base name for the package. Defaults to the topology's name.",
    )


class SaveResponse(BaseModel):
    path: str
    filename: str


class PackageSummary(BaseModel):
    filename: str
    name: str
    modified: float
    size: int


class OpenRequest(BaseModel):
    filename: str = Field(description="A package in the workspace, as listed by /packages.")


class OpenResponse(BaseModel):
    topology: Topology
    features: Features
    project_file: str
    lab_dir: str
    application: str
    created: str | None = None


class CaptureRequest(BaseModel):
    topology: Topology


class CapturedModel(BaseModel):
    device: str
    path: str
    lines: int


class CaptureResponse(BaseModel):
    captured: list[CapturedModel]
    skipped: list[tuple[str, str]]
    message: str | None = None
    lab_dir: str


def _state(session: Session) -> ProjectState:
    return ProjectState(
        name=session.topology.name,
        project_file=str(session.project_file) if session.project_file else None,
        dirty=session.dirty,
        features=session.features,
        workspace=str(session.workspace_root),
    )


def _package_path(session: Session, filename: str) -> Path:
    """Resolve ``filename`` to a package inside the workspace, or refuse.

    The name is reduced to a single safe segment and rejoined to the workspace,
    so `../`, an absolute path and a nested directory all collapse to something
    harmless rather than being honoured. Resolving and re-checking the parent
    catches whatever the transformation missed, including a symlink pointing
    out of the workspace.
    """
    stem = safe_dir_name(Path(filename).name.removesuffix(kgui.SUFFIX))
    if not stem:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That is not a usable file name.",
        )

    root = session.workspace_root
    candidate = (root / f"{stem}{kgui.SUFFIX}").resolve()
    if candidate.parent != root.resolve():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scenario files are kept in the workspace folder.",
        )
    return candidate


@router.get("", response_model=ProjectState)
async def read(session: Session = Depends(get_session)) -> ProjectState:
    """Where the current scenario stands."""
    return _state(session)


@router.get("/packages", response_model=list[PackageSummary])
def packages(session: Session = Depends(get_session)) -> list[PackageSummary]:
    """Scenario files in the workspace, most recently changed first."""
    root = session.workspace_root
    if not root.is_dir():
        return []

    found: list[PackageSummary] = []
    for path in root.glob(f"*{kgui.SUFFIX}"):
        if not path.is_file():
            continue
        try:
            # The stored name, not the file name: a scenario renamed in the
            # editor and saved keeps the file it had.
            name = kgui.read_package(path).topology.name
        except kgui.PackageError:
            # Listed anyway, named by its file. Hiding an unreadable scenario
            # would leave the user unable to see that it is there at all.
            name = path.stem
        stat = path.stat()
        found.append(
            PackageSummary(
                filename=path.name, name=name, modified=stat.st_mtime, size=stat.st_size
            )
        )

    return sorted(found, key=lambda p: p.modified, reverse=True)


@router.post("/save", response_model=SaveResponse)
def save(request: SaveRequest, session: Session = Depends(get_session)) -> SaveResponse:
    """Write the scenario into the workspace as a `.kgui` package.

    The lab directory is included when one exists, so a scenario saved after a
    capture carries the captured configuration rather than a freshly generated
    lab that has none of it.
    """
    topology = session.replace(request.topology)
    destination = _package_path(session, request.filename or topology.name)

    lab_dir = session.lab_dir(topology)
    written = kgui.write_package(
        topology,
        destination,
        features=session.features,
        lab_dir=lab_dir if lab_dir.is_dir() else None,
    )
    session.mark_saved(written)
    return SaveResponse(path=str(written), filename=written.name)


@router.post("/download")
def download(request: SaveRequest, session: Session = Depends(get_session)) -> Response:
    """The scenario as a `.kgui` file, for the browser to download.

    Written through the workspace rather than assembled in memory: the same
    code path as Save, so a downloaded package and a saved one cannot drift.
    """
    topology = request.topology
    stem = safe_dir_name(request.filename or topology.name) or "scenario"
    scratch = session.workspace_root / ".download" / f"{stem}{kgui.SUFFIX}"

    lab_dir = session.lab_dir(topology)
    kgui.write_package(
        topology,
        scratch,
        features=session.features,
        lab_dir=lab_dir if lab_dir.is_dir() else None,
    )
    try:
        payload = scratch.read_bytes()
    finally:
        scratch.unlink(missing_ok=True)

    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{stem}{kgui.SUFFIX}"'},
    )


@router.post("/open", response_model=OpenResponse)
def open_package(request: OpenRequest, session: Session = Depends(get_session)) -> OpenResponse:
    """Open a package from the workspace and adopt it as the current scenario."""
    source = _package_path(session, request.filename)
    if not source.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{source.name} is not in the workspace.",
        )
    return _adopt(session, source)


@router.post("/upload", response_model=OpenResponse)
async def upload(request: Request, session: Session = Depends(get_session)) -> OpenResponse:
    """Open a package the browser sends as a raw body.

    Raw bytes rather than a multipart form: the payload is a single file, so
    multipart would add a dependency and a parsing step to carry nothing extra.
    """
    payload = await request.body()
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No file was received."
        )
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"That file is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
        )

    # Percent-encoded by the client: an HTTP header cannot carry non-ASCII,
    # and "ćwiczenie.kgui" is an entirely ordinary name for a scenario here.
    filename = unquote(request.headers.get("X-KGUI-Filename", "uploaded.kgui"))
    destination = _package_path(session, filename)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Landed in the workspace before being read, so an opened submission is a
    # file the user can find again rather than something that existed only for
    # the duration of one request.
    destination.write_bytes(payload)
    return _adopt(session, destination)


def _adopt(session: Session, source: Path) -> OpenResponse:
    """Make ``source`` the scenario being edited, lab directory and all."""
    try:
        package = kgui.read_package(source)
    except kgui.PackageError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    topology = session.replace(package.topology, dirty=False)
    session.set_features(package.features)

    # The lab travels with the package and carries anything captured from
    # running containers, so it is written out and deployed from.
    lab_dir = session.workspace_root / safe_dir_name(topology.name)
    try:
        kgui.extract_lab(source, lab_dir)
    except kgui.PackageError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    session.mark_saved(source, lab_dir=lab_dir)
    return OpenResponse(
        topology=topology,
        features=package.features,
        project_file=str(source),
        lab_dir=str(lab_dir),
        application=package.application,
        created=package.created,
    )


@router.post("/capture", response_model=CaptureResponse)
def capture(request: CaptureRequest, session: Session = Depends(get_session)) -> CaptureResponse:
    """Pull each running device's configuration into the lab directory.

    The result lands where Kathará copies from on the next deploy, so a
    scenario saved afterwards resumes with the configuration it was captured
    with — no separate restore step.
    """
    topology = session.replace(request.topology)
    lab_dir = session.lab_dir(topology)
    report = state.capture(topology, lab_dir)

    return CaptureResponse(
        captured=[
            CapturedModel(device=c.device, path=str(c.path), lines=c.lines)
            for c in report.captured
        ],
        skipped=report.skipped,
        message=report.message,
        lab_dir=str(lab_dir),
    )
