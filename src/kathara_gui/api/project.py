"""HTTP surface for the scenario as a folder: save, open, share, capture.

The document is a Kathará lab directory, and the export is a plain zip of it.
That is the whole design, and it replaced a bespoke `.kgui` package holding a
`topology.json` beside a copy of the lab. The package was worse in a way that
matters: `lab.conf` already round-trips the entire model, so the stored
topology was a *second* source of truth, and it silently won over an edited
`lab.conf` inside the same archive.

A zip of the folder also serves the people the format is for. A student who
cannot open the application on the morning of a deadline can unzip it and read
their own `.startup` scripts; anyone with Kathará can `kathara lstart` it; and
a lab written by somebody else years ago imports without having ever heard of
this tool.

**Where files go.** Saving is confined to the workspace. Anything crossing the
machine boundary — a submission leaving, a submission arriving — goes through
the browser's own download and upload. The driving case is an exam, and letting
the page name a path for the server to write to would serve it no better while
handing a local server an arbitrary-write surface.

Blocking work — zipping, and `exec` into containers for capture — is exposed
through `def` rather than `async def`, so FastAPI runs it in a threadpool
instead of stalling the event loop.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from kathara_gui.domain.codec.labconf import parse
from kathara_gui.domain.model import Topology
from kathara_gui.domain.naming import safe_dir_name
from kathara_gui.features import Features
from kathara_gui.kathara import state
from kathara_gui.project import scenario
from kathara_gui.project.session import Session, get_session

router = APIRouter(prefix="/api/project", tags=["project"])

#: An upload is held in memory before being written, so it needs a ceiling.
MAX_UPLOAD_BYTES = 64 * 1024 * 1024

#: Where an import is unpacked before being adopted, so a bad archive cannot
#: half-overwrite a scenario the user already had.
_STAGING = ".import"


class ProjectState(BaseModel):
    name: str
    folder: str | None = Field(
        default=None, description="Absolute path of the scenario folder, once it has one."
    )
    dirty: bool
    features: Features
    workspace: str


class SaveRequest(BaseModel):
    topology: Topology
    name: str | None = Field(
        default=None, description="Folder name to save under. Defaults to the scenario's name."
    )


class SaveResponse(BaseModel):
    folder: str
    name: str


class ScenarioSummary(BaseModel):
    folder: str
    name: str
    devices: int
    modified: float
    #: True when the folder has no kgui.json — a lab from somewhere else.
    foreign: bool


class OpenRequest(BaseModel):
    folder: str = Field(description="A scenario folder in the workspace, as listed.")


class OpenResponse(BaseModel):
    topology: Topology
    features: Features
    folder: str
    warnings: list[str] = []
    foreign: bool = False


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
    folder: str
    #: The topology with anything the capture learned folded in, so the canvas
    #: shows what the devices are really configured with.
    topology: Topology


def _state(session: Session) -> ProjectState:
    return ProjectState(
        name=session.topology.name,
        folder=str(session.path) if session.path else None,
        dirty=session.dirty,
        features=session.features,
        workspace=str(session.workspace_root),
    )


def _folder_in_workspace(session: Session, name: str) -> Path:
    """Resolve ``name`` to a folder inside the workspace, or refuse.

    The name is reduced to a single safe segment and rejoined to the workspace,
    so `../`, an absolute path and a nested directory all collapse to something
    harmless. Resolving and re-checking the parent catches what the
    transformation missed, including a symlink pointing out of the workspace.
    """
    stem = safe_dir_name(Path(name.replace("\\", "/")).name)
    if not stem:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That is not a usable name."
        )

    root = session.workspace_root
    candidate = (root / stem).resolve()
    if candidate.parent != root.resolve():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scenarios are kept in the workspace folder.",
        )
    return candidate


@router.get("", response_model=ProjectState)
async def read(session: Session = Depends(get_session)) -> ProjectState:
    """Where the current scenario stands."""
    return _state(session)


@router.get("/scenarios", response_model=list[ScenarioSummary])
def scenarios(session: Session = Depends(get_session)) -> list[ScenarioSummary]:
    """Scenario folders in the workspace, most recently changed first."""
    root = session.workspace_root
    if not root.is_dir():
        return []

    found: list[ScenarioSummary] = []
    for folder in root.iterdir():
        if not folder.is_dir() or folder.name.startswith(".") or not scenario.is_scenario(folder):
            continue
        try:
            loaded = scenario.load(folder)
            name, devices = loaded.topology.name, len(loaded.topology.nodes)
            foreign = loaded.foreign
        except scenario.ScenarioError:
            # Listed anyway, named by its folder: hiding a lab the user can see
            # on disk would be more confusing than showing it as unreadable.
            name, devices, foreign = folder.name, 0, True
        found.append(
            ScenarioSummary(
                folder=folder.name,
                name=name,
                devices=devices,
                modified=folder.stat().st_mtime,
                foreign=foreign,
            )
        )

    return sorted(found, key=lambda s: s.modified, reverse=True)


@router.post("/save", response_model=SaveResponse)
def save(request: SaveRequest, session: Session = Depends(get_session)) -> SaveResponse:
    """Write the scenario into its folder in the workspace."""
    topology = session.replace(request.topology)
    folder = _folder_in_workspace(session, request.name or topology.name)

    scenario.save(topology, folder, features=session.features)
    session.mark_saved(folder)
    return SaveResponse(folder=str(folder), name=folder.name)


@router.post("/export")
def export(request: SaveRequest, session: Session = Depends(get_session)) -> Response:
    """The scenario as a zip, for the browser to download.

    Saved first, so what leaves the machine is what the canvas currently shows
    rather than whatever was last written.
    """
    topology = request.topology
    folder = _folder_in_workspace(session, request.name or topology.name)
    scenario.save(topology, folder, features=session.features)

    archive = session.workspace_root / _STAGING / f"{folder.name}.zip"
    scenario.export_zip(folder, archive)
    try:
        payload = archive.read_bytes()
    finally:
        archive.unlink(missing_ok=True)

    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{folder.name}.zip"'},
    )


@router.post("/open", response_model=OpenResponse)
def open_scenario(
    request: OpenRequest, session: Session = Depends(get_session)
) -> OpenResponse:
    """Open a scenario folder from the workspace."""
    folder = _folder_in_workspace(session, request.folder)
    if not folder.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{folder.name} is not in the workspace.",
        )
    return _adopt(session, folder)


@router.post("/import", response_model=OpenResponse)
async def import_scenario(
    request: Request, session: Session = Depends(get_session)
) -> OpenResponse:
    """Open a scenario the browser sends: a zip, or a bare ``lab.conf``.

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

    # Percent-encoded by the client: an HTTP header cannot carry non-ASCII, and
    # "ćwiczenie.zip" is an ordinary name for a scenario here.
    filename = unquote(request.headers.get("X-KGUI-Filename", "imported"))
    stem = Path(filename.replace("\\", "/")).name
    is_archive = payload[:2] == b"PK"

    if is_archive:
        target = _folder_in_workspace(session, Path(stem).stem)
        staging = session.workspace_root / _STAGING / target.name
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True, exist_ok=True)
        try:
            scenario.import_archive_bytes(payload, staging)
            # Only once it is known to be a real scenario does anything the
            # user already had get touched.
            shutil.rmtree(target, ignore_errors=True)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(staging), str(target))
        except scenario.ScenarioError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        return _adopt(session, target)

    # A bare lab.conf. Its name says nothing useful, so the scenario is named
    # from LAB_NAME inside it, falling back to the file's own stem.
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That file is neither a zip archive nor readable text.",
        ) from exc

    result = parse(text)
    if not result.topology.nodes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No devices were found in that file, so it is not a lab.conf.",
        )

    named = result.topology.name
    target = _folder_in_workspace(session, named if named != "lab" else Path(stem).stem)
    target.mkdir(parents=True, exist_ok=True)
    (target / scenario.LAB_CONF).write_text(text, encoding="utf-8", newline="\n")
    return _adopt(session, target)


