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
from kathara_gui.features import Features
from kathara_gui.kathara import runner, state
from kathara_gui.project import scenario
from kathara_gui.project.session import (
    Persisted,
    ScenarioNameError,
    Session,
    folder_name,
    get_session,
)

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
        default=None,
        description="Save as: the copy's name, which is also its folder's. "
        "Defaults to the scenario's own name and folder.",
    )


class SaveResponse(BaseModel):
    folder: str
    name: str
    renamed_from: str | None = Field(
        default=None, description="The folder's previous name, when saving renamed it."
    )


class ScenarioSummary(BaseModel):
    folder: str
    name: str
    devices: int
    modified: float
    #: True when the folder has no kgui.json — a lab from somewhere else.
    foreign: bool
    #: True while any of its lab's containers is running.
    running: bool = False


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
    stem = folder_name(Path(name.replace("\\", "/")).name)
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

    # Asked once for the whole list, not once per scenario.
    running = runner.running_lab_names([entry.name for entry in found])
    for entry in found:
        entry.running = entry.name in running

    return sorted(found, key=lambda s: s.modified, reverse=True)


def persist(session: Session, topology: Topology, name: str | None = None) -> Persisted:
    """Write the scenario into the folder named after it (test 3E.2).

    ``name`` is Save as: the copy gets that name, and the original's folder is
    left alone. Saving under the name the scenario already has is a plain
    save, not a copy of itself.
    """
    copy = bool(name) and (session.path is None or name != session.path.name)
    if name and name != topology.name:
        topology = topology.model_copy(update={"name": name})
    try:
        return session.persist(topology, copy=copy)
    except ScenarioNameError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT if exc.taken else status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post("/save", response_model=SaveResponse)
def save(request: SaveRequest, session: Session = Depends(get_session)) -> SaveResponse:
    """Write the scenario into its folder in the workspace."""
    saved = persist(session, request.topology, request.name)
    return SaveResponse(
        folder=str(saved.folder), name=saved.folder.name, renamed_from=saved.renamed_from
    )


