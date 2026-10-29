"""The local server can execute commands in containers, so the token gate matters.

Any page the user visits can issue requests to ``127.0.0.1``. These tests pin
the three defences: token required, cross-origin refused, bootstrap still
possible.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from kathara_gui.main import create_app

TOKEN = "test-token-value"


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(token=TOKEN))


def test_health_requires_a_token(client: TestClient) -> None:
    assert client.get("/api/health").status_code == 401


def test_health_accepts_the_token_as_a_header(client: TestClient) -> None:
    response = client.get("/api/health", headers={"X-KGUI-Token": TOKEN})
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_accepts_the_token_as_a_query_parameter(client: TestClient) -> None:
    """The browser's first load carries the token in the URL."""
    assert client.get(f"/api/health?token={TOKEN}").status_code == 200


def test_wrong_token_is_refused(client: TestClient) -> None:
    assert client.get("/api/health", headers={"X-KGUI-Token": "wrong"}).status_code == 401


def test_cross_origin_request_is_refused_even_with_a_valid_token(client: TestClient) -> None:
    """Blocks a malicious page that has somehow learned the token."""
    response = client.get(
        "/api/health",
        headers={"X-KGUI-Token": TOKEN, "Origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_same_origin_request_is_allowed(client: TestClient) -> None:
    response = client.get(
        "/api/health",
        headers={"X-KGUI-Token": TOKEN, "Origin": "http://testserver"},
    )
    assert response.status_code == 200


def test_each_session_mints_a_distinct_token() -> None:
    assert create_app().state.token != create_app().state.token


def test_generated_token_is_long_enough_to_resist_guessing() -> None:
    assert len(create_app().state.token) >= 32


def test_without_an_interface_the_root_says_why_instead_of_404(tmp_path) -> None:
    """F45. Served without a token, like the page it stands in for; the API keeps its gate."""
    bare = TestClient(create_app(token=TOKEN, static_dir=tmp_path))
    page = bare.get("/")
    assert page.status_code == 200
    assert "has no interface" in page.text
    assert "install.cmd" in page.text
    assert bare.get("/api/health").status_code == 401
