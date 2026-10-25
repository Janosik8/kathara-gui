"""The scenario as a folder, over HTTP.

Capability 5 end to end: save, open, export, import, capture. The document is
a Kathará lab directory and the export is a plain zip of it, so most of what
matters here is interoperability — a lab written by somebody else, with none of
our conventions in it, has to open and keep its configuration.

No Docker: capture against live containers is covered by
``test_state_capture_integration.py``.
"""

from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from Kathara.utils import generate_urlsafe_hash

from kathara_gui.kathara import runner
from kathara_gui.main import create_app
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
def running_labs(monkeypatch: pytest.MonkeyPatch) -> set[str]:
    """Lab names Docker would report running; none unless a test adds one."""
    names: set[str] = set()
    monkeypatch.setattr(
        runner,
        "running_everywhere",
        lambda: [runner.DeployedDevice(generate_urlsafe_hash(n), "r1", "running") for n in names],
    )
    return names


@pytest.fixture
def client(session: Session, running_labs: set[str]) -> Iterator[TestClient]:
    app = create_app(token=TOKEN)
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app, headers={"X-KGUI-Token": TOKEN}) as test_client:
        yield test_client


def save(client: TestClient, topology: dict | None = None, **body: object) -> dict:
    response = client.post("/api/project/save", json={"topology": topology or TRIANGLE, **body})
    assert response.status_code == 200, response.text
    return response.json()


def foreign_lab_zip() -> bytes:
    """A lab as somebody else would have written it.

    No `# kgui:` comments, no kgui.json, addressing only in the startup
    scripts, and one of them in the Netkit `ifconfig` style. This is the case
    the whole import path exists for.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("lab.conf", 'r1[0]="A"\nr1[1]="B"\npc1[0]="A"\nr2[0]="B"\n')
        archive.writestr(
            "r1.startup",
            "ip link set eth0 up\n"
            "ip address add 192.168.1.1/24 dev eth0\n"
            "ip address add 10.0.0.1/30 dev eth1\n",
        )
        archive.writestr("pc1.startup", "ifconfig eth0 192.168.1.100 netmask 255.255.255.0\n")
        archive.writestr("r2.startup", "ip addr add 10.0.0.2/30 dev eth0\n")
        archive.writestr("r1/etc/frr/daemons", "zebra=yes\nospfd=yes\nbgpd=no\n")
    return buffer.getvalue()


# -- saving -------------------------------------------------------------


def test_saving_writes_a_scenario_folder(client: TestClient, workspace: Path) -> None:
    folder = Path(save(client)["folder"])

    assert folder.parent == workspace.resolve()
    assert (folder / "lab.conf").is_file()
    assert (folder / "r1.startup").is_file()
    assert (folder / "kgui.json").is_file()


def test_the_folder_name_is_the_scenario_name_exactly(client: TestClient) -> None:
    # Test 3E.2: "the folders should be named exactly as the lab name". It
    # used to be "ospf-triangle".
    assert save(client)["name"] == "ospf triangle"


def test_an_explicit_name_wins(client: TestClient) -> None:
    assert save(client, name="submission-group-b")["name"] == "submission-group-b"


def test_saving_clears_the_unsaved_marker(client: TestClient, session: Session) -> None:
    client.put("/api/topology", json=TRIANGLE)
    assert session.dirty is True

    save(client)
    assert session.dirty is False
    assert session.path is not None


def test_the_saved_folder_is_a_runnable_kathara_lab(client: TestClient) -> None:
    """Someone with Kathará and not this application can cd in and lstart."""
    folder = Path(save(client)["folder"])
    text = (folder / "lab.conf").read_text()

    assert 'LAB_NAME="ospf triangle"' in text
    assert 'r1[0]="A"' in text


def test_the_scenario_deploys_from_the_folder_it_was_saved_in(
    client: TestClient, session: Session
) -> None:
    folder = save(client)["folder"]
    assert str(session.lab_dir(session.topology)) == folder


# -- the workspace boundary --------------------------------------------


@pytest.mark.parametrize(
    "attempt",
    ["../escaped", "../../../../etc/passwd", "/etc/passwd", "nested/inside", "..", "con", "   "],
)
def test_a_name_cannot_escape_the_workspace(
    client: TestClient, workspace: Path, tmp_path: Path, attempt: str
) -> None:
    """A scenario name is free text, and a request may be sent by anyone.

    Since the folder is the name exactly (test 3E.2), a name that is no folder
    name is refused, with the reason, rather than transformed into one.
    """
    response = client.post("/api/project/save", json={"topology": TRIANGLE, "name": attempt})

    assert response.status_code == 400
    assert response.json()["detail"]
    # Nothing was written anywhere.
    assert not workspace.exists() or not any(workspace.iterdir())
    assert sorted(p.name for p in tmp_path.iterdir()) == []


def test_an_archive_member_cannot_escape_the_folder(
    client: TestClient, workspace: Path, tmp_path: Path
) -> None:
    """The case this guard exists for: an instructor opening a submission."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("lab.conf", 'r1[0]="A"\n')
        archive.writestr("../../../../tmp/pwned.txt", "escaped")
        archive.writestr("/absolute.txt", "escaped")

    response = client.post(
        "/api/project/import",
        content=buffer.getvalue(),
        headers={"X-KGUI-Filename": "hostile.zip"},
    )
    assert response.status_code == 200, response.text

    assert not (tmp_path / "pwned.txt").exists()
    assert not Path("/tmp/pwned.txt").exists() or "escaped" not in Path(
        "/tmp/pwned.txt"
    ).read_text()
    landed = {p.name for p in Path(response.json()["folder"]).rglob("*")}
    assert "pwned.txt" not in landed and "absolute.txt" not in landed


