"""A lab's name, folder and running containers, over the API, on real Docker.

Test step 3E.2, findings F33 and F34. Enable with ``pytest -m docker``.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kathara_gui.main import create_app
from kathara_gui.project.session import Session, get_session

pytestmark = pytest.mark.docker

TOKEN = "test-token-value"


def lab(name: str, subnet: int) -> dict:
    return {
        "name": name,
        "nodes": [
            {
                "name": "r1",
                "kind": "router",
                "image": "kathara/frr",
                "daemons": ["zebra"],
                "interfaces": [
                    {"number": 0, "collision_domain": "A", "ip": f"172.31.{subnet}.1/24"}
                ],
            }
        ],
    }


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    return tmp_path / "workspace"


@pytest.fixture
def client(workspace: Path) -> Iterator[TestClient]:
    session = Session(workspace_root=workspace)
    app = create_app(token=TOKEN)
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app, headers={"X-KGUI-Token": TOKEN}) as test_client:
        started: list[dict] = []
        test_client.started = started  # type: ignore[attr-defined]
        try:
            yield test_client
        finally:
            for topology in started:
                test_client.post("/api/lab/undeploy", json={"topology": topology})


def deploy(client: TestClient, topology: dict) -> dict:
    body = client.post("/api/lab/deploy", json={"topology": topology, "confirm": False}).json()
    client.started.append(topology)  # type: ignore[attr-defined]
    return body


def status(client: TestClient, topology: dict) -> dict:
    return client.post("/api/lab/status", json={"topology": topology}).json()


def test_a_lab_renamed_and_deployed_without_saving_runs_from_its_new_folder(
    client: TestClient, workspace: Path
) -> None:
    client.post("/api/project/save", json={"topology": lab("kgui id first", 41)})

    renamed = lab("kgui id renamed", 41)
    body = deploy(client, renamed)

    assert body["deployed"] is True, body
    assert Path(body["lab_dir"]) == workspace / "kgui id renamed"
    assert not (workspace / "kgui id first").exists()
    assert status(client, renamed)["running"] == ["r1"]


def test_reopening_a_scenario_whose_lab_runs_finds_it_running(
    client: TestClient, workspace: Path
) -> None:
    a, b = lab("kgui id a", 42), lab("kgui id b", 43)
    client.post("/api/project/save", json={"topology": b})
    client.post("/api/project/save", json={"topology": a, "name": "kgui id a"})
    assert deploy(client, a)["deployed"] is True

    client.post("/api/project/open", json={"folder": "kgui id b"})
    seen_from_b = status(client, b)
    assert seen_from_b["deployed"] is False
    assert seen_from_b["drift"] == []  # not measured against A's snapshot

    opened = client.post("/api/project/open", json={"folder": "kgui id a"}).json()
    again = status(client, opened["topology"])
    assert again["deployed"] is True
    assert again["running"] == ["r1"]
