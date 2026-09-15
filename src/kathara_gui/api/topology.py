"""HTTP surface for the topology being edited.

The canvas holds an operation log client-side (see decision D4) and syncs the
resulting document here with a full replace. That keeps the server simple while
the application is single-user, and leaves the operation log in the one place
collaboration will need it: when Capability 7 arrives, operations sync over the
WebSocket instead of being flattened into a PUT, and this router becomes the
snapshot/restore path rather than the edit path.

Validation lives in the domain model, so a malformed edit is rejected here with
the model's own message — the same message the desktop UI shows — rather than a
generic 422.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError

from kathara_gui.domain.codec.labconf import parse, serialize
from kathara_gui.domain.layout import arrange
from kathara_gui.domain.model import Position, Topology
from kathara_gui.project.session import Session, get_session

router = APIRouter(prefix="/api/topology", tags=["topology"])


class TopologyState(BaseModel):
    """The topology plus the editor state the UI needs alongside it."""

    topology: Topology
    dirty: bool
    path: str | None


class ImportRequest(BaseModel):
    text: str = Field(description="Raw lab.conf contents")


class ImportResponse(BaseModel):
    topology: Topology
    warnings: list[str] = Field(
        default_factory=list,
        description="Lines that could not be understood. Import is deliberately forgiving.",
    )


class ExportResponse(BaseModel):
    text: str


class ArrangeResponse(BaseModel):
    positions: dict[str, Position] = Field(
        description="Where each device should go, by name."
    )


def _state(session: Session) -> TopologyState:
    return TopologyState(
        topology=session.topology,
        dirty=session.dirty,
        path=str(session.path) if session.path else None,
    )


@router.get("", response_model=TopologyState)
async def read(session: Session = Depends(get_session)) -> TopologyState:
    return _state(session)


@router.put("", response_model=TopologyState)
async def replace(
    topology: Topology, session: Session = Depends(get_session)
) -> TopologyState:
    """Replace the edited topology wholesale.

    FastAPI has already validated the body against the model, so cross-field
    rules (duplicate names, case collisions, repeated interface numbers) have
    run by the time we get here.
    """
    session.replace(topology)
    return _state(session)


@router.post("/reset", response_model=TopologyState)
async def reset(session: Session = Depends(get_session)) -> TopologyState:
    session.reset()
    return _state(session)


@router.post("/import", response_model=ImportResponse)
async def import_labconf(
    request: ImportRequest, session: Session = Depends(get_session)
) -> ImportResponse:
    """Parse ``lab.conf`` text and make it the edited topology.

    Unreadable lines are returned as warnings rather than rejected, so a
    hand-written legacy lab still imports and the UI can say what it skipped.
    """
    try:
        result = parse(request.text)
    except ValidationError as exc:
        # Reached when the file parses as text but describes an impossible
        # topology, e.g. two devices whose names differ only by case.
        raise HTTPException(status_code=422, detail=_first_error(exc)) from exc

    session.replace(result.topology)
    return ImportResponse(topology=result.topology, warnings=result.warnings)


@router.get("/export", response_model=ExportResponse)
async def export_labconf(session: Session = Depends(get_session)) -> ExportResponse:
    """Render the current topology as ``lab.conf`` for preview or download."""
    return ExportResponse(text=serialize(session.topology))


def _first_error(exc: ValidationError) -> str:
    """Surface the model's own wording; it is written for the end user."""
    errors = exc.errors()
    if not errors:
        return str(exc)
    message = errors[0].get("msg", "")
    # Pydantic prefixes custom ValueError messages with "Value error, ".
    return message.removeprefix("Value error, ")


@router.post("/arrange", response_model=ArrangeResponse)
async def arrange_topology(topology: Topology) -> ArrangeResponse:
    """Positions that lay the topology out with as few crossings as possible.

    Returns positions rather than a topology, so the editor can apply them as
    a single `moveNodes` operation: one undo step retracts the whole
    rearrangement, and a layout the user dislikes costs one keystroke.

    Takes the topology in the body rather than acting on the stored one,
    because the browser holds the newer version — the same rule as every other
    endpoint that computes from a topology.
    """
    return ArrangeResponse(positions=arrange(topology))
