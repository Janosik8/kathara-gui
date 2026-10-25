"""Reaching Docker again after it has restarted under a running application.

The defect (test 3E.3, F36): deploy a lab, quit Docker Desktop, start it
again, deploy again — "Could not deploy: (232, 'WriteFile', 'The pipe is being
closed.')". Kathará's Docker client kept a pool of named pipes opened before
the restart, and the Windows pipe error is not one urllib3 retries.

Pure logic with fake clients, so this runs in the default suite; the real
named pipe is exercised by restarting Docker Desktop by hand.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import docker.errors
import pytest
import requests.exceptions

from kathara_gui.domain.model import Interface, Node, Topology
from kathara_gui.kathara import connection, runner
from kathara_gui.kathara.connection import DockerUnavailable, is_connection_error


def pipe_error(code: int = 232) -> Exception:
    """The Windows pipe error where there is one, else what a Unix socket raises."""
    try:
        from pywintypes import error
    except ImportError:
        return ConnectionResetError(code, "Connection reset")
    return error(code, "WriteFile", "The pipe is being closed.")


class Client:
    """A Docker client whose first ``failures`` pings raise ``error``."""

    def __init__(self, failures: int, error: Exception | None = None) -> None:
        self.failures = failures
        self.error = error or pipe_error()
        self.pings = 0
        self.closed = 0

    def ping(self) -> bool:
        self.pings += 1
        if self.pings <= self.failures:
            raise self.error
        return True

    def close(self) -> None:
        self.closed += 1


def use(monkeypatch: pytest.MonkeyPatch, instance: Any) -> None:
    monkeypatch.setattr(connection.Kathara, "get_instance", staticmethod(lambda: instance))


def kathara(client: Client) -> Any:
    return SimpleNamespace(manager=SimpleNamespace(client=client))


# -- recognising a dead connection --------------------------------------


def test_a_closed_pipe_is_a_connection_error() -> None:
    assert is_connection_error(pipe_error(232))


def test_no_daemon_at_all_is_a_connection_error() -> None:
    assert is_connection_error(requests.exceptions.ConnectionError("refused"))
    assert is_connection_error(docker.errors.DockerException("Error while fetching server API"))


def test_a_refusal_from_a_daemon_that_answered_is_not() -> None:
    """An image that cannot be pulled must keep Docker's own words."""
    assert not is_connection_error(docker.errors.APIError("pull access denied"))
    assert not is_connection_error(ValueError("Invalid device name"))


# -- repairing it -------------------------------------------------------


def test_a_live_connection_is_used_as_it_is(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Client(failures=0)
    instance = kathara(client)
    use(monkeypatch, instance)

    assert connection.manager() is instance
    assert client.closed == 0


def test_a_stale_pool_is_emptied_and_the_ping_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    """The regression: Docker restarted, every pooled pipe is dead."""
    client = Client(failures=1)
    instance = kathara(client)
    use(monkeypatch, instance)

    assert connection.manager() is instance
    assert client.closed == 1
    assert client.pings == 2


def test_no_daemon_even_on_a_fresh_connection_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    use(monkeypatch, kathara(Client(failures=2, error=pipe_error(2))))

    with pytest.raises(DockerUnavailable, match="Docker is not running"):
        connection.manager()


def test_kathara_failing_to_start_without_a_daemon_says_so(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def no_daemon() -> Any:
        raise docker.errors.DockerException("Error while fetching server API version")

    monkeypatch.setattr(connection.Kathara, "get_instance", staticmethod(no_daemon))
    with pytest.raises(DockerUnavailable):
        connection.manager()


def test_any_other_failure_is_not_disguised(monkeypatch: pytest.MonkeyPatch) -> None:
    use(monkeypatch, kathara(Client(failures=1, error=docker.errors.APIError("500"))))

    with pytest.raises(docker.errors.APIError):
        connection.manager()


# -- what the user is told ----------------------------------------------


def test_a_pipe_error_reads_as_a_sentence() -> None:
    """Not "(2, 'CreateFile', 'Nie można odnaleźć określonego pliku.')"."""
    assert runner._reason(pipe_error(2)) == connection.DOCKER_NOT_RUNNING


def test_deploying_with_docker_stopped_says_to_start_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test 3E.3."""
    use(monkeypatch, kathara(Client(failures=2, error=pipe_error(2))))
    topology = Topology(name="lab", nodes=[Node(name="r1")])

    result = runner.deploy(topology, tmp_path)

    assert result.message is not None
    assert "Docker is not running" in result.message
    assert not result.needs_confirmation


# -- containers left exited by a Docker restart ------------------------


class Manager:
    """Kathará, with one lab's containers in the given Docker states."""

    def __init__(self, lab: str, states: dict[str, str]) -> None:
        from Kathara.utils import generate_urlsafe_hash

        self.hash = generate_urlsafe_hash(lab)
        self.states = dict(states)
        self.manager = SimpleNamespace(client=Client(failures=0))
        self.undeployed = 0
        self.deployed = 0

    def get_machines_api_objects(self, lab_hash: str | None = None) -> list[Any]:
        if lab_hash not in (None, self.hash):
            return []
        return [
            SimpleNamespace(labels={"name": name, "lab_hash": self.hash}, status=status, name=name)
            for name, status in self.states.items()
        ]

    def undeploy_lab(self, lab: Any = None) -> None:
        self.undeployed += 1
        self.states = {}

    def deploy_lab(self, lab: Any) -> None:
        self.deployed += 1
        self.states = {name: "running" for name in lab.machines}


def lab_topology() -> Topology:
    return Topology(
        name="lab",
        nodes=[
            Node(name="r1", interfaces=[Interface(number=0, collision_domain="A")]),
            Node(name="r2", interfaces=[Interface(number=0, collision_domain="A")]),
        ],
    )


@pytest.fixture
def no_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner, "wait_for_lab", lambda *args, **kwargs: None)


def test_exited_containers_are_removed_without_asking(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, no_wait: None
) -> None:
    """The user's request after 3E.3: nothing runs in them, so just deploy."""
    manager = Manager("lab", {"r1": "exited", "r2": "exited"})
    use(monkeypatch, manager)

    result = runner.deploy(lab_topology(), tmp_path)

    assert not result.needs_confirmation
    assert manager.undeployed == 1 and manager.deployed == 1
    assert result.running == ["r1", "r2"]
    assert result.message == "Removed 2 devices left stopped by an earlier run."


def test_a_running_container_still_asks_first(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, no_wait: None
) -> None:
    """Its configuration could still be captured (F32), so the user decides."""
    manager = Manager("lab", {"r1": "running", "r2": "exited"})
    use(monkeypatch, manager)

    result = runner.deploy(lab_topology(), tmp_path)

    assert result.needs_confirmation
    assert result.conflicts is not None and result.conflicts.running == ("r1",)
    assert manager.undeployed == 0 and manager.deployed == 0


def test_an_inconsistent_state_also_names_the_button() -> None:
    """Kathará says to run its CLI, which Windows users often do not have (3E.3)."""
    from Kathara.exceptions import DockerPluginError

    exc = DockerPluginError(
        "Kathara has been left in an inconsistent state! Please run `kathara wipe`."
    )
    assert runner._reason(exc) == (
        "Kathara has been left in an inconsistent state! "
        "Please run `kathara wipe`, or press Stop every lab."
    )
