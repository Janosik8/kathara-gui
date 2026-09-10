"""The `.kgui` scenario package.

Capability 5 turns on this file being trustworthy: a student's exam submission
must reopen as exactly what they submitted, and an instructor must be able to
open a file from someone else without it doing anything to their machine.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from kathara_gui.domain.model import CollisionDomain, Interface, Node, Position, Topology
from kathara_gui.features import Features
from kathara_gui.project.kgui import (
    FORMAT_VERSION,
    PackageError,
    extract_lab,
    read_package,
    write_package,
)
from kathara_gui.project.labdir import write_lab


@pytest.fixture
def topology() -> Topology:
    return Topology(
        name="bgp exam",
        author="Jan",
        nodes=[
            Node(
                name="r1",
                kind="router",
                position=Position(x=120, y=340),
                daemons=["zebra", "bgpd"],
                interfaces=[Interface(number=0, collision_domain="A", ip="10.0.0.1/24")],
            ),
            Node(
                name="r2",
                kind="router",
                position=Position(x=-40.5, y=12.25),
                interfaces=[Interface(number=0, collision_domain="A", ip="10.0.0.2/24")],
            ),
        ],
        collision_domains=[CollisionDomain(name="A", subnet="10.0.0.0/24")],
    )


# -- round trip --------------------------------------------------------


def test_a_scenario_reopens_as_what_was_saved(topology: Topology, tmp_path: Path) -> None:
    written = write_package(topology, tmp_path / "exam.kgui")
    assert read_package(written).topology.model_dump() == topology.model_dump()


def test_canvas_positions_survive(topology: Topology, tmp_path: Path) -> None:
    # An instructor marking a submission should see the student's layout, not
    # a re-arranged one.
    reopened = read_package(write_package(topology, tmp_path / "exam.kgui")).topology
    assert reopened.node("r1").position.x == 120
    assert reopened.node("r2").position.y == 12.25


def test_addressing_and_daemons_survive(topology: Topology, tmp_path: Path) -> None:
    reopened = read_package(write_package(topology, tmp_path / "exam.kgui")).topology
    assert reopened.node("r1").interfaces[0].ip == "10.0.0.1/24"
    assert reopened.node("r1").daemons == ["zebra", "bgpd"]
    assert reopened.collision_domain("A").subnet == "10.0.0.0/24"


def test_feature_toggles_travel_with_the_scenario(topology: Topology, tmp_path: Path) -> None:
    """Exam mode belongs to the scenario, so it must survive being sent."""
    written = write_package(
        topology, tmp_path / "exam.kgui", features=Features(subnet_calculator=False)
    )
    assert read_package(written).features.subnet_calculator is False


def test_features_default_to_permissive_when_absent(topology: Topology, tmp_path: Path) -> None:
    assert read_package(write_package(topology, tmp_path / "a.kgui")).features.subnet_calculator


def test_the_manifest_records_what_wrote_it(topology: Topology, tmp_path: Path) -> None:
    package = read_package(write_package(topology, tmp_path / "a.kgui"))
    assert package.format == FORMAT_VERSION
    assert package.application
    assert package.created


# -- usable without this application -----------------------------------


def test_the_package_contains_a_runnable_lab(topology: Topology, tmp_path: Path) -> None:
    """Unzip and `kathara lstart` must work for someone without the GUI."""
    written = write_package(topology, tmp_path / "exam.kgui")
    with zipfile.ZipFile(written) as archive:
        names = archive.namelist()

    assert "lab/lab.conf" in names
    assert "lab/r1.startup" in names


def test_the_lab_matches_the_topology(topology: Topology, tmp_path: Path) -> None:
    written = write_package(topology, tmp_path / "exam.kgui")
    with zipfile.ZipFile(written) as archive:
        lab_conf = archive.read("lab/lab.conf").decode()

    assert 'r1[0]="A"' in lab_conf
    assert "kgui:node r1 pos=120,340" in lab_conf


def test_captured_container_state_is_preserved(topology: Topology, tmp_path: Path) -> None:
    """Configuration pulled out of a running container has nowhere to live in
    the model, so the lab directory must carry it."""
    lab = write_lab(topology, tmp_path / "lab")
    captured = lab / "r1" / "etc" / "frr" / "frr.conf"
    captured.parent.mkdir(parents=True, exist_ok=True)
    captured.write_text("router bgp 65001\n", encoding="utf-8")

    written = write_package(topology, tmp_path / "exam.kgui", lab_dir=lab)
    with zipfile.ZipFile(written) as archive:
        assert archive.read("lab/r1/etc/frr/frr.conf").decode() == "router bgp 65001\n"


def test_a_lab_is_generated_when_none_was_deployed(topology: Topology, tmp_path: Path) -> None:
    # A scenario that has never been run should still export something usable.
    written = write_package(topology, tmp_path / "exam.kgui", lab_dir=tmp_path / "missing")
    with zipfile.ZipFile(written) as archive:
        assert "lab/lab.conf" in archive.namelist()


# -- extraction --------------------------------------------------------


def test_extracting_restores_the_lab(topology: Topology, tmp_path: Path) -> None:
    written = write_package(topology, tmp_path / "exam.kgui")
    out = extract_lab(written, tmp_path / "restored")

    assert (out / "lab.conf").is_file()
    assert (out / "r1.startup").is_file()


def test_extraction_refuses_to_escape_the_destination(tmp_path: Path) -> None:
    """A package may come from anyone — an exam submission, typically.

    An archive naming `../` must not be able to write outside where it was
    asked to go.
    """
    hostile = tmp_path / "hostile.kgui"
    with zipfile.ZipFile(hostile, "w") as archive:
        archive.writestr("topology.json", Topology(name="x").model_dump_json())
        archive.writestr("lab/../../escaped.txt", "should not be written")
        archive.writestr("lab/ok.txt", "fine")

    out = extract_lab(hostile, tmp_path / "dest")

    assert (out / "ok.txt").is_file()
    assert not (tmp_path.parent / "escaped.txt").exists()
    assert not (tmp_path / "escaped.txt").exists()


def test_extraction_ignores_members_outside_the_lab(topology: Topology, tmp_path: Path) -> None:
    written = write_package(topology, tmp_path / "exam.kgui")
    out = extract_lab(written, tmp_path / "restored")
    # topology.json and the manifest belong to the package, not the lab.
    assert not (out / "topology.json").exists()
    assert not (out / "kgui.json").exists()


# -- refusing what it cannot read --------------------------------------


def test_a_file_that_is_not_an_archive_is_refused(tmp_path: Path) -> None:
    plain = tmp_path / "notes.kgui"
    plain.write_text("this is not a zip", encoding="utf-8")
    with pytest.raises(PackageError, match="not a readable archive"):
        read_package(plain)


def test_an_archive_without_a_topology_is_refused(tmp_path: Path) -> None:
    other = tmp_path / "photos.kgui"
    with zipfile.ZipFile(other, "w") as archive:
        archive.writestr("holiday.jpg", "not a scenario")
    with pytest.raises(PackageError, match="not a Kathara GUI scenario"):
        read_package(other)


def test_a_missing_file_is_refused_clearly(tmp_path: Path) -> None:
    with pytest.raises(PackageError, match="does not exist"):
        read_package(tmp_path / "absent.kgui")


def test_a_newer_format_is_refused_with_advice(topology: Topology, tmp_path: Path) -> None:
    """Better to say "update the application" than to half-read it."""
    future = tmp_path / "future.kgui"
    with zipfile.ZipFile(future, "w") as archive:
        archive.writestr("topology.json", topology.model_dump_json())
        archive.writestr("kgui.json", f'{{"format": {FORMAT_VERSION + 1}}}')

    with pytest.raises(PackageError, match="newer version"):
        read_package(future)


def test_a_corrupt_topology_is_refused(tmp_path: Path) -> None:
    broken = tmp_path / "broken.kgui"
    with zipfile.ZipFile(broken, "w") as archive:
        archive.writestr("topology.json", "{not json")
    with pytest.raises(PackageError, match="could not be read"):
        read_package(broken)


def test_a_topology_this_version_rejects_is_refused(tmp_path: Path) -> None:
    # Valid JSON describing an impossible topology: two devices whose names
    # differ only by case, which collide on macOS and Windows.
    bad = tmp_path / "bad.kgui"
    with zipfile.ZipFile(bad, "w") as archive:
        archive.writestr(
            "topology.json",
            '{"name": "l", "nodes": [{"name": "R1"}, {"name": "r1"}], "collision_domains": []}',
        )
    with pytest.raises(PackageError, match="could not be read"):
        read_package(bad)


# -- stability ---------------------------------------------------------


def test_saving_an_unchanged_scenario_produces_an_identical_file(
    topology: Topology, tmp_path: Path
) -> None:
    """Zip records a timestamp per member, so without a fixed one every save
    would differ and two packages could never be compared."""
    first = write_package(topology, tmp_path / "one.kgui").read_bytes()
    second = write_package(topology, tmp_path / "two.kgui").read_bytes()
    assert first == second


def test_the_package_is_a_plain_zip(topology: Topology, tmp_path: Path) -> None:
    # Deliberately inspectable with ordinary tools: a student who cannot open
    # the application can still see what they submitted.
    written = write_package(topology, tmp_path / "exam.kgui")
    assert zipfile.is_zipfile(written)
