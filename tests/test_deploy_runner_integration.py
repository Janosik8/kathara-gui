"""Deploying through the runner, and catching a broken link with diagnostics.

Requires a running Docker daemon. Marked ``docker`` and excluded from the
default run; enable with ``pytest -m docker``.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from kathara_gui.domain.model import Interface, Node, Topology
from kathara_gui.kathara import diagnostics, runner
from kathara_gui.kathara.diagnostics import Outcome

pytestmark = pytest.mark.docker

IMAGE = "kathara/base"


@pytest.fixture
def lab_dir(tmp_path: Path) -> Path:
    """Where these tests generate their lab.

    Passed explicitly rather than patched into a global: the directory is now
    an argument, which is the whole point of the change.
    """
    return tmp_path / "labs" / "integration"


def two_routers(*, matching_subnets: bool) -> Topology:
    """A point-to-point link, optionally misconfigured.

    ``matching_subnets=False`` reproduces the specification's troubleshooting
    case: both interfaces are up and both addresses are individually valid,
    but they are on different networks, so nothing passes.
    """
    second = "172.31.11.2/24" if matching_subnets else "172.31.12.2/24"
    return Topology(
        name="kgui-runner-integration",
        nodes=[
            Node(
                name="r1",
                image=IMAGE,
                interfaces=[Interface(number=0, collision_domain="A", ip="172.31.11.1/24")],
            ),
            Node(
                name="r2",
                image=IMAGE,
                interfaces=[Interface(number=0, collision_domain="A", ip=second)],
            ),
        ],
    )


@pytest.fixture
def working_lab(lab_dir: Path) -> Iterator[Topology]:
    topology = two_routers(matching_subnets=True)
    try:
        yield topology
    finally:
        runner.undeploy(topology, lab_dir)


@pytest.fixture
def broken_lab(lab_dir: Path) -> Iterator[Topology]:
    topology = two_routers(matching_subnets=False)
    try:
        yield topology
    finally:
        runner.undeploy(topology, lab_dir)


def test_deploy_starts_every_device(working_lab: Topology, lab_dir: Path) -> None:
    status = runner.deploy(working_lab, lab_dir, confirm=True)
    assert sorted(status.running) == ["r1", "r2"]
    assert status.deployed is True


def test_status_reconciles_against_docker(working_lab: Topology, lab_dir: Path) -> None:
    assert runner.status(working_lab, lab_dir).deployed is False
    runner.deploy(working_lab, lab_dir, confirm=True)
    assert runner.status(working_lab, lab_dir).deployed is True


def test_undeploy_stops_everything(working_lab: Topology, lab_dir: Path) -> None:
    runner.deploy(working_lab, lab_dir, confirm=True)
    status = runner.undeploy(working_lab, lab_dir)
    assert status.running == []
    assert status.deployed is False


def test_diagnostics_pass_on_a_correct_link(working_lab: Topology, lab_dir: Path) -> None:
    runner.deploy(working_lab, lab_dir, confirm=True)
    report = diagnostics.verify(working_lab, lab_dir)

    assert report.failed == 0
    assert report.passed == 1
    assert report.healthy is True
    assert "packet loss" in report.checks[0].detail


def test_diagnostics_catch_a_link_that_looks_configured_but_is_not(
    broken_lab: Topology, lab_dir: Path
) -> None:
    """The failure Capability 4 exists for.

    Every interface is up and every address is valid, so nothing in the
    configuration looks wrong — but the two ends are on different networks and
    cannot reach each other.
    """
    runner.deploy(broken_lab, lab_dir, confirm=True)
    report = diagnostics.verify(broken_lab, lab_dir)

    assert report.failed == 1
    assert report.healthy is False
    assert report.checks[0].outcome is Outcome.FAIL


def test_diagnostics_report_where_the_fault_is(broken_lab: Topology, lab_dir: Path) -> None:
    runner.deploy(broken_lab, lab_dir, confirm=True)
    check = diagnostics.verify(broken_lab, lab_dir).checks[0]

    assert check.collision_domain == "A"
    assert {check.source, check.target} == {"r1", "r2"}


def test_verifying_before_deploying_explains_itself(tmp_path: Path) -> None:
    topology = two_routers(matching_subnets=True)
    topology.name = "kgui-never-deployed"
    report = diagnostics.verify(topology, tmp_path / "never-written")

    assert report.checks == []
    assert report.message is not None
    assert "Deploy it" in report.message


def test_unaddressed_links_are_skipped_not_failed(lab_dir: Path) -> None:
    topology = Topology(
        name="kgui-unaddressed",
        nodes=[
            Node(name="r1", image=IMAGE, interfaces=[Interface(number=0, collision_domain="A")]),
            Node(name="r2", image=IMAGE, interfaces=[Interface(number=0, collision_domain="A")]),
        ],
    )
    try:
        runner.deploy(topology, lab_dir, confirm=True)
        report = diagnostics.verify(topology, lab_dir)
        assert report.skipped == 1
        assert report.failed == 0
    finally:
        runner.undeploy(topology, lab_dir)


def test_deploying_nothing_says_so(lab_dir: Path) -> None:
    status = runner.deploy(Topology(name="kgui-empty"), lab_dir, confirm=True)
    assert status.deployed is False
    assert status.message == "There is nothing to deploy."


# -- redeploying over a running lab ------------------------------------


def test_deploying_twice_does_not_fail(working_lab: Topology, lab_dir: Path) -> None:
    """The ordinary working loop: edit, deploy, look, edit, deploy.

    This used to raise MachineAlreadyExistsError straight out of Kathará
    unless the user remembered to press Stop in between.
    """
    runner.deploy(working_lab, lab_dir, confirm=True)
    status = runner.deploy(working_lab, lab_dir, confirm=True)

    assert sorted(status.running) == ["r1", "r2"]
    assert status.message is not None
    assert "Stopped 2 devices already running" in status.message


def test_a_redeploy_picks_up_topology_changes(working_lab: Topology, lab_dir: Path) -> None:
    """Deploying after an edit must actually apply the edit."""
    runner.deploy(working_lab, lab_dir, confirm=True)

    working_lab.nodes.append(
        Node(
            name="r3",
            image=IMAGE,
            interfaces=[Interface(number=0, collision_domain="A", ip="172.31.11.3/24")],
        )
    )
    status = runner.deploy(working_lab, lab_dir, confirm=True)
    assert sorted(status.running) == ["r1", "r2", "r3"]


def test_diagnostics_still_work_after_a_redeploy(working_lab: Topology, lab_dir: Path) -> None:
    runner.deploy(working_lab, lab_dir, confirm=True)
    runner.deploy(working_lab, lab_dir, confirm=True)

    report = diagnostics.verify(working_lab, lab_dir)
    assert report.failed == 0
    assert report.passed == 1


def test_a_first_deploy_reports_no_replacement(working_lab: Topology, lab_dir: Path) -> None:
    # The note should only appear when something was actually torn down.
    assert runner.deploy(working_lab, lab_dir, confirm=True).message is None


def test_a_failure_is_reported_rather_than_raised(lab_dir: Path) -> None:
    """A bad image must produce a message, not a 500 and a stack trace."""
    topology = Topology(
        name="kgui-bad-image",
        nodes=[
            Node(
                name="r1",
                image="kathara-gui/definitely-not-a-real-image:v0",
                interfaces=[Interface(number=0, collision_domain="A")],
            )
        ],
    )
    try:
        status = runner.deploy(topology, lab_dir, confirm=True)
        assert status.deployed is False
        assert status.message is not None
        assert "Could not deploy" in status.message
    finally:
        runner.undeploy(topology, lab_dir)


def test_labs_with_different_names_coexist(tmp_path: Path) -> None:
    """Different *lab names* coexist, even with identical device names.

    Note what this does and does not say. Kathará keys a lab by a hash of its
    name, not its directory, so this holds only because the two labs are named
    differently — see the same-name test below, which behaves very differently.
    """
    one = two_routers(matching_subnets=True)
    one.name = "kgui-coexist-one"
    two = two_routers(matching_subnets=True)
    two.name = "kgui-coexist-two"

    dir_one, dir_two = tmp_path / "one", tmp_path / "two"
    try:
        assert sorted(runner.deploy(one, dir_one, confirm=True).running) == ["r1", "r2"]
        assert sorted(runner.deploy(two, dir_two, confirm=True).running) == ["r1", "r2"]

        # Stopping one leaves the other alone.
        runner.undeploy(one, dir_one)
        assert runner.status(one, dir_one).running == []
        assert sorted(runner.status(two, dir_two).running) == ["r1", "r2"]
    finally:
        runner.undeploy(one, dir_one)
        runner.undeploy(two, dir_two)


# -- asking before stopping something ----------------------------------


def test_a_first_deploy_needs_no_confirmation(working_lab: Topology, lab_dir: Path) -> None:
    """Nothing is running, so there is nothing to ask about."""
    status = runner.deploy(working_lab, lab_dir)
    assert status.needs_confirmation is False
    assert sorted(status.running) == ["r1", "r2"]


def test_deploying_over_a_running_lab_asks_first(
    working_lab: Topology, lab_dir: Path
) -> None:
    runner.deploy(working_lab, lab_dir)
    status = runner.deploy(working_lab, lab_dir)

    assert status.needs_confirmation is True
    assert status.conflicts is not None
    assert sorted(status.conflicts.expected) == ["r1", "r2"]


def test_asking_changes_nothing(working_lab: Topology, lab_dir: Path) -> None:
    """The point of asking is that the lab is still there afterwards."""
    runner.deploy(working_lab, lab_dir)
    runner.deploy(working_lab, lab_dir)  # refused, awaiting confirmation

    assert sorted(runner.status(working_lab, lab_dir).running) == ["r1", "r2"]


def test_confirming_stops_and_redeploys(working_lab: Topology, lab_dir: Path) -> None:
    runner.deploy(working_lab, lab_dir)
    status = runner.deploy(working_lab, lab_dir, confirm=True)

    assert status.needs_confirmation is False
    assert sorted(status.running) == ["r1", "r2"]
    assert status.message is not None
    assert "Stopped 2 devices" in status.message


def test_a_different_lab_sharing_the_name_is_reported_as_unexpected(
    tmp_path: Path,
) -> None:
    """The case that makes confirmation necessary rather than merely polite.

    Kathará hashes the lab *name*, so two labs called "untitled" in different
    folders are one lab to it. Deploying the second would destroy the first,
    and from inside a deploy that is indistinguishable from a redeploy.

    A device running under our name that is *not* in our topology is the
    signal that something else is using it.
    """
    first = Topology(
        name="kgui-shared-name",
        nodes=[
            Node(
                name="alpha",
                image=IMAGE,
                interfaces=[Interface(number=0, collision_domain="A", ip="10.7.7.1/24")],
            )
        ],
    )
    second = Topology(
        name="kgui-shared-name",  # same name, different folder and devices
        nodes=[
            Node(
                name="beta",
                image=IMAGE,
                interfaces=[Interface(number=0, collision_domain="A", ip="10.7.7.2/24")],
            )
        ],
    )

    try:
        runner.deploy(first, tmp_path / "one")
        status = runner.deploy(second, tmp_path / "two")

        assert status.needs_confirmation is True
        assert status.conflicts is not None
        # `alpha` is not in the second topology, so it can only be another lab.
        assert status.conflicts.unexpected == ("alpha",)
        assert status.conflicts.expected == ()

        # And it is still running, because we asked instead of assuming.
        assert runner.status(first, tmp_path / "one").running == ["alpha"]
    finally:
        runner.undeploy(first, tmp_path / "one")
        runner.undeploy(second, tmp_path / "two")


def test_a_container_that_dies_is_not_reported_as_running(tmp_path: Path) -> None:
    """The reported defect, reproduced against a real daemon.

    Docker does not restart Kathará containers, so a Docker restart or a
    machine sleeping overnight leaves the lab exactly like this: ``kathara
    list`` still lists every device, and ``kathara connect`` answers with a 409
    saying the container is not running. The interface has to say so rather
    than reporting a healthy lab.
    """
    import docker

    topology = two_routers(matching_subnets=True)
    lab = tmp_path / "dies"

    try:
        runner.deploy(topology, lab)
        assert runner.status(topology, lab).running == ["r1", "r2"]

        # Stop one the way an external event would, leaving the container in
        # place rather than removing it.
        client = docker.from_env()
        (container,) = [
            c for c in client.containers.list() if c.name.endswith("_r1_" + _hash(topology))
        ]
        container.stop(timeout=5)

        status = runner.status(topology, lab)
        assert status.exited == ["r1"]
        assert status.running == ["r2"]
        # Still "deployed": r1's name is taken, so a redeploy needs a stop first.
        assert status.deployed is True
    finally:
        runner.undeploy(topology, lab)


def test_the_exited_container_still_blocks_a_fresh_deploy(tmp_path: Path) -> None:
    """Why EXITED is not the same as STOPPED: the name is still claimed."""
    import docker

    topology = two_routers(matching_subnets=True)
    lab = tmp_path / "blocks"

    try:
        runner.deploy(topology, lab)
        client = docker.from_env()
        for container in client.containers.list():
            if container.name.endswith("_r1_" + _hash(topology)):
                container.stop(timeout=5)

        conflicts = runner.find_conflicts(topology, lab)
        assert "r1" in conflicts.expected, "an exited container still owns its name"

        # And confirming really does recover the lab.
        recovered = runner.deploy(topology, lab, confirm=True)
        assert sorted(recovered.running) == ["r1", "r2"]
        assert recovered.exited == []
    finally:
        runner.undeploy(topology, lab)


def _hash(topology: Topology) -> str:
    from Kathara.utils import generate_urlsafe_hash

    return generate_urlsafe_hash(topology.name)
