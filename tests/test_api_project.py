"""Saving, opening, sharing and capturing a scenario over HTTP.

This is the half of Capability 5 that makes the rest reachable: the package
format and the configuration capture were built first and could not be invoked
from anywhere. FR-11, FR-12, FR-14, FR-24, FR-25 and FR-26 all land here.

No Docker: capture against live containers is covered by
``test_state_capture_integration.py``. What matters here is the HTTP contract
and, above all, that a package cannot write outside the workspace.
"""

from __future__ import annotations

import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kathara_gui.main import create_app
from kathara_gui.project import kgui
from kathara_gui.project.session import Session, get_session

TOKEN = "test-token-value"

TRIANGLE = {
    "name": "ospf triangle",
    "nodes": [
        {
            "name": "r1",
            "kind": "router",
            "image": "kathara/frr",
            "position": {"x": 100, "y": 50},
            "daemons": ["zebra", "ospfd"],
            "interfaces": [{"number": 0, "collision_domain": "A", "ip": "10.0.0.1/24"}],
        },
        {
            "name": "r2",
            "kind": "router",
            "image": "kathara/frr",
            "position": {"x": 300, "y": 50},
            "interfaces": [{"number": 0, "collision_domain": "A", "ip": "10.0.0.2/24"}],
        },
    ],
}


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    return tmp_path / "workspace"


@pytest.fixture
def session(workspace: Path) -> Session:
    return Session(workspace_root=workspace)


@pytest.fixture
def client(session: Session) -> Iterator[TestClient]:
    app = create_app(token=TOKEN)
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app, headers={"X-KGUI-Token": TOKEN}) as test_client:
        yield test_client


def save(client: TestClient, topology: dict | None = None, **body: object) -> dict:
    response = client.post(
        "/api/project/save", json={"topology": topology or TRIANGLE, **body}
    )
    assert response.status_code == 200, response.text
    return response.json()


# -- saving -------------------------------------------------------------


def test_saving_writes_a_package_into_the_workspace(client: TestClient, workspace: Path) -> None:
    body = save(client)
    written = Path(body["path"])

    assert written.parent == workspace.resolve()
    assert written.is_file()
    assert zipfile.is_zipfile(written)


def test_the_file_name_comes_from_the_scenario_name(client: TestClient) -> None:
    """And a name with a space in it still produces a usable file name."""
    assert save(client)["filename"] == "ospf-triangle.kgui"


def test_an_explicit_file_name_wins(client: TestClient) -> None:
    assert save(client, filename="submission-group-b")["filename"] == "submission-group-b.kgui"


def test_saving_clears_the_unsaved_marker(client: TestClient, session: Session) -> None:
    client.put("/api/topology", json=TRIANGLE)
    assert session.dirty is True

    save(client)
    assert session.dirty is False
    assert session.project_file is not None


def test_the_saved_package_carries_a_runnable_lab(client: TestClient) -> None:
    """Someone with Kathará and not this application can unzip and lstart."""
    with zipfile.ZipFile(save(client)["path"]) as archive:
        names = set(archive.namelist())

    assert "topology.json" in names
    assert "lab/lab.conf" in names
    assert "lab/r1.startup" in names


def test_saving_twice_produces_the_same_bytes(client: TestClient) -> None:
    """Fixed timestamps, so an unchanged scenario is not endlessly re-versioned."""
    first = Path(save(client)["path"]).read_bytes()
    assert Path(save(client)["path"]).read_bytes() == first


# -- the workspace boundary --------------------------------------------


@pytest.mark.parametrize(
    ("attempt", "lands_as"),
    [
        ("../escaped", "escaped.kgui"),
        ("../../../../etc/passwd", "passwd.kgui"),
        ("/etc/passwd", "passwd.kgui"),
        ("nested/inside", "inside.kgui"),
        # Degenerate names become the default rather than being honoured;
        # "con" is a reserved device name on Windows and cannot be a file.
        ("..", "untitled.kgui"),
        ("con", "untitled.kgui"),
        ("   ", "untitled.kgui"),
    ],
)
def test_a_file_name_cannot_escape_the_workspace(
    client: TestClient, workspace: Path, attempt: str, lands_as: str
) -> None:
    """The scenario name is free text a student typed, and a package may be
    sent by anyone. Neither may name a path.

    The directory part is discarded and the remainder sanitised, so these are
    accepted but declawed rather than rejected — the user gets their file, just
    not where the string asked for it.
    """
    written = Path(save(client, filename=attempt)["path"])

    assert written.parent == workspace.resolve()
    assert written.name == lands_as


