"""One name per lab, and the folder is the name (test 3E.2, finding F34).

The tester's notes: two labs must never share a name, and a scenario's folder
should be named exactly as the lab. Kathará knows a lab by a hash of its name,
so two folders holding one lab name were one lab to it: deploying either
stopped the other.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kathara_gui.domain.naming import lab_name_problem, suggest_lab_name
from kathara_gui.kathara import runner
from kathara_gui.main import create_app
from kathara_gui.project.session import Session, get_session

TOKEN = "test-token-value"

LAB = {
    "name": "base exam",
    "nodes": [
        {
            "name": "r1",
            "kind": "router",
            "interfaces": [{"number": 0, "collision_domain": "A", "ip": "10.0.0.1/24"}],
        }
    ],
}


def named(name: str) -> dict:
    topology = json.loads(json.dumps(LAB))
    topology["name"] = name
    return topology


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


def save(client: TestClient, topology: dict, **body: object):  # noqa: ANN201
    return client.post("/api/project/save", json={"topology": topology, **body})


# -- the rule ---------------------------------------------------------------


@pytest.mark.parametrize("name", ["base exam", "ćwiczenie 1", "bgp_lab-2", "Łódź", "A"])
def test_letters_digits_spaces_dashes_and_underscores_are_accepted(name: str) -> None:
    assert lab_name_problem(name) is None


@pytest.mark.parametrize(
    ("name", "reason"),
    [
        ("a/b", "'/'"),
        ("a:b", "':'"),
        ("v1.2", "'.'"),
        ("BGP exam, group A", "','"),
        ("CON", "reserved by Windows"),
        (" x", "begin or end with a space"),
        ("x ", "begin or end with a space"),
        ("", "needs a name"),
        ("x" * 49, "at most 48"),
    ],
)
def test_anything_a_folder_name_cannot_hold_is_refused_with_the_reason(
    name: str, reason: str
) -> None:
    assert reason in (lab_name_problem(name) or "")


def test_a_refused_name_comes_with_one_that_would_do() -> None:
    assert suggest_lab_name("BGP exam, group A") == "BGP exam group A"
    assert lab_name_problem(suggest_lab_name("a/b:c")) is None


# -- the folder is the name -------------------------------------------------


def test_the_folder_is_the_name_exactly(client: TestClient, workspace: Path) -> None:
    response = save(client, LAB)
    assert response.status_code == 200, response.text
    assert (workspace / "base exam" / "lab.conf").is_file()


def test_renaming_and_saving_moves_the_folder_with_what_is_in_it(
    client: TestClient, workspace: Path
) -> None:
    save(client, LAB)
    captured = workspace / "base exam" / "r1" / "etc" / "frr" / "frr.conf"
    captured.parent.mkdir(parents=True)
    captured.write_text("router ospf\n", encoding="utf-8")

    body = save(client, named("final exam")).json()

    assert body["name"] == "final exam"
    assert body["renamed_from"] == "base exam"
    assert not (workspace / "base exam").exists()
    assert (workspace / "final exam" / "r1" / "etc" / "frr" / "frr.conf").read_text(
        encoding="utf-8"
    ) == "router ospf\n"


def test_a_change_of_case_alone_renames_the_folder(client: TestClient, workspace: Path) -> None:
    # One folder to Windows and macOS, so it goes through a temporary name.
    save(client, LAB)
    body = save(client, named("Base Exam")).json()
    assert body["renamed_from"] == "base exam"
    assert [p.name for p in workspace.iterdir()] == ["Base Exam"]


def test_a_folder_from_before_the_rule_takes_the_lab_name_on_the_next_save(
    client: TestClient, workspace: Path
) -> None:
    # Saved before this change, a lab called "base exam" was put in base-exam.
    old = workspace / "base-exam"
    old.mkdir(parents=True)
    (old / "lab.conf").write_text('LAB_NAME="base exam"\nr1[0]="A"\n', encoding="utf-8")
    assert client.post("/api/project/open", json={"folder": "base-exam"}).status_code == 200

    body = save(client, LAB).json()
    assert body["renamed_from"] == "base-exam"
    assert (workspace / "base exam" / "lab.conf").is_file()


# -- one name per lab -------------------------------------------------------


def test_renaming_to_another_scenario_s_name_is_refused_and_touches_nothing(
    client: TestClient, workspace: Path
) -> None:
    save(client, named("alpha"))
    save(client, named("beta"), name="beta")  # Save as: beta is now the one open
    before = (workspace / "alpha" / "lab.conf").read_text(encoding="utf-8")

    response = save(client, named("Alpha"))

    assert response.status_code == 409
    assert "already a scenario called 'Alpha'" in response.json()["detail"]
    assert (workspace / "beta").is_dir()
    assert (workspace / "alpha" / "lab.conf").read_text(encoding="utf-8") == before


def test_save_as_an_existing_name_is_refused(client: TestClient, workspace: Path) -> None:
    save(client, named("alpha"))
    save(client, named("beta"), name="beta")
    response = save(client, named("beta"), name="alpha")
    assert response.status_code == 409
    assert (workspace / "beta").is_dir()


def test_save_as_leaves_the_original_where_it_is(client: TestClient, workspace: Path) -> None:
    save(client, LAB)
    response = save(client, named("homework"), name="homework")
    assert response.status_code == 200
    assert (workspace / "base exam" / "lab.conf").is_file()
    assert (workspace / "homework" / "lab.conf").is_file()


# -- deploying is saving ----------------------------------------------------


@pytest.fixture
def deploys(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Path]]:
    """What runner.deploy was asked to start, and from which folder."""
    calls: list[tuple[str, Path]] = []

    def deploy(topology, folder, *, confirm=False):  # noqa: ANN001, ANN202
        calls.append((topology.name, Path(folder)))
        return runner.LabStatus(lab_dir=str(folder))

    monkeypatch.setattr(runner, "deploy", deploy)
    return calls


def test_a_lab_renamed_and_deployed_without_saving_runs_from_the_new_folder(
    client: TestClient, workspace: Path, session: Session, deploys: list[tuple[str, Path]]
) -> None:
    save(client, LAB)

    response = client.post(
        "/api/lab/deploy", json={"topology": named("final exam"), "confirm": False}
    )

    assert response.status_code == 200, response.text
    assert deploys == [("final exam", workspace / "final exam")]
    assert not (workspace / "base exam").exists()
    assert session.dirty is False and session.path == workspace / "final exam"


def test_a_deploy_under_a_name_another_scenario_has_starts_nothing(
    client: TestClient, workspace: Path, deploys: list[tuple[str, Path]]
) -> None:
    save(client, named("untitled"))
    client.post("/api/topology/reset")  # New…: unsaved, and called untitled again

    body = client.post(
        "/api/lab/deploy", json={"topology": named("untitled"), "confirm": False}
    ).json()

    assert deploys == []
    assert body["message"].startswith("Could not deploy. There is already a scenario")
