"""HTTP surface for the addressing plan.

Both endpoints are gated by :mod:`kathara_gui.features`, because an instructor
may withdraw them for an exam. The gate is here rather than in the UI: this is
a browser application, so hiding a button stops nobody who opens the developer
tools.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from kathara_gui.domain import addressing
from kathara_gui.domain.model import Topology
from kathara_gui.project.session import Session, get_session

router = APIRouter(prefix="/api/topology/addressing", tags=["addressing"])


class Issue(BaseModel):
    severity: str
    code: str
    message: str
    collision_domain: str | None = None
    devices: list[str] = Field(default_factory=list)


class IssuesResponse(BaseModel):
    issues: list[Issue]
    errors: int = Field(description="Count of issues that will stop the lab working.")
    warnings: int


class AllocateRequest(BaseModel):
    pool: str = Field(default=addressing.DEFAULT_POOL, description="Address space to carve up")
    prefix: int = Field(default=addressing.DEFAULT_PREFIX, ge=1, le=127)
    overwrite: bool = Field(
        default=False,
        description="Renumber everything. Off preserves addresses set by hand.",
    )


class AllocateResponse(BaseModel):
    topology: Topology
    assigned_subnets: dict[str, str]
    assigned_addresses: dict[str, str]
    skipped: list[str]
    changed: bool


def _to_issue(issue: addressing.AddressingIssue) -> Issue:
    return Issue(
        severity=issue.severity.value,
        code=issue.code,
        message=issue.message,
        collision_domain=issue.collision_domain,
        devices=list(issue.devices),
    )


@router.get("/issues", response_model=IssuesResponse)
async def issues(session: Session = Depends(get_session)) -> IssuesResponse:
    """Everything wrong with the current addressing plan."""
    session.features.require("addressing_validation")

    found = [_to_issue(i) for i in addressing.validate(session.topology)]
    return IssuesResponse(
        issues=found,
        errors=sum(1 for i in found if i.severity == "error"),
        warnings=sum(1 for i in found if i.severity == "warning"),
    )


@router.post("/check", response_model=IssuesResponse)
async def check(
    topology: Topology, session: Session = Depends(get_session)
) -> IssuesResponse:
    """Validate a supplied topology without storing it.

    The editor validates as you type, against the document in the browser —
    which is ahead of the saved session. Duplicating the rules in TypeScript
    would let the two drift apart and give a student different answers from
    the ones the instructor's export produces, so the client sends its
    topology here instead.
    """
    session.features.require("addressing_validation")

    found = [_to_issue(i) for i in addressing.validate(topology)]
    return IssuesResponse(
        issues=found,
        errors=sum(1 for i in found if i.severity == "error"),
        warnings=sum(1 for i in found if i.severity == "warning"),
    )


@router.post("/allocate", response_model=AllocateResponse)
async def allocate(
    request: AllocateRequest, session: Session = Depends(get_session)
) -> AllocateResponse:
    """Fill in subnets and host addresses, and make the result the edited topology."""
    session.features.require("subnet_calculator")

    try:
        result = addressing.allocate(
            session.topology,
            pool=request.pool,
            prefix=request.prefix,
            overwrite=request.overwrite,
        )
    except ValueError as exc:
        # A pool that cannot be parsed, or a prefix larger than the pool.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    session.replace(result.topology)
    return AllocateResponse(
        topology=result.topology,
        assigned_subnets=result.assigned_subnets,
        assigned_addresses=result.assigned_addresses,
        skipped=result.skipped,
        changed=result.changed,
    )
