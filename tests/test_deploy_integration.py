"""End-to-end: a topology designed in the model becomes a working network.

This closes the loop that the Phase 0 spike opened. The spike drove Kathara's
API directly; here the lab comes from the codec instead, so a pass means the
whole generated chain is sound::

    Topology -> lab.conf + .startup -> Kathara -> containers that can ping

Requires a running Docker daemon, so it is marked ``docker`` and excluded from
the default run. Enable with ``pytest -m docker``.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from Kathara.manager.Kathara import Kathara
from Kathara.parser.netkit.LabParser import LabParser

from kathara_gui.domain.model import Interface, Node, Position, Topology
from kathara_gui.kathara.readiness import wait_for_lab
from kathara_gui.project.labdir import write_lab

pytestmark = pytest.mark.docker

IMAGE = "kathara/base"


@pytest.fixture
def deployed_pair(tmp_path: Path) -> Iterator[tuple[Kathara, object]]:
    """Deploy a two-device lab built entirely by the codec, and clean it up."""
    topology = Topology(
        name="kgui-codec-integration",
        nodes=[
            Node(
                name="r1",
                kind="router",
                image=IMAGE,
                position=Position(x=10, y=20),
                interfaces=[Interface(number=0, collision_domain="A", ip="172.31.9.1/24")],
            ),
            Node(
                name="r2",
                kind="router",
                image=IMAGE,
                position=Position(x=200, y=20),
                interfaces=[Interface(number=0, collision_domain="A", ip="172.31.9.2/24")],
            ),
        ],
    )

    lab_dir = write_lab(topology, tmp_path / "lab")
    lab = LabParser.parse(str(lab_dir))
    manager = Kathara.get_instance()

    manager.deploy_lab(lab)
    try:
        # Not Kathara's wait=True: that polls stdin, which no backend has.
        wait_for_lab(manager, lab, timeout=90)
        yield manager, lab
    finally:
        manager.undeploy_lab(lab=lab)


def test_generated_lab_deploys_and_the_addressing_works(deployed_pair) -> None:
    """The ping only succeeds if the generated .startup scripts ran correctly."""
    manager, lab = deployed_pair

    stdout, stderr, exit_code = manager.exec(
        "r1", ["ping", "-c", "2", "-W", "2", "172.31.9.2"], lab=lab, wait=False, stream=False
    )
    output = stdout.decode(errors="replace") if isinstance(stdout, bytes) else str(stdout)
    assert exit_code == 0, f"ping failed: {output}\n{stderr!r}"
    assert "0% packet loss" in output


def test_addresses_from_the_model_are_present_on_the_interface(deployed_pair) -> None:
    manager, lab = deployed_pair

    stdout, _, exit_code = manager.exec(
        "r1", ["ip", "-4", "addr", "show", "eth0"], lab=lab, wait=False, stream=False
    )
    output = stdout.decode(errors="replace") if isinstance(stdout, bytes) else str(stdout)
    assert exit_code == 0
    assert "172.31.9.1/24" in output