def test_opening_refuses_a_folder_outside_the_workspace(client: TestClient) -> None:
    response = client.post("/api/project/open", json={"folder": "../../../etc"})
    assert response.status_code in (400, 404)


# -- listing ------------------------------------------------------------


def test_listing_is_empty_before_anything_is_saved(client: TestClient) -> None:
    assert client.get("/api/project/scenarios").json() == []


def test_listing_reports_the_scenario_inside_the_folder(client: TestClient) -> None:
    save(client, name="week-3")
    (entry,) = client.get("/api/project/scenarios").json()

    # Save as names the copy, and the folder is the name.
    assert entry["folder"] == "week-3"
    assert entry["name"] == "week-3"
    assert entry["devices"] == 2
    assert entry["foreign"] is False
    assert entry["running"] is False


def test_listing_says_which_scenarios_have_a_running_lab(
    client: TestClient, running_labs: set[str]
) -> None:
    # Asked for in the retest of F34: a green dot and "running" in Open.
    save(client, name="week-3")
    save(client, name="week-4")
    running_labs.add("week-4")

    listed = {e["name"]: e["running"] for e in client.get("/api/project/scenarios").json()}
    assert listed == {"week-3": False, "week-4": True}


def test_a_directory_that_is_not_a_lab_is_not_listed(
    client: TestClient, workspace: Path
) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "not-a-lab").mkdir()
    (workspace / "not-a-lab" / "notes.md").write_text("just notes")

    assert client.get("/api/project/scenarios").json() == []


# -- opening ------------------------------------------------------------


def test_a_saved_scenario_reopens_as_it_was(client: TestClient) -> None:
    name = save(client)["name"]
    client.post("/api/topology/reset")

    body = client.post("/api/project/open", json={"folder": name}).json()
    assert body["topology"]["name"] == "ospf triangle"
    assert [n["name"] for n in body["topology"]["nodes"]] == ["r1", "r2"]


def test_reopening_preserves_canvas_positions(client: TestClient) -> None:
    """FR-30. The layout rides in lab.conf comments Kathará ignores."""
    name = save(client)["name"]
    body = client.post("/api/project/open", json={"folder": name}).json()

    positions = {n["name"]: n["position"] for n in body["topology"]["nodes"]}
    assert positions["r1"] == {"x": 100, "y": 50}
    assert positions["r2"] == {"x": 300, "y": 50}


def test_reopening_preserves_addresses_and_daemons(client: TestClient) -> None:
    name = save(client)["name"]
    body = client.post("/api/project/open", json={"folder": name}).json()

    r1 = next(n for n in body["topology"]["nodes"] if n["name"] == "r1")
    assert r1["interfaces"][0]["ip"] == "10.0.0.1/24"
    assert r1["daemons"] == ["zebra", "ospfd"]


def test_opening_something_that_is_not_there_is_a_404(client: TestClient) -> None:
    assert client.post("/api/project/open", json={"folder": "absent"}).status_code == 404