def test_the_sanitiser_never_yields_an_empty_name() -> None:
    """`_package_path` rejects an empty stem; this is the invariant that makes
    that branch unreachable in practice, and would fail loudly if it changed."""
    from kathara_gui.domain.naming import safe_dir_name

    for hostile in ["..", ".", "", "   ", "/", "///", "con", "NUL", "?*<>|"]:
        assert safe_dir_name(Path(hostile).name), f"{hostile!r} produced an empty name"


def test_opening_refuses_a_name_that_is_not_in_the_workspace(client: TestClient) -> None:
    response = client.post("/api/project/open", json={"filename": "../../../etc/passwd"})
    assert response.status_code in (400, 404)


# -- listing ------------------------------------------------------------


def test_listing_is_empty_before_anything_is_saved(client: TestClient) -> None:
    assert client.get("/api/project/packages").json() == []


def test_listing_reports_the_stored_scenario_name(client: TestClient) -> None:
    save(client, filename="week-3")
    (entry,) = client.get("/api/project/packages").json()

    assert entry["filename"] == "week-3.kgui"
    # The name inside the package, not the file it happens to live in.
    assert entry["name"] == "ospf triangle"
    assert entry["size"] > 0


def test_an_unreadable_package_is_still_listed(client: TestClient, workspace: Path) -> None:
    """Hiding it would leave the user unable to see that the file is there."""
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "corrupt.kgui").write_bytes(b"not a zip at all")

    names = {entry["filename"] for entry in client.get("/api/project/packages").json()}
    assert "corrupt.kgui" in names


# -- opening ------------------------------------------------------------


def test_a_saved_scenario_reopens_as_it_was(client: TestClient) -> None:
    filename = save(client)["filename"]
    client.post("/api/topology/reset")

    body = client.post("/api/project/open", json={"filename": filename}).json()
    assert body["topology"]["name"] == "ospf triangle"
    assert [n["name"] for n in body["topology"]["nodes"]] == ["r1", "r2"]


def test_reopening_preserves_canvas_positions(client: TestClient) -> None:
    """FR-30. A layout the user arranged is part of the document."""
    filename = save(client)["filename"]
    body = client.post("/api/project/open", json={"filename": filename}).json()

    positions = {n["name"]: n["position"] for n in body["topology"]["nodes"]}
    assert positions["r1"] == {"x": 100, "y": 50}
    assert positions["r2"] == {"x": 300, "y": 50}


def test_opening_writes_the_lab_out_so_it_can_be_deployed(client: TestClient) -> None:
    filename = save(client)["filename"]
    body = client.post("/api/project/open", json={"filename": filename}).json()

    lab_dir = Path(body["lab_dir"])
    assert (lab_dir / "lab.conf").is_file()
    assert (lab_dir / "r1.startup").is_file()


def test_opening_adopts_the_scenario_as_the_current_one(
    client: TestClient, session: Session
) -> None:
    filename = save(client)["filename"]
    client.post("/api/topology/reset")
    assert session.topology.name == "untitled"

    client.post("/api/project/open", json={"filename": filename})
    assert session.topology.name == "ospf triangle"
    # Freshly opened is not unsaved work.
    assert session.dirty is False


def test_a_deploy_after_opening_uses_the_packaged_lab(
    client: TestClient, session: Session
) -> None:
    """Not the workspace default: the packaged lab carries captured state."""
    filename = save(client)["filename"]
    body = client.post("/api/project/open", json={"filename": filename}).json()

    assert str(session.lab_dir(session.topology)) == body["lab_dir"]


def test_opening_something_that_is_not_there_is_a_404(client: TestClient) -> None:
    assert client.post("/api/project/open", json={"filename": "absent"}).status_code == 404


def test_opening_a_corrupt_package_explains_rather_than_crashes(
    client: TestClient, workspace: Path
) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "corrupt.kgui").write_bytes(b"not a zip at all")

    response = client.post("/api/project/open", json={"filename": "corrupt"})
    assert response.status_code == 400
    assert "readable archive" in response.json()["detail"]


