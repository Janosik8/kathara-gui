"""Where a lab is generated, and how that location is decided.

Kathará identifies a lab by its directory, so this is not a cosmetic choice:
put a lab somewhere the user cannot easily reach and `kathara connect` becomes
unusable, which is what the previous hidden home-directory default did.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from kathara_gui.domain.model import Topology
from kathara_gui.domain.naming import safe_dir_name
from kathara_gui.project.session import Session, default_workspace_root


class TestSafeDirName:
    """A lab name is free text; a directory name is not."""

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("bgp-lab", "bgp-lab"),
            ("BGP exam", "BGP-exam"),
            ("BGP exam, group A", "BGP-exam-group-A"),
            ("a/b\\c", "a-b-c"),
            ("  padded  ", "padded"),
            ("under_score", "under_score"),
        ],
    )
    def test_transforms_rather_than_rejects(self, name: str, expected: str) -> None:
        # Unlike a device name, a lab name should not be refused for having a
        # space in it — it is a title, not an identifier.
        assert safe_dir_name(name) == expected

    def test_collapses_runs_of_dashes(self) -> None:
        assert safe_dir_name("a   b") == "a-b"

    @pytest.mark.parametrize("name", ["", "   ", "///", "---"])
    def test_falls_back_when_nothing_usable_remains(self, name: str) -> None:
        assert safe_dir_name(name) == "untitled"

    @pytest.mark.parametrize("name", ["con", "NUL", "com1"])
    def test_avoids_windows_reserved_names(self, name: str) -> None:
        # A directory called `con` cannot be created on Windows at all.
        assert safe_dir_name(name) == "untitled"

    def test_truncates_something_absurd(self) -> None:
        assert len(safe_dir_name("x" * 500)) <= 48


class TestWorkspaceRoot:
    def test_defaults_beside_the_working_directory(self) -> None:
        assert default_workspace_root() == Path.cwd() / "kathara-labs"

    def test_default_is_used_when_none_is_given(self) -> None:
        assert Session().workspace_root == (Path.cwd() / "kathara-labs").resolve()

    def test_an_explicit_workspace_wins(self, tmp_path: Path) -> None:
        assert Session(workspace_root=tmp_path).workspace_root == tmp_path.resolve()

    def test_the_root_is_absolute(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        # Resolved once at construction: re-reading the process's working
        # directory later would let the answer change underneath us.
        monkeypatch.chdir(tmp_path)
        session = Session(workspace_root=Path("relative"))
        assert session.workspace_root.is_absolute()

    def test_the_root_does_not_follow_a_later_chdir(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session = Session()
        before = session.workspace_root
        monkeypatch.chdir(tmp_path)
        assert session.workspace_root == before


class TestLabDir:
    def test_an_unsaved_lab_lives_in_the_workspace(self, tmp_path: Path) -> None:
        session = Session(workspace_root=tmp_path)
        session.replace(Topology(name="bgp lab"))
        assert session.lab_dir() == tmp_path / "bgp-lab"

    def test_the_folder_follows_the_lab_name(self, tmp_path: Path) -> None:
        session = Session(workspace_root=tmp_path)
        session.replace(Topology(name="first"))
        assert session.lab_dir().name == "first"
        session.replace(Topology(name="second"))
        assert session.lab_dir().name == "second"

    def test_a_saved_lab_deploys_from_its_own_folder(self, tmp_path: Path) -> None:
        # So the files the user edits and the files that run are the same ones.
        session = Session(workspace_root=tmp_path / "workspace")
        session.replace(Topology(name="bgp lab"))
        session.mark_saved(tmp_path / "teaching" / "bgp-exam")

        assert session.lab_dir() == tmp_path / "teaching" / "bgp-exam"

    def test_saving_clears_the_dirty_flag(self, tmp_path: Path) -> None:
        session = Session(workspace_root=tmp_path)
        session.replace(Topology(name="lab"))
        assert session.dirty is True
        session.mark_saved(tmp_path / "somewhere")
        assert session.dirty is False

    def test_resetting_returns_to_the_workspace(self, tmp_path: Path) -> None:
        session = Session(workspace_root=tmp_path)
        session.mark_saved(tmp_path / "elsewhere")
        session.reset()
        assert session.lab_dir() == tmp_path / "untitled"