def test_opening_a_folder_without_a_lab_conf_explains_why(
    client: TestClient, workspace: Path
) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "empty").mkdir()

    response = client.post("/api/project/open", json={"folder": "empty"})
    assert response.status_code == 400
    assert "lab.conf" in response.json()["detail"]


# -- export -------------------------------------------------------------


def test_export_returns_a_zip_named_after_the_scenario(client: TestClient) -> None:
    response = client.post("/api/project/export", json={"topology": TRIANGLE})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert 'filename="ospf triangle.zip"' in response.headers["content-disposition"]


def test_the_export_is_a_plain_zip_anyone_can_read(client: TestClient) -> None:
    """The reason for dropping the bespoke package: no wrapper directory, no
    topology.json, just the lab as it sits on disk."""
    response = client.post("/api/project/export", json={"topology": TRIANGLE})
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        assert "lab.conf" in names
        assert "r1.startup" in names
        assert "kgui.json" in names
        assert not any(n.startswith("lab/") for n in names)
        assert "topology.json" not in names
        assert "ip address add 10.0.0.1/24 dev eth0" in archive.read("r1.startup").decode()


def test_exporting_twice_produces_the_same_bytes(client: TestClient) -> None:
    """Fixed timestamps, so an unchanged scenario is not endlessly reversioned."""
    first = client.post("/api/project/export", json={"topology": TRIANGLE}).content
    assert client.post("/api/project/export", json={"topology": TRIANGLE}).content == first


def test_the_settings_file_records_no_time(client: TestClient) -> None:
    """The invariant behind the test above, which otherwise passes by luck.

    `kgui.json` used to carry a `saved` timestamp, so two exports matched only
    when both landed in the same second — the byte comparison failed roughly at
    random and looked like flakiness rather than the real defect it was.
    Asserting the absence directly cannot pass by timing.
    """
    stored = json.loads((Path(save(client)["folder"]) / "kgui.json").read_text())

    assert set(stored) == {"format", "application", "features"}, (
        f"a time-varying field would defeat reproducible exports: {sorted(stored)}"
    )


def test_exporting_leaves_no_staging_file_behind(client: TestClient, workspace: Path) -> None:
    client.post("/api/project/export", json={"topology": TRIANGLE})
    assert not list((workspace / ".import").glob("*.zip"))


def test_a_captured_config_travels_in_the_export(client: TestClient) -> None:
    """An exported scenario carries what was pulled off the running routers."""
    folder = Path(save(client)["folder"])
    captured = folder / "r1" / "etc" / "frr" / "frr.conf"
    captured.parent.mkdir(parents=True, exist_ok=True)
    captured.write_text("router ospf\n network 10.0.0.0/24 area 42\n")

    response = client.post("/api/project/export", json={"topology": TRIANGLE})
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert "area 42" in archive.read("r1/etc/frr/frr.conf").decode()


# -- import -------------------------------------------------------------


def test_a_scenario_round_trips_through_export_and_import(client: TestClient) -> None:
    exported = client.post("/api/project/export", json={"topology": TRIANGLE}).content
    client.post("/api/topology/reset")

    body = client.post(
        "/api/project/import",
        content=exported,
        headers={"X-KGUI-Filename": "submission-jan.zip"},
    ).json()

    assert body["topology"]["name"] == "ospf triangle"
    positions = {n["name"]: n["position"] for n in body["topology"]["nodes"]}
    assert positions["r1"] == {"x": 100, "y": 50}


def test_importing_a_foreign_lab_recovers_its_addressing(client: TestClient) -> None:
    """The reported defect: importing lost the configuration and the editor
    then complained the routers had no addresses, while the addresses were in
    the startup scripts all along."""
    body = client.post(
        "/api/project/import",
        content=foreign_lab_zip(),
        headers={"X-KGUI-Filename": "someone-elses-lab.zip"},
    ).json()

    addresses = {
        n["name"]: [i["ip"] for i in n["interfaces"]] for n in body["topology"]["nodes"]
    }
    assert addresses["r1"] == ["192.168.1.1/24", "10.0.0.1/30"]
    assert addresses["r2"] == ["10.0.0.2/30"]
    # The Netkit-era ifconfig form, which published teaching labs still use.
    assert addresses["pc1"] == ["192.168.1.100/24"]