# -- download and upload ------------------------------------------------


def test_download_returns_the_package_as_an_attachment(client: TestClient) -> None:
    response = client.post("/api/project/download", json={"topology": TRIANGLE})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert 'filename="ospf-triangle.kgui"' in response.headers["content-disposition"]


def test_a_downloaded_package_is_a_real_scenario(client: TestClient, tmp_path: Path) -> None:
    response = client.post("/api/project/download", json={"topology": TRIANGLE})
    landed = tmp_path / "downloaded.kgui"
    landed.write_bytes(response.content)

    assert kgui.read_package(landed).topology.name == "ospf triangle"


def test_downloading_leaves_no_scratch_file_behind(client: TestClient, workspace: Path) -> None:
    client.post("/api/project/download", json={"topology": TRIANGLE})
    assert list((workspace / ".download").glob("*.kgui")) == []


def test_downloading_does_not_count_as_saving(client: TestClient, session: Session) -> None:
    """It leaves the machine; it does not give the scenario a home on it."""
    client.put("/api/topology", json=TRIANGLE)
    client.post("/api/project/download", json={"topology": TRIANGLE})

    assert session.dirty is True
    assert session.project_file is None


def test_an_uploaded_package_becomes_the_current_scenario(
    client: TestClient, tmp_path: Path
) -> None:
    """The instructor's path: a submission arrives from outside the machine."""
    payload = client.post("/api/project/download", json={"topology": TRIANGLE}).content
    client.post("/api/topology/reset")

    body = client.post(
        "/api/project/upload",
        content=payload,
        headers={"X-KGUI-Filename": "submission-jan.kgui"},
    ).json()

    assert body["topology"]["name"] == "ospf triangle"
    assert Path(body["project_file"]).name == "submission-jan.kgui"


def test_an_upload_is_kept_in_the_workspace(client: TestClient) -> None:
    """So an opened submission is a file the marker can find again."""
    payload = client.post("/api/project/download", json={"topology": TRIANGLE}).content
    client.post(
        "/api/project/upload", content=payload, headers={"X-KGUI-Filename": "submission.kgui"}
    )

    names = {entry["filename"] for entry in client.get("/api/project/packages").json()}
    assert "submission.kgui" in names


def test_an_upload_cannot_choose_where_it_lands(client: TestClient, workspace: Path) -> None:
    payload = client.post("/api/project/download", json={"topology": TRIANGLE}).content
    response = client.post(
        "/api/project/upload",
        content=payload,
        headers={"X-KGUI-Filename": "../../../../tmp/escaped.kgui"},
    )

    if response.status_code == 200:
        assert Path(response.json()["project_file"]).parent == workspace.resolve()
    else:
        assert response.status_code == 400


def test_an_empty_upload_is_refused(client: TestClient) -> None:
    assert client.post("/api/project/upload", content=b"").status_code == 400


def test_something_that_is_not_a_package_is_refused(client: TestClient) -> None:
    response = client.post("/api/project/upload", content=b"this is not a zip")
    assert response.status_code == 400
    assert "readable archive" in response.json()["detail"]


# -- project state ------------------------------------------------------


def test_state_reports_where_the_scenario_stands(client: TestClient, workspace: Path) -> None:
    body = client.get("/api/project").json()
    assert body["name"] == "untitled"
    assert body["project_file"] is None
    assert body["workspace"] == str(workspace.resolve())


def test_state_reports_the_file_once_saved(client: TestClient) -> None:
    save(client)
    body = client.get("/api/project").json()

    assert body["project_file"].endswith("ospf-triangle.kgui")
    assert body["dirty"] is False


def test_feature_toggles_travel_with_the_scenario(client: TestClient, session: Session) -> None:
    """Capability 8: an exam's restrictions are part of the file, not the machine."""
    from kathara_gui.features import Features

    session.set_features(Features(subnet_calculator=False))
    filename = save(client)["filename"]
    session.set_features(Features())  # a fresh, permissive session

    body = client.post("/api/project/open", json={"filename": filename}).json()
    assert body["features"]["subnet_calculator"] is False
    assert session.features.subnet_calculator is False