def _adopt(session: Session, folder: Path) -> OpenResponse:
    """Make ``folder`` the scenario being edited."""
    try:
        loaded = scenario.load(folder)
    except scenario.ScenarioError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    session.replace(loaded.topology, dirty=False)
    session.set_features(loaded.features)
    session.mark_saved(folder)
    return OpenResponse(
        topology=loaded.topology,
        features=loaded.features,
        folder=str(folder),
        warnings=loaded.warnings,
        foreign=loaded.foreign,
    )


@router.post("/capture", response_model=CaptureResponse)
def capture(request: CaptureRequest, session: Session = Depends(get_session)) -> CaptureResponse:
    """Pull each running device's live configuration into the scenario.

    Two destinations, because a device keeps its configuration in two places.
    A router's routing state goes to ``<device>/etc/frr/frr.conf``, where
    Kathará copies from on the next deploy. Interface addresses go back into
    the *model*, because that is what generates ``<device>.startup`` — writing
    the file directly would be undone by the next save, and would leave the
    canvas showing an address the device no longer has.
    """
    topology = session.replace(request.topology)
    folder = session.lab_dir(topology)

    report = state.capture(topology, folder)
    updated = state.recover_addresses(topology, folder)
    if updated != topology:
        topology = session.replace(updated)

    # Regenerate so the .startup files match what was just learned, and the
    # scenario on disk is consistent with the model.
    if folder.is_dir():
        scenario.save(topology, folder, features=session.features)

    return CaptureResponse(
        captured=[
            CapturedModel(device=c.device, path=str(c.path), lines=c.lines)
            for c in report.captured
        ],
        skipped=report.skipped,
        message=report.message,
        folder=str(folder),
        topology=topology,
    )