def test_importing_a_foreign_lab_recovers_its_daemons(client: TestClient) -> None:
    body = client.post(
        "/api/project/import",
        content=foreign_lab_zip(),
        headers={"X-KGUI-Filename": "someone-elses-lab.zip"},
    ).json()

    r1 = next(n for n in body["topology"]["nodes"] if n["name"] == "r1")
    assert r1["daemons"] == ["ospfd", "zebra"] or r1["daemons"] == ["zebra", "ospfd"]
    assert r1["kind"] == "router"


def test_importing_a_foreign_lab_works_out_each_network(client: TestClient) -> None:
    """Reported: the subnets "did not come through" and were invisible on the
    diagram. Kathará records the wiring but not the plan, so the domains
    arrived named and subnet-less while their members' addresses said exactly
    what each network was."""
    body = client.post(
        "/api/project/import",
        content=foreign_lab_zip(),
        headers={"X-KGUI-Filename": "someone-elses-lab.zip"},
    ).json()

    subnets = {cd["name"]: cd["subnet"] for cd in body["topology"]["collision_domains"]}
    assert subnets["A"] == "192.168.1.0/24"
    assert subnets["B"] == "10.0.0.0/30"


def test_a_foreign_lab_is_marked_as_such(client: TestClient) -> None:
    """It has no kgui.json, so its feature toggles are defaults rather than
    an instructor's choices, and the interface should be able to say so."""
    body = client.post(
        "/api/project/import",
        content=foreign_lab_zip(),
        headers={"X-KGUI-Filename": "someone-elses-lab.zip"},
    ).json()
    assert body["foreign"] is True


def test_importing_a_bare_lab_conf(client: TestClient) -> None:
    """The oldest way to have a lab: one file, no folder."""
    body = client.post(
        "/api/project/import",
        content=b'LAB_NAME="handwritten"\nr1[0]="A"\nr2[0]="A"\n',
        headers={"X-KGUI-Filename": "lab.conf"},
    ).json()

    assert body["topology"]["name"] == "handwritten"
    assert [n["name"] for n in body["topology"]["nodes"]] == ["r1", "r2"]


def test_an_archive_wrapped_in_its_own_folder_still_imports(client: TestClient) -> None:
    """Zipping a folder in Finder or Explorer nests everything inside it."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("my-lab/lab.conf", 'LAB_NAME="wrapped"\nr1[0]="A"\n')
        archive.writestr("my-lab/r1.startup", "ip address add 10.1.1.1/24 dev eth0\n")

    body = client.post(
        "/api/project/import", content=buffer.getvalue(), headers={"X-KGUI-Filename": "my-lab.zip"}
    ).json()

    assert body["topology"]["name"] == "wrapped"
    assert body["topology"]["nodes"][0]["interfaces"][0]["ip"] == "10.1.1.1/24"


def test_a_legacy_kgui_package_still_opens(client: TestClient) -> None:
    """Scenarios saved before the format was dropped are not stranded.

    Nothing special handles them: a `.kgui` nested its lab under `lab/`, and
    the generic unwrapping that copes with a folder zipped in Finder strips
    that too. The old `topology.json` is ignored, which is the point — the
    `lab.conf` beside it is now the only source of truth. Its feature toggles
    are lost, since they sat outside `lab/`; the scenario opens permissive.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("kgui.json", '{"format": 1}')
        archive.writestr("topology.json", '{"name": "stale", "nodes": []}')
        archive.writestr("lab/lab.conf", 'LAB_NAME="legacy exam"\nr1[0]="A"\nr2[0]="A"\n')
        archive.writestr("lab/r1.startup", "ip address add 10.0.0.1/24 dev eth0\n")

    body = client.post(
        "/api/project/import",
        content=buffer.getvalue(),
        headers={"X-KGUI-Filename": "submission.kgui"},
    ).json()

    assert body["topology"]["name"] == "legacy exam"
    r1 = next(n for n in body["topology"]["nodes"] if n["name"] == "r1")
    assert r1["interfaces"][0]["ip"] == "10.0.0.1/24"


def test_an_empty_import_is_refused(client: TestClient) -> None:
    assert client.post("/api/project/import", content=b"").status_code == 400


def test_something_that_is_not_a_lab_is_refused(client: TestClient) -> None:
    response = client.post("/api/project/import", content=b"this is not a lab at all")
    assert response.status_code == 400


