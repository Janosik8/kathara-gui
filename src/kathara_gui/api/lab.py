"""HTTP surface for deploying and checking a running lab.

Every endpoint here is a plain ``def`` rather than ``async def``. The work
underneath blocks — pulling images, starting containers, waiting for startup
scripts — and FastAPI runs synchronous endpoints in a threadpool. Declaring
them ``async`` would stall the event loop and freeze the whole interface for
the length of a deployment.

Like the addressing endpoints, these take the caller's topology. Operating on
the saved session instead would deploy whatever was last saved rather than
what the user is looking at.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from kathara_gui.domain.drift import describe_drift, describe_live_drift
from kathara_gui.domain.model import Topology
from kathara_gui.kathara import diagnostics, probe, runner, state
from kathara_gui.project.session import ScenarioNameError, Session, get_session

router = APIRouter(prefix="/api/lab", tags=["lab"])


class CheckModel(BaseModel):
    name: str
    status: str
    detail: str
    remedy: str = ""


class ProbeResponse(BaseModel):
    checks: list[CheckModel]
    can_deploy: bool


class DeviceStatusModel(BaseModel):
    name: str
    state: str
    #: Docker's container name, for ``docker exec``; null when none exists.
    container: str | None = None
    shell: str | None = None


class ConflictsModel(BaseModel):
    lab_name: str
    expected: list[str]
    unexpected: list[str]


class StatusResponse(BaseModel):
    #: How the canvas differs from what is running, one sentence per
    #: difference. Empty when they agree, or when nothing is deployed.
    #:
    #: Covers both directions: edits made on the canvas since the lab was
    #: deployed, and configuration changed inside a container by hand.
    drift: list[str] = []
    devices: list[DeviceStatusModel]
    running: list[str]
    #: Containers that exist but have stopped. They still hold their names, so
    #: the lab must be undeployed before it can be deployed again.
    exited: list[str] = []
    #: True when any container exists, running or exited.
    deployed: bool
    lab_dir: str | None = None
    message: str | None = None
    needs_confirmation: bool = False
    conflicts: ConflictsModel | None = None


class TopologyRequest(BaseModel):
    topology: Topology


class DeployRequest(TopologyRequest):
    confirm: bool = Field(
        default=False,
        description=(
            "Stop whatever is already running under this lab name and deploy anyway. "
            "Without it, a conflict is reported and nothing is changed."
        ),
    )


class LinkCheckModel(BaseModel):
    collision_domain: str
    source: str
    source_interface: int
    target: str
    target_interface: int
    target_address: str | None
    outcome: str
    detail: str = ""


class DiagnosticsResponse(BaseModel):
    checks: list[LinkCheckModel]
    passed: int
    failed: int
    skipped: int
    healthy: bool
    message: str | None = None


def _status_response(
    status: runner.LabStatus, drift: list[str] | None = None
) -> StatusResponse:
    return StatusResponse(
        drift=drift or [],
        devices=[
            DeviceStatusModel(
                name=d.name, state=d.state.value, container=d.container, shell=d.shell
            )
            for d in status.devices
        ],
        running=status.running,
        exited=status.exited,
        deployed=status.deployed,
        lab_dir=status.lab_dir,
        message=status.message,
        needs_confirmation=status.needs_confirmation,
        conflicts=(
            ConflictsModel(
                lab_name=status.conflicts.lab_name,
                expected=list(status.conflicts.expected),
                unexpected=list(status.conflicts.unexpected),
            )
            if status.conflicts
            else None
        ),
    )


@router.get("/probe", response_model=ProbeResponse)
def environment() -> ProbeResponse:
    """Whether this machine can run a lab, and what to fix if not."""
    report = probe.probe()
    return ProbeResponse(
        checks=[
            CheckModel(name=c.name, status=c.status.value, detail=c.detail, remedy=c.remedy)
            for c in report.checks
        ],
        can_deploy=report.can_deploy,
    )


@router.post("/status", response_model=StatusResponse)
def lab_status(
    request: TopologyRequest, session: Session = Depends(get_session)
) -> StatusResponse:
    """Reconcile the topology against what Docker is actually running.

    A POST rather than a GET because it carries the topology. The user can
    stop containers from a terminal at any moment, so the interface polls this
    rather than trusting that its last action still holds.
    """
    lab_dir = session.lab_dir(request.topology)
    status = runner.status(request.topology, lab_dir)

    drift = describe_drift(session.deployed_topology, request.topology)
    if status.running:
        # Reading the containers costs about 50ms each and catches the
        # direction the snapshot cannot: an address changed inside a container
        # leaves the canvas and the snapshot stale in the same way, so they
        # agree with each other and both are wrong.
        #
        # Measured against the deployed snapshot, not the canvas, or every
        # canvas edit is reported twice — once forwards and once backwards.
        baseline = session.deployed_topology or request.topology
        drift += describe_live_drift(
            baseline, state.live_addresses(request.topology, lab_dir)
        )

    return _status_response(status, drift)


@router.post("/deploy", response_model=StatusResponse)
def deploy(
    request: DeployRequest, session: Session = Depends(get_session)
) -> StatusResponse:
    # Deploying writes the lab to disk, so it is a save, into the same folder
    # Save would use (test 3E.2): a lab renamed and deployed without saving
    # runs from a folder with its new name, not its old one.
    try:
        folder = session.persist(request.topology).folder
    except ScenarioNameError as exc:
        return _status_response(runner.LabStatus(message=f"Could not deploy. {exc}"))

    result = runner.deploy(request.topology, folder, confirm=request.confirm)

    if result.needs_confirmation:
        # Nothing was changed, so the session must not be updated either.
        return _status_response(result)

    # Deploying makes this topology the one on disk, so adopt it as the
    # session's — otherwise a later save could overwrite what is running.
    session.replace(request.topology, dirty=False)
    # What is running is now exactly this, so the canvas and the lab agree.
    session.mark_deployed(request.topology.model_copy(deep=True))
    return _status_response(result)


@router.post("/undeploy", response_model=StatusResponse)
def undeploy(
    request: TopologyRequest, session: Session = Depends(get_session)
) -> StatusResponse:
    result = runner.undeploy(request.topology, session.lab_dir(request.topology))
    # Nothing is running, so there is nothing to have drifted from.
    session.mark_deployed(None)
    return _status_response(result)


class RestartRequest(TopologyRequest):
    devices: list[str] = Field(description="The devices to restart; the rest keep running.")


@router.post("/restart", response_model=StatusResponse)
def restart(request: RestartRequest, session: Session = Depends(get_session)) -> StatusResponse:
    """Restart chosen devices of the running lab from their files (FR-19).

    The design is read-only while the lab runs (D9), so the deployed snapshot
    still describes what runs: nothing to adopt or forget here.
    """
    result = runner.restart(
        request.topology, session.lab_dir(request.topology), request.devices
    )
    return _status_response(result)


@router.post("/verify", response_model=DiagnosticsResponse)
def verify(
    request: TopologyRequest, session: Session = Depends(get_session)
) -> DiagnosticsResponse:
    """Ping between every pair sharing a collision domain (Capability 4)."""
    session.features.require("infrastructure_verification")

    report = diagnostics.verify(request.topology, session.lab_dir(request.topology))
    return DiagnosticsResponse(
        checks=[
            LinkCheckModel(
                collision_domain=c.collision_domain,
                source=c.source,
                source_interface=c.source_interface,
                target=c.target,
                target_interface=c.target_interface,
                target_address=c.target_address,
                outcome=c.outcome.value,
                detail=c.detail,
            )
            for c in report.checks
        ],
        passed=report.passed,
        failed=report.failed,
        skipped=report.skipped,
        healthy=report.healthy,
        message=report.message,
    )


class EverythingResponse(BaseModel):
    """Every Kathará lab of the current user, not only the one being edited."""

    devices: int
    labs: int
    message: str | None = None


def _everything(message: str | None = None) -> EverythingResponse:
    devices = runner.running_everywhere()
    return EverythingResponse(
        devices=len(devices), labs=len({d.lab_hash for d in devices}), message=message
    )


@router.get("/everything", response_model=EverythingResponse)
def everything() -> EverythingResponse:
    """How many devices, in how many labs, "Stop every lab" would stop."""
    return _everything()


@router.post("/wipe", response_model=EverythingResponse)
def wipe(session: Session = Depends(get_session)) -> EverythingResponse:
    """Stop every lab of the current user, capturing nothing — ``kathara wipe``.

    The one way out when labs have been left running, and on a machine without
    the Kathará command-line tool, the only practical one.
    """
    message = runner.wipe()
    if message is None:
        # Every lab this session had deployed is gone with everything else.
        session.forget_deployed()
    return _everything(message)


class FeaturesResponse(BaseModel):
    subnet_calculator: bool
    addressing_validation: bool
    infrastructure_verification: bool = Field(
        description="Whether link diagnostics are available in this scenario."
    )


@router.get("/features", response_model=FeaturesResponse)
def features(session: Session = Depends(get_session)) -> FeaturesResponse:
    """What this scenario permits, so the UI can hide what it cannot use."""
    return FeaturesResponse(**session.features.model_dump())
