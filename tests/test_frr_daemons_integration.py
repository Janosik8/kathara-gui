"""The daemon list against FRR itself (bug 29: "all the daemons that can be set
on FRR need to be added").

A list typed out by hand drifts from the image it describes, so this reads
the image's own ``/etc/frr/daemons``, and then deploys a router with daemons
that were missing before, to see that they actually run.
Requires a running Docker daemon; enable with ``pytest -m docker``.
"""

from __future__ import annotations

import re
import time
from collections.abc import Iterator
from pathlib import Path

import docker
import pytest

from kathara_gui.domain.model import KNOWN_DAEMONS, Interface, Node, Topology
from kathara_gui.kathara import runner

pytestmark = pytest.mark.docker

IMAGE = "kathara/frr"

#: Added for bug 29; each runs a process of its own name once enabled.
NEWLY_OFFERED = ["ldpd", "eigrpd", "bfdd", "vrrpd"]


def test_every_daemon_the_image_can_switch_on_is_offered() -> None:
    text = docker.from_env().containers.run(
        IMAGE, entrypoint=["cat", "/etc/frr/daemons"], remove=True
    ).decode()
    # `name=yes|no` lines only: not `name_options=…` or `vtysh_enable`.
    switchable = set(re.findall(r"^(\w+d)=(?:yes|no)\s*$", text, re.MULTILINE))
    assert switchable, "the image's daemons file has changed shape"
    assert switchable <= KNOWN_DAEMONS, sorted(switchable - KNOWN_DAEMONS)


@pytest.fixture
def lab_dir(tmp_path: Path) -> Path:
    return tmp_path / "labs" / "daemons"


@pytest.fixture
def deployed(lab_dir: Path) -> Iterator[Topology]:
    topology = Topology(
        name="kgui-daemons-integration",
        nodes=[
            Node(
                name="r1",
                image=IMAGE,
                daemons=["zebra", *NEWLY_OFFERED],
                interfaces=[Interface(number=0, collision_domain="A", ip="172.31.31.1/24")],
            )
        ],
    )
    status = runner.deploy(topology, lab_dir, confirm=True)
    assert status.deployed, status.message
    try:
        yield topology
    finally:
        runner.undeploy(topology, lab_dir)


def running_processes(lab_dir: Path) -> str:
    from Kathara.manager.Kathara import Kathara
    from Kathara.parser.netkit.LabParser import LabParser

    lab = LabParser.parse(str(lab_dir))
    stdout, _, _ = Kathara.get_instance().exec(
        "r1", ["ps", "-eo", "comm"], lab=lab, wait=False, stream=False
    )
    return stdout.decode(errors="replace") if isinstance(stdout, bytes) else str(stdout)


def test_newly_offered_daemons_actually_run(deployed: Topology, lab_dir: Path) -> None:
    # FRR starts its daemons just after the container reports ready.
    deadline = time.monotonic() + 30
    while True:
        processes = running_processes(lab_dir).split()
        missing = [d for d in NEWLY_OFFERED if d not in processes]
        if not missing or time.monotonic() > deadline:
            break
        time.sleep(1)
    assert not missing, f"not running: {missing}; running: {processes}"