def test_an_archive_without_a_lab_conf_is_refused(client: TestClient) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("notes.md", "just some notes")

    response = client.post("/api/project/import", content=buffer.getvalue())
    assert response.status_code == 400
    assert "lab.conf" in response.json()["detail"]


def test_a_failed_import_does_not_damage_an_existing_scenario(
    client: TestClient, workspace: Path
) -> None:
    """Unpacked into staging first, so a bad archive cannot half-overwrite
    work the user already had."""
    folder = Path(save(client, name="week-3")["folder"])
    before = (folder / "lab.conf").read_text()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("notes.md", "no lab.conf here")
    response = client.post(
        "/api/project/import", content=buffer.getvalue(), headers={"X-KGUI-Filename": "week-3.zip"}
    )

    assert response.status_code == 400
    assert (folder / "lab.conf").read_text() == before


# -- exam settings ------------------------------------------------------


def test_feature_toggles_are_stored_in_the_folder(client: TestClient, session: Session) -> None:
    from kathara_gui.features import Features

    session.set_features(Features(subnet_calculator=False))
    folder = Path(save(client)["folder"])

    stored = json.loads((folder / "kgui.json").read_text())
    assert stored["features"]["subnet_calculator"] is False


def test_feature_toggles_travel_with_the_scenario(client: TestClient, session: Session) -> None:
    """Capability 8: an exam's restrictions belong to the file, not the machine."""
    from kathara_gui.features import Features

    session.set_features(Features(subnet_calculator=False))
    name = save(client)["name"]
    session.set_features(Features())

    body = client.post("/api/project/open", json={"folder": name}).json()
    assert body["features"]["subnet_calculator"] is False
    assert session.features.subnet_calculator is False


# -- project state ------------------------------------------------------


def test_state_reports_where_the_scenario_stands(client: TestClient, workspace: Path) -> None:
    body = client.get("/api/project").json()
    assert body["name"] == "untitled"
    assert body["folder"] is None
    assert body["workspace"] == str(workspace.resolve())


def test_state_reports_the_folder_once_saved(client: TestClient) -> None:
    save(client)
    body = client.get("/api/project").json()

    assert body["folder"].endswith("ospf triangle")
    assert body["dirty"] is False


# -- capture as adoption ------------------------------------------------


