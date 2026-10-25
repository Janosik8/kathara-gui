"""The session's snapshot of what was deployed, kept per lab folder (test 3E.2).

A lab keeps running while another scenario is open. With one snapshot for the
whole session, opening B while A ran compared B against A's snapshot, and
reopening A found nothing of its own.
"""

from __future__ import annotations

from pathlib import Path

from kathara_gui.domain.model import Interface, Node, Topology
from kathara_gui.project.session import Session


def lab(name: str) -> Topology:
    return Topology(
        name=name,
        nodes=[Node(name="r1", interfaces=[Interface(number=0, collision_domain="A")])],
    )


def open_scenario(session: Session, folder: Path, topology: Topology) -> None:
    """What opening a scenario does to the session."""
    session.replace(topology, dirty=False)
    session.mark_saved(folder)


def test_opening_another_scenario_does_not_inherit_the_running_lab(tmp_path: Path) -> None:
    session = Session(workspace_root=tmp_path)
    open_scenario(session, tmp_path / "a", lab("a"))
    session.mark_deployed(lab("a"))

    open_scenario(session, tmp_path / "b", lab("b"))
    assert session.deployed_topology is None


def test_reopening_the_running_lab_finds_its_own_snapshot(tmp_path: Path) -> None:
    session = Session(workspace_root=tmp_path)
    open_scenario(session, tmp_path / "a", lab("a"))
    session.mark_deployed(lab("a"))
    open_scenario(session, tmp_path / "b", lab("b"))

    open_scenario(session, tmp_path / "a", lab("a"))
    snapshot = session.deployed_topology
    assert snapshot is not None and snapshot.name == "a"


def test_stopping_one_lab_leaves_the_others(tmp_path: Path) -> None:
    session = Session(workspace_root=tmp_path)
    open_scenario(session, tmp_path / "a", lab("a"))
    session.mark_deployed(lab("a"))
    open_scenario(session, tmp_path / "b", lab("b"))
    session.mark_deployed(lab("b"))

    session.mark_deployed(None)  # B stopped
    open_scenario(session, tmp_path / "a", lab("a"))
    assert session.deployed_topology is not None

    session.forget_deployed()  # kathara wipe
    assert session.deployed_topology is None


def test_a_new_scenario_keeps_the_running_labs_snapshots(tmp_path: Path) -> None:
    # New... does not stop anything, so A is still running when it is reopened.
    session = Session(workspace_root=tmp_path)
    open_scenario(session, tmp_path / "a", lab("a"))
    session.mark_deployed(lab("a"))
    session.reset()
    assert session.deployed_topology is None

    open_scenario(session, tmp_path / "a", lab("a"))
    assert session.deployed_topology is not None
