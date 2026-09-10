"""Cleaning captured configuration.

The container-dependent half lives in the docker-marked integration tests;
this covers the parsing, which is where the fiddly cases are.
"""

from __future__ import annotations

from kathara_gui.kathara.state import clean_running_config


def test_strips_the_progress_chatter() -> None:
    # `show running-config` prefaces the configuration with output that is not
    # configuration and would be rejected if fed back to FRR.
    output = "Building configuration...\n\nCurrent configuration:\n!\nfrr version 8.4\n!\n"
    assert clean_running_config(output).startswith("!")
    assert "Building configuration" not in clean_running_config(output)


def test_keeps_the_configuration_itself() -> None:
    output = "Building configuration...\n\n!\nhostname r1\nrouter bgp 65001\n!\n"
    cleaned = clean_running_config(output)
    assert "hostname r1" in cleaned
    assert "router bgp 65001" in cleaned


def test_starts_at_a_version_line_when_there_is_no_bang() -> None:
    assert clean_running_config("Building configuration...\n\nfrr version 8.4\n").startswith(
        "frr version"
    )


def test_starts_at_a_hostname_line() -> None:
    assert clean_running_config("chatter\nhostname r1\n").startswith("hostname r1")


def test_returns_nothing_when_there_is_no_configuration() -> None:
    # Better an empty result the caller reports as "nothing captured" than a
    # file full of progress messages.
    assert clean_running_config("Building configuration...\n\n") == ""
    assert clean_running_config("") == ""


def test_normalises_line_endings() -> None:
    # The file is written into a Linux container, so CR would corrupt it.
    assert "\r" not in clean_running_config("!\r\nhostname r1\r\n")


def test_ends_with_exactly_one_newline() -> None:
    cleaned = clean_running_config("!\nhostname r1\n\n\n")
    assert cleaned.endswith("hostname r1\n")


def test_leaves_an_already_clean_configuration_alone() -> None:
    config = "!\nfrr version 8.4\nhostname r1\n!\n"
    assert clean_running_config(config).strip() == config.strip()