def test_a_capture_becomes_what_the_lab_is_compared_against(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Bug 20: capturing reported itself as a difference.

    An address changed inside a container, then captured, left the snapshot of
    what was deployed holding the old address — so the header announced a
    mismatch immediately after the user had asked to adopt the containers'
    state. Capturing is adopting, so the capture becomes the new baseline.
    """
    from kathara_gui.domain.model import Topology
    from kathara_gui.kathara import state

    save(client)
    deployed = Topology.model_validate(TRIANGLE)
    session.mark_deployed(deployed)

    changed = deployed.model_copy(deep=True)
    changed.nodes[0].interfaces[0].ip = "10.0.0.11/24"
    monkeypatch.setattr(state, "capture", lambda topology, folder: state.CaptureReport())
    monkeypatch.setattr(
        state, "recover_addresses", lambda topology, folder, owned=None, left_out=None: changed
    )

    response = client.post("/api/project/capture", json={"topology": TRIANGLE})
    assert response.status_code == 200, response.text

    baseline = session.deployed_topology
    assert baseline is not None
    assert baseline.nodes[0].interfaces[0].ip == "10.0.0.11/24"


def test_a_capture_with_nothing_deployed_invents_no_baseline(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from kathara_gui.kathara import state

    save(client)
    monkeypatch.setattr(state, "capture", lambda topology, folder: state.CaptureReport())
    monkeypatch.setattr(
        state, "recover_addresses", lambda topology, folder, owned=None, left_out=None: topology
    )

    client.post("/api/project/capture", json={"topology": TRIANGLE})
    assert session.deployed_topology is None


def test_a_capture_says_which_addresses_it_had_no_place_for(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A second address on eth0, and one on an eth1 the design lacks, were
    dropped without a word. One set in FRR is not lost, and is said so."""
    from kathara_gui.kathara import state

    save(client)
    report = state.CaptureReport(frr_addresses={"r1": {"eth0": ["10.0.0.99/24"]}})
    monkeypatch.setattr(state, "capture", lambda topology, folder: report)

    def recover(topology, folder, owned=None, left_out=None):  # noqa: ANN001, ANN202
        assert left_out is not None
        left_out["r1"] = {0: ["10.0.0.99/24"]}
        left_out["r2"] = {0: ["10.0.0.9/24", "10.0.0.10/24"], 1: ["10.1.0.2/24"]}
        return topology

    monkeypatch.setattr(state, "recover_addresses", recover)
    message = client.post("/api/project/capture", json={"topology": TRIANGLE}).json()["message"]

    assert "r1 eth0 also has 10.0.0.99/24, set in FRR (vtysh), so it stays in frr.conf." in message
    assert (
        "r2 eth0 also has 10.0.0.9/24, 10.0.0.10/24; the design keeps one address per "
        "interface, so they were not captured." in message
    )
    assert "r2 eth1 has 10.1.0.2/24, but the design has no eth1, so it was not captured." in message


def test_a_refusal_from_the_file_system_is_a_reason_not_a_bare_500(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Step 0.8 of the Windows run: Save failed with WinError 123 and a traceback.

    The workspace path ended in a line break. The response now names the
    refusal and shows the path with that line break visible.
    """
    from kathara_gui.project import scenario

    def refuse(*args: object, **kwargs: object) -> None:
        raise OSError(22, "The filename is invalid", "C:\Temp\kgui test\n")

    monkeypatch.setattr(scenario, "save", refuse)
    response = client.post("/api/project/save", json={"topology": TRIANGLE})

    assert response.status_code == 500
    detail = response.json()["detail"]
    assert "The operating system refused: The filename is invalid." in detail
    assert r"kgui test\n" in detail  # the invisible character, made visible


# -- saving goes to the folder that is open -----------------------------


def _named(topology: dict, name: str) -> dict:
    changed = json.loads(json.dumps(topology))
    changed["name"] = name
    return changed


def _moved(topology: dict, x: int) -> dict:
    changed = json.loads(json.dumps(topology))
    changed["nodes"][0]["position"]["x"] = x
    return changed


def test_saving_a_copy_again_writes_the_copy_not_the_original(
    client: TestClient, workspace: Path
) -> None:
    """Test step 1B.1: save as "homework", reopen it, save — it went to base-exam.

    The copy kept the original's lab name, and a plain Save chose its folder
    by lab name. The folder the user opened is the document.
    """
    save(client, TRIANGLE)  # ospf triangle
    save(client, TRIANGLE, name="homework")
    client.post("/api/project/open", json={"folder": "homework"})

    body = save(client, _named(_moved(TRIANGLE, 999), "homework"))

    assert Path(body["folder"]).name == "homework"
    assert "pos=999" in (workspace / "homework" / "lab.conf").read_text()
    assert "pos=999" not in (workspace / "ospf triangle" / "lab.conf").read_text()


def test_exporting_a_copy_exports_the_copy(client: TestClient) -> None:
    save(client, TRIANGLE)
    save(client, TRIANGLE, name="homework")
    client.post("/api/project/open", json={"folder": "homework"})

    response = client.post(
        "/api/project/export", json={"topology": _named(_moved(TRIANGLE, 777), "homework")}
    )

    assert response.status_code == 200
    assert "homework" in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert "pos=777" in archive.read("lab.conf").decode()


def test_a_scenario_never_saved_is_placed_by_its_name(client: TestClient) -> None:
    assert Path(save(client, TRIANGLE)["folder"]).name == "ospf triangle"


def test_opening_a_lab_with_an_interface_gap_renumbers_it(client: TestClient) -> None:
    """Test step 1B.3: a scenario saved with r2 on eth1 alone failed to deploy.

    The address is read back from r2.startup, which names the *old* interface,
    so it must survive the renumbering rather than be lost with it.
    """
    gap = {
        "name": "gap",
        "nodes": [
            {
                "name": "r2",
                "kind": "router",
                "interfaces": [
                    {"number": 1, "collision_domain": "B", "ip": "10.0.1.2/24"},
                    {"number": 3, "collision_domain": "D", "ip": "10.0.3.2/24"},
                ],
            }
        ],
    }
    name = save(client, gap)["name"]
    body = client.post("/api/project/open", json={"folder": name}).json()

    r2 = body["topology"]["nodes"][0]
    assert [(i["number"], i["collision_domain"], i["ip"]) for i in r2["interfaces"]] == [
        (0, "B", "10.0.1.2/24"),
        (1, "D", "10.0.3.2/24"),
    ]
    assert any("r2 eth1 is now eth0" in w for w in body["warnings"])
