"""The HTTP surface the canvas talks to."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from kathara_gui.main import create_app
from kathara_gui.project.session import Session, get_session

TOKEN = "test-token-value"


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A client with its own Session, so tests cannot leak state into each other."""
    app = create_app(token=TOKEN)
    # One session for the whole test: returning a fresh Session per request
    # would silently discard every edit between calls.
    session = Session()
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app, headers={"X-KGUI-Token": TOKEN}) as test_client:
        yield test_client


TRIANGLE = {
    "name": "ospf-triangle",
    "nodes": [
        {
            "name": "r1",
            "kind": "router",
            "position": {"x": 100, "y": 50},
            "daemons": ["zebra", "ospfd"],
            "interfaces": [{"number": 0, "collision_domain": "A", "ip": "10.0.0.1/24"}],
        },
        {
            "name": "r2",
            "kind": "router",
            "position": {"x": 300, "y": 50},
            "interfaces": [{"number": 0, "collision_domain": "A", "ip": "10.0.0.2/24"}],
        },
    ],
}


def test_starts_from_an_empty_topology(client: TestClient) -> None:
    body = client.get("/api/topology").json()
    assert body["topology"]["nodes"] == []
    assert body["dirty"] is False
    assert body["path"] is None


def test_replacing_the_topology_round_trips(client: TestClient) -> None:
    response = client.put("/api/topology", json=TRIANGLE)
    assert response.status_code == 200

    stored = client.get("/api/topology").json()["topology"]
    assert [n["name"] for n in stored["nodes"]] == ["r1", "r2"]
    assert stored["nodes"][0]["position"] == {"x": 100.0, "y": 50.0}


def test_editing_marks_the_session_dirty(client: TestClient) -> None:
    assert client.put("/api/topology", json=TRIANGLE).json()["dirty"] is True


def test_reset_returns_to_an_empty_topology(client: TestClient) -> None:
    client.put("/api/topology", json=TRIANGLE)
    body = client.post("/api/topology/reset").json()
    assert body["topology"]["nodes"] == []
    assert body["dirty"] is False


# -- validation surfaces the model's own wording ----------------------


def test_windows_reserved_device_name_is_rejected(client: TestClient) -> None:
    payload = {"name": "lab", "nodes": [{"name": "con"}]}
    response = client.put("/api/topology", json=payload)
    assert response.status_code == 422
    assert "reserved" in response.text.lower()


def test_case_colliding_device_names_are_rejected(client: TestClient) -> None:
    payload = {"name": "lab", "nodes": [{"name": "R1"}, {"name": "r1"}]}
    response = client.put("/api/topology", json=payload)
    assert response.status_code == 422
    assert "case" in response.text.lower()


def test_duplicate_interface_numbers_are_rejected(client: TestClient) -> None:
    payload = {
        "name": "lab",
        "nodes": [
            {
                "name": "r1",
                "interfaces": [
                    {"number": 0, "collision_domain": "A"},
                    {"number": 0, "collision_domain": "B"},
                ],
            }
        ],
    }
    assert client.put("/api/topology", json=payload).status_code == 422


def test_a_subnet_with_host_bits_set_is_rejected(client: TestClient) -> None:
    payload = {
        "name": "lab",
        "nodes": [],
        "collision_domains": [{"name": "A", "subnet": "10.0.0.1/24"}],
    }
    response = client.put("/api/topology", json=payload)
    assert response.status_code == 422
    assert "host bits" in response.text.lower()


# -- import / export ---------------------------------------------------


def test_import_reads_a_hand_written_lab(client: TestClient) -> None:
    body = client.post(
        "/api/topology/import",
        json={"text": 'LAB_NAME="imported"\nr1[0]="A"\nr2[0]="A"\n'},
    ).json()

    assert body["topology"]["name"] == "imported"
    assert [n["name"] for n in body["topology"]["nodes"]] == ["r1", "r2"]
    assert body["warnings"] == []


def test_import_becomes_the_edited_topology(client: TestClient) -> None:
    client.post("/api/topology/import", json={"text": 'r1[0]="A"\n'})
    assert len(client.get("/api/topology").json()["topology"]["nodes"]) == 1


def test_import_reports_unreadable_lines_without_failing(client: TestClient) -> None:
    body = client.post(
        "/api/topology/import", json={"text": 'r1[0]="A"\nthis is not valid\n'}
    ).json()
    assert len(body["topology"]["nodes"]) == 1
    assert any("could not understand" in w for w in body["warnings"])


def test_import_rejects_an_impossible_topology_with_a_readable_message(
    client: TestClient,
) -> None:
    """Parses as text, but describes two devices that collide on macOS."""
    response = client.post("/api/topology/import", json={"text": 'R1[0]="A"\nr1[1]="B"\n'})
    assert response.status_code == 422
    assert "case" in response.json()["detail"].lower()


def test_export_renders_lab_conf(client: TestClient) -> None:
    client.put("/api/topology", json=TRIANGLE)
    text = client.get("/api/topology/export").json()["text"]

    assert 'r1[0]="A"' in text
    assert 'LAB_NAME="ospf-triangle"' in text
    # Positions ride along in comments so the layout survives.
    assert "kgui:node r1 pos=100,50" in text


def test_export_then_import_preserves_positions(client: TestClient) -> None:
    client.put("/api/topology", json=TRIANGLE)
    text = client.get("/api/topology/export").json()["text"]

    reimported = client.post("/api/topology/import", json={"text": text}).json()
    positions = {n["name"]: n["position"] for n in reimported["topology"]["nodes"]}
    assert positions["r1"] == {"x": 100.0, "y": 50.0}
    assert positions["r2"] == {"x": 300.0, "y": 50.0}


def test_topology_endpoints_require_the_session_token() -> None:
    app = create_app(token=TOKEN)
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/topology").status_code == 401