@router.post("/export")
def export(request: SaveRequest, session: Session = Depends(get_session)) -> Response:
    """The scenario as a zip, for the browser to download.

    Saved first, so what leaves the machine is what the canvas currently shows
    rather than whatever was last written.
    """
    folder = persist(session, request.topology, request.name).folder

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
    request: Request, replace: bool = False, session: Session = Depends(get_session)
) -> OpenResponse:
    """Open a scenario the browser sends: a zip, or a bare ``lab.conf``.

    Raw bytes rather than a multipart form: the payload is a single file, so
    multipart would add a dependency and a parsing step to carry nothing extra.

    The folder is named after the lab inside, as every other folder is (F34),
    not after the file: a browser saves a second download of "base exam" as
    "base exam (1).zip", and a folder of that name holding a lab called "base
    exam" would be a second lab with one name. A scenario of that name already
    in the workspace is replaced only when ``replace`` says so; otherwise the
    answer is 409, so the page can ask first (test 5C.1).
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
    stem = Path(Path(filename.replace("\\", "/")).name).stem or "imported"
    is_archive = payload[:2] == b"PK"

    # Named after the file, so a lab that names itself nowhere is named by it.
    staging = session.workspace_root / _STAGING / _folder_in_workspace(session, stem).name
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True, exist_ok=True)
    try:
        if is_archive:
            try:
                scenario.import_archive_bytes(payload, staging)
            except scenario.ScenarioError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
                ) from exc
        else:
            _stage_labconf(payload, staging)

        # Only once it is known to be a real scenario does anything the user
        # already had get touched.
        try:
            name = scenario.load(staging).topology.name
        except scenario.ScenarioError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        # Spelt as the lab is: resolving an existing "Base Exam" on Windows
        # answers in that folder's case, and the replacement is "base exam".
        target = _folder_in_workspace(session, name).with_name(folder_name(name))
        existing = _existing_folder(session, target.name)
        if existing is not None:
            _may_replace(existing, replace)
            shutil.rmtree(existing)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(staging), str(target))
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return _adopt(session, target)


def _stage_labconf(payload: bytes, staging: Path) -> None:
    """Write a bare ``lab.conf`` into ``staging``, or refuse what is not one."""
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That file is neither a zip archive nor readable text.",
        ) from exc

    if not parse(text).topology.nodes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No devices were found in that file, so it is not a lab.conf.",
        )
    # A bare lab.conf's file name says nothing useful ("lab.conf"), so the
    # scenario is named from LAB_NAME inside it; `scenario.load` falls back to
    # the staging folder's name, which is the file's stem.
    (staging / scenario.LAB_CONF).write_text(text, encoding="utf-8", newline="\n")


def _existing_folder(session: Session, name: str) -> Path | None:
    """The workspace folder called ``name``, compared case-insensitively.

    Case-insensitively whatever the host, as Save compares, so "Base Exam" and
    "base exam" are one scenario on every machine.
    """
    root = session.workspace_root
    if not root.is_dir():
        return None
    return next((c for c in root.iterdir() if c.name.lower() == name.lower()), None)


def _may_replace(existing: Path, replace: bool) -> None:
    """Refuse to import over ``existing`` unless asked to, and never over a running lab."""
    try:
        name = scenario.load(existing).topology.name
    except scenario.ScenarioError:
        name = existing.name
    if runner.running_lab_names([name]):
        # Replacing the files under a running lab would leave the containers
        # running one design and the folder holding another.
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"The scenario {existing.name!r} is running. Stop its lab before "
            "importing over it.",
        )
    if not replace:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"There is already a scenario called {existing.name!r} in the workspace. "
            "Importing replaces it, and what is in it now is lost.",
        )


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
    left_out: dict[str, dict[int, list[str]]] = {}
    updated = state.recover_addresses(topology, folder, report.frr_loopbacks, left_out)
    if updated != topology:
        topology = session.replace(updated)

    # Regenerate so the .startup files match what was just learned, and the
    # scenario on disk is consistent with the model.
    if folder.is_dir():
        scenario.save(topology, folder, features=session.features)

    # Capturing *is* adopting the containers' state, so what was just learned
    # becomes the baseline the running lab is compared against. Without this
    # the header reported the capture itself as a difference (bug 20): the
    # snapshot still held the addresses from before the user changed them.
    if session.deployed_topology is not None:
        session.mark_deployed(topology.model_copy(deep=True))

    return CaptureResponse(
        captured=[
            CapturedModel(device=c.device, path=str(c.path), lines=c.lines)
            for c in report.captured
        ],
        skipped=report.skipped,
        message=_joined(
            report.message,
            _frr_loopback_notes(report.frr_loopbacks),
            _left_out_notes(left_out, report.frr_addresses, topology),
        ),
        folder=str(folder),
        topology=topology,
    )


def _joined(message: str | None, *notes: list[str]) -> str | None:
    parts = [message] if message else []
    for group in notes:
        parts.extend(group)
    return " ".join(parts) or None


def _frr_loopback_notes(owned: dict[str, list[str]]) -> list[str]:
    """Say why a loopback set in vtysh is not in the Loopback rows (F31).

    Without this the capture would look as if it had missed the address.
    """
    return [
        f"{device}: {', '.join(addresses)} on lo "
        f"{'is' if len(addresses) == 1 else 'are'} set in FRR (vtysh), so "
        f"{'it stays' if len(addresses) == 1 else 'they stay'} in frr.conf; change "
        f"{'it' if len(addresses) == 1 else 'them'} there."
        for device, addresses in sorted(owned.items())
    ]


def _left_out_notes(
    left_out: dict[str, dict[int, list[str]]],
    frr_held: dict[str, dict[str, list[str]]],
    topology: Topology,
) -> list[str]:
    """Say which addresses the capture had no place for in the design.

    The design keeps one address per interface, so a second one is not taken
    into it; nor is an address on an interface the design does not have. Said
    rather than dropped in silence. A second address set in FRR is not lost:
    ``frr.conf`` restores it on the next deploy, so that is what is said.
    """
    notes: list[str] = []
    for device, by_interface in sorted(left_out.items()):
        node = topology.node(device)
        known = {iface.number for iface in node.interfaces} if node else set()
        for number, addresses in sorted(by_interface.items()):
            name = f"eth{number}"
            listed = ", ".join(addresses)
            if number not in known:
                notes.append(
                    f"{device} {name} has {listed}, but the design has no {name}, "
                    f"so {'it was' if len(addresses) == 1 else 'they were'} not captured."
                )
                continue
            in_frr = set(frr_held.get(device, {}).get(name, []))
            kept = [a for a in addresses if a in in_frr]
            lost = [a for a in addresses if a not in in_frr]
            if lost:
                notes.append(
                    f"{device} {name} also has {', '.join(lost)}; the design keeps one "
                    "address per interface, so "
                    f"{'it was' if len(lost) == 1 else 'they were'} not captured."
                )
            if kept:
                notes.append(
                    f"{device} {name} also has {', '.join(kept)}, set in FRR (vtysh), so "
                    f"{'it stays' if len(kept) == 1 else 'they stay'} in frr.conf."
                )
    return notes
