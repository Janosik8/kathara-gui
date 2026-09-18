"""Reading a device's state from what Kathará reports.

The defect these cover: the runner treated *getting stats back* as proof that
a device was running. Docker keeps reporting a container after it stops, so a
lab whose containers had exited overnight was shown as healthy while every
``kathara connect`` failed with a 409 "container is not running".

Pure logic — no Docker daemon — so this runs in the default suite. The
end-to-end version, which stops a real container, lives in
``test_deploy_runner_integration.py``.
"""

from __future__ import annotations

from kathara_gui.kathara.runner import DeviceState, DeviceStatus, LabStatus, _state_of

# -- reading a single device -------------------------------------------


def test_a_running_container_is_running() -> None:
    assert _state_of("running") is DeviceState.RUNNING


def test_an_exited_container_is_not_running() -> None:
    """The regression. Docker still reports it, but nothing is alive inside."""
    assert _state_of("exited") is DeviceState.EXITED


def test_no_container_at_all_is_stopped() -> None:
    assert _state_of(None) is DeviceState.STOPPED


def test_other_non_running_states_are_treated_as_exited() -> None:
    """Whatever the reason, the user cannot open a shell and must redeploy."""
    for reported in ("created", "paused", "dead", "restarting", "removing", "unknown"):
        assert _state_of(reported) is DeviceState.EXITED, reported


# -- the lab as a whole -------------------------------------------------


def lab(**states: DeviceState) -> LabStatus:
    return LabStatus(devices=[DeviceStatus(n, s) for n, s in states.items()])


def test_running_lists_only_live_devices() -> None:
    status = lab(r1=DeviceState.RUNNING, r2=DeviceState.EXITED, r3=DeviceState.STOPPED)
    assert status.running == ["r1"]
    assert status.exited == ["r2"]


def test_a_lab_of_exited_devices_still_counts_as_deployed() -> None:
    """The containers hold their names, so it must be stopped before redeploying."""
    assert lab(r1=DeviceState.EXITED).deployed is True


def test_a_lab_that_was_never_deployed_is_not_deployed() -> None:
    assert lab(r1=DeviceState.STOPPED, r2=DeviceState.STOPPED).deployed is False


def test_an_empty_lab_is_not_deployed() -> None:
    assert LabStatus().deployed is False
