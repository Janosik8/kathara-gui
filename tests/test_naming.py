"""Device names must survive a round trip between Windows, macOS and Linux."""

from __future__ import annotations

import pytest

from kathara_gui.domain.naming import (
    RESERVED_WINDOWS_NAMES,
    NameError_,
    check_unique_names,
    kathara_name_problem,
    suggest_kathara_name,
    validate_device_name,
)


@pytest.mark.parametrize("name", ["r1", "R1", "router-a", "pc_1", "spine.01", "a", "bgp2"])
def test_accepts_ordinary_names(name: str) -> None:
    validate_device_name(name)


@pytest.mark.parametrize("name", sorted(RESERVED_WINDOWS_NAMES))
def test_rejects_windows_reserved_device_names(name: str) -> None:
    """`con`, `nul`, `com1`... cannot be directory names on Windows."""
    with pytest.raises(NameError_, match="reserved"):
        validate_device_name(name)


@pytest.mark.parametrize("name", ["CON", "Nul", "CoM1"])
def test_reserved_check_is_case_insensitive(name: str) -> None:
    with pytest.raises(NameError_, match="reserved"):
        validate_device_name(name)


def test_rejects_reserved_name_with_extension() -> None:
    """Windows treats `con.txt` as the console device too."""
    with pytest.raises(NameError_, match="reserved"):
        validate_device_name("con.txt")


@pytest.mark.parametrize("name", ["r/1", "r\\1", "r:1", "r*1", 'r"1', "r|1", "r?1", "r<1", "r>1"])
def test_rejects_characters_illegal_in_windows_paths(name: str) -> None:
    with pytest.raises(NameError_):
        validate_device_name(name)


@pytest.mark.parametrize("name", ["r1.", "r1 ", " r1"])
def test_rejects_trailing_dot_or_surrounding_space(name: str) -> None:
    with pytest.raises(NameError_):
        validate_device_name(name)


def test_rejects_empty_and_overlong_names() -> None:
    with pytest.raises(NameError_):
        validate_device_name("")
    with pytest.raises(NameError_, match="longer than"):
        validate_device_name("r" * 49)


def test_rejects_leading_punctuation() -> None:
    with pytest.raises(NameError_):
        validate_device_name("-r1")
    with pytest.raises(NameError_):
        validate_device_name(".hidden")


def test_case_duplicate_names_are_rejected() -> None:
    """`R1` and `r1` are distinct on Linux but collide on macOS and Windows."""
    with pytest.raises(NameError_, match="differ only by case"):
        check_unique_names(["R1", "r2", "r1"])


def test_exact_duplicates_are_not_a_case_collision() -> None:
    # Genuine duplicates are a topology-model concern, reported elsewhere.
    check_unique_names(["r1", "r1"])


def test_distinct_names_pass() -> None:
    check_unique_names(["r1", "r2", "pc1", "switch-a"])


@pytest.mark.parametrize("name", ["r1", "pc_10", "a", "r" * 30])
def test_kathara_accepts_its_own_names(name: str) -> None:
    assert kathara_name_problem(name) is None


@pytest.mark.parametrize(
    ("name", "suggestion"),
    [("R1", "r1"), ("edge-1", "edge_1"), ("spine.01", "spine_01"), ("r" * 31, "r" * 30)],
)
def test_kathara_refuses_what_portability_allows(name: str, suggestion: str) -> None:
    """Bug 25: `R1` passes the portability check, then Kathará refuses it at deploy."""
    validate_device_name(name)  # portable everywhere, and still refused
    problem = kathara_name_problem(name)
    assert problem is not None and "lowercase letters" in problem
    assert suggest_kathara_name(name) == suggestion


def test_the_rule_is_kathara_s_own() -> None:
    """Checked against Kathará itself, so the two cannot drift apart."""
    from Kathara.model.Machine import Machine

    for name in ["r1", "pc_10", "R1", "edge-1", "spine.01", "r" * 31]:
        # The name is checked first; with no lab, anything after it fails
        # differently, which still means the name itself was accepted.
        try:
            Machine(None, name)
        except SyntaxError:
            kathara_accepts = False
        except Exception:  # noqa: BLE001
            kathara_accepts = True
        else:
            kathara_accepts = True
        assert kathara_accepts == (kathara_name_problem(name) is None), name
