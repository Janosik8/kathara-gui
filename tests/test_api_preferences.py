"""The side panels' layout, remembered in the workspace (note 3)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kathara_gui.api.preferences import COLLAPSED, FILE_NAME, SECTIONS
from kathara_gui.main import create_app
from kathara_gui.project.session import Session, get_session

TOKEN = "test-token-value"

DEFAULTS = {
    "panels": {
        "left": {"order": list(SECTIONS["left"]), "collapsed": []},
        "right": {"order": list(SECTIONS["right"]), "collapsed": list(COLLAPSED["right"])},
    }
}


@pytest.fixture
def session(tmp_path: Path) -> Session:
    return Session(workspace_root=tmp_path)


@pytest.fixture
def client(session: Session) -> Iterator[TestClient]:
    app = create_app(token=TOKEN)
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app, headers={"X-KGUI-Token": TOKEN}) as test_client:
        yield test_client


def test_defaults_without_a_file(client: TestClient) -> None:
    assert client.get("/api/preferences").json() == DEFAULTS


def test_a_layout_survives_a_new_server(session: Session, client: TestClient) -> None:
    layout = {
        "panels": {
            "left": {"order": ["topology", "palette", "connect", "domains"], "collapsed": []},
            "right": {
                "order": ["lab", "details", "addressing", "arrange", "scenario", "exam"],
                "collapsed": ["arrange", "details"],
            },
        }
    }
    stored = client.put("/api/preferences", json=layout).json()
    # Collapsed ids come back in default order, which is how they are stored.
    assert stored["panels"]["right"]["collapsed"] == ["details", "arrange"]

    # A relaunch is a new app on a new port over the same workspace.
    again = create_app(token=TOKEN)
    again.dependency_overrides[get_session] = lambda: Session(
        workspace_root=session.workspace_root
    )
    with TestClient(again, headers={"X-KGUI-Token": TOKEN}) as second:
        assert second.get("/api/preferences").json() == stored


@pytest.mark.parametrize("content", ["{not json", '{"panels": 7}', "\xff\xfe"])
def test_a_mangled_file_gives_the_defaults(
    session: Session, client: TestClient, content: str
) -> None:
    (session.workspace_root / FILE_NAME).write_bytes(content.encode("latin-1"))
    assert client.get("/api/preferences").json() == DEFAULTS


def test_unknown_ids_are_dropped_and_missing_ones_return_in_place(
    session: Session, client: TestClient
) -> None:
    (session.workspace_root / FILE_NAME).write_text(
        json.dumps(
            {
                "panels": {
                    # "connect" missing, "chat" unknown, "domains" twice.
                    "left": {"order": ["domains", "chat", "palette", "domains"]},
                    "right": {"order": ["lab"], "collapsed": ["chat", "lab"]},
                }
            }
        ),
        encoding="utf-8",
    )
    panels = client.get("/api/preferences").json()["panels"]
    # A missing id goes after the one that precedes it by default: connect
    # after palette, zones and topology after domains.
    assert panels["left"]["order"] == ["domains", "zones", "topology", "palette", "connect"]
    assert panels["right"]["order"] == [
        "details", "addressing", "arrange", "scenario", "exam", "lab"
    ]
    # A section new to the file arrives collapsed if it starts collapsed.
    assert panels["right"]["collapsed"] == ["exam", "lab"]


def test_a_layout_stored_before_the_exam_section_gains_it_collapsed(
    session: Session, client: TestClient
) -> None:
    """FR-28 added a section; a file from before it must not lose it or open it."""
    order = ["lab", "details", "addressing", "arrange", "scenario"]
    (session.workspace_root / FILE_NAME).parent.mkdir(parents=True, exist_ok=True)
    (session.workspace_root / FILE_NAME).write_text(
        json.dumps({"panels": {"right": {"order": order, "collapsed": []}}}), encoding="utf-8"
    )
    right = client.get("/api/preferences").json()["panels"]["right"]
    assert right["order"] == [*order, "exam"]
    assert right["collapsed"] == ["exam"]


def test_the_file_is_lf_only_and_hidden_from_the_scenario_list(
    session: Session, client: TestClient
) -> None:
    client.put("/api/preferences", json=DEFAULTS)
    raw = (session.workspace_root / FILE_NAME).read_bytes()
    assert b"\r" not in raw
    assert client.get("/api/project/scenarios").json() == []


def test_the_token_is_required(client: TestClient) -> None:
    assert client.get("/api/preferences", headers={"X-KGUI-Token": "wrong"}).status_code == 401
