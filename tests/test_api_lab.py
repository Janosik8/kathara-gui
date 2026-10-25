"""Stopping every lab at once — ``kathara wipe`` — over HTTP.

No Docker: Kathará's manager is replaced with a fake that records what it was
asked to do. The real thing is covered in ``test_deploy_runner_integration.py``.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from kathara_gui.domain.model import Topology
from kathara_gui.kathara import runner
from kathara_gui.main import create_app
from kathara_gui.project.session import Session, get_session

TOKEN = "test-token-value"


class FakeManager:
    def __init__(self, devices: list[tuple[str, str, str]], fail: bool = False) -> None:
        self.devices = devices
        self.fail = fail
        self.wiped: list[bool] = []

    def get_machines_api_objects(self) -> list[Any]:
        return [
            SimpleNamespace(labels={"lab_hash": lab, "name": name}, status=status)
            for lab, name, status in self.devices
        ]

    def wipe(self, all_users: bool = False) -> None:
        if self.fail:
            raise RuntimeError("Docker went away")
        self.wiped.append(all_users)
        self.devices = []


@pytest.fixture
def session(tmp_path: Path) -> Session:
    return Session(workspace_root=tmp_path)


@pytest.fixture
def client(session: Session) -> Iterator[TestClient]:
    app = create_app(token=TOKEN)
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app, headers={"X-KGUI-Token": TOKEN}) as test_client:
        yield test_client


def use(monkeypatch: pytest.MonkeyPatch, manager: FakeManager) -> None:
    monkeypatch.setattr(runner.Kathara, "get_instance", staticmethod(lambda: manager))


TWO_LABS = [("labA", "r1", "running"), ("labA", "r2", "running"), ("labB", "pc1", "exited")]


def test_counts_every_lab_not_only_the_one_being_edited(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    use(monkeypatch, FakeManager(TWO_LABS))
    body = client.get("/api/lab/everything").json()
    assert body == {"devices": 3, "labs": 2, "message": None}


def test_wipe_stops_everything_of_this_user_only(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager = FakeManager(TWO_LABS)
    use(monkeypatch, manager)
    session.replace(Topology(name="mine"))
    session.mark_deployed(Topology(name="mine"))

    body = client.post("/api/lab/wipe").json()

    # Never another user's labs: this is the user's own "kathara wipe".
    assert manager.wiped == [False]
    assert body["devices"] == 0 and body["labs"] == 0
    # What this session had deployed went with everything else.
    assert session.deployed_topology is None


def test_a_failed_wipe_says_so_and_forgets_nothing(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    use(monkeypatch, FakeManager(TWO_LABS, fail=True))
    session.replace(Topology(name="mine"))
    session.mark_deployed(Topology(name="mine"))

    response = client.post("/api/lab/wipe")

    assert response.status_code == 200  # a reason, not a 500
    body = response.json()
    assert "Docker went away" in body["message"]
    assert body["devices"] == 3
    assert session.deployed_topology is not None


def test_no_daemon_means_nothing_is_deployed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_daemon() -> Any:
        raise ConnectionError("no Docker")

    monkeypatch.setattr(runner.Kathara, "get_instance", staticmethod(no_daemon))
    assert client.get("/api/lab/everything").json()["devices"] == 0


def test_wipe_needs_the_token(session: Session) -> None:
    app = create_app(token=TOKEN)
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as anonymous:
        assert anonymous.post("/api/lab/wipe").status_code == 401
