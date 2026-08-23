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


@pytest.fixture(autouse=True)
def isolated_lab_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep test labs out of the developer's real ~/.kathara-gui directory."""
    monkeypatch.setattr(runner, "WORKING_ROOT", tmp_path / "labs")


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
def working_lab() -> Iterator[Topology]:
    topology = two_routers(matching_subnets=True)
    try:
        yield topology
    finally:
        runner.undeploy(topology)


@pytest.fixture
def broken_lab() -> Iterator[Topology]:
    topology = two_routers(matching_subnets=False)
    try:
        yield topology
    finally:
        runner.undeploy(topology)


def test_deploy_starts_every_device(working_lab: Topology) -> None:
    status = runner.deploy(working_lab)
    assert sorted(status.running) == ["r1", "r2"]
    assert status.deployed is True


def test_status_reconciles_against_docker(working_lab: Topology) -> None:
    assert runner.status(working_lab).deployed is False
    runner.deploy(working_lab)
    assert runner.status(working_lab).deployed is True


def test_undeploy_stops_everything(working_lab: Topology) -> None:
    runner.deploy(working_lab)
    status = runner.undeploy(working_lab)
    assert status.running == []
    assert status.deployed is False


def test_diagnostics_pass_on_a_correct_link(working_lab: Topology) -> None:
    runner.deploy(working_lab)
    report = diagnostics.verify(working_lab)

    assert report.failed == 0
    assert report.passed == 1
    assert report.healthy is True
    assert "packet loss" in report.checks[0].detail


def test_diagnostics_catch_a_link_that_looks_configured_but_is_not(
    broken_lab: Topology,
) -> None:
    """The failure Capability 4 exists for.

    Every interface is up and every address is valid, so nothing in the
    configuration looks wrong — but the two ends are on different networks and
    cannot reach each other.
    """
    runner.deploy(broken_lab)
    report = diagnostics.verify(broken_lab)

    assert report.failed == 1
    assert report.healthy is False
    assert report.checks[0].outcome is Outcome.FAIL


def test_diagnostics_report_where_the_fault_is(broken_lab: Topology) -> None:
    runner.deploy(broken_lab)
    check = diagnostics.verify(broken_lab).checks[0]

    assert check.collision_domain == "A"
    assert {check.source, check.target} == {"r1", "r2"}


def test_verifying_before_deploying_explains_itself(tmp_path: Path) -> None:
    topology = two_routers(matching_subnets=True)
    topology.name = "kgui-never-deployed"
    report = diagnostics.verify(topology)

    assert report.checks == []
    assert report.message is not None
    assert "Deploy it" in report.message


def test_unaddressed_links_are_skipped_not_failed() -> None:
    topology = Topology(
        name="kgui-unaddressed",
        nodes=[
            Node(name="r1", image=IMAGE, interfaces=[Interface(number=0, collision_domain="A")]),
            Node(name="r2", image=IMAGE, interfaces=[Interface(number=0, collision_domain="A")]),
        ],
    )
    try:
        runner.deploy(topology)
        report = diagnostics.verify(topology)
        assert report.skipped == 1
        assert report.failed == 0
    finally:
        runner.undeploy(topology)


def test_deploying_nothing_says_so() -> None:
    status = runner.deploy(Topology(name="kgui-empty"))
    assert status.deployed is False
    assert status.message == "There is nothing to deploy."
