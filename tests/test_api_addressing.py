"""The addressing endpoints, and the exam-mode gate protecting them."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from kathara_gui.features import Features
from kathara_gui.main import create_app
from kathara_gui.project.session import Session, get_session

TOKEN = "test-token-value"

TRIANGLE = {
    "name": "lab",
    "nodes": [
        {"name": "r1", "interfaces": [{"number": 0, "collision_domain": "A"}]},
        {"name": "r2", "interfaces": [{"number": 0, "collision_domain": "A"}]},
        {"name": "r3", "interfaces": [{"number": 0, "collision_domain": "B"}]},
    ],
}

MIXED_SUBNETS = {
    "name": "lab",
    "nodes": [
        {
            "name": "r1",
            "interfaces": [{"number": 0, "collision_domain": "A", "ip": "10.0.0.1/24"}],
        },
        {
            "name": "r2",
            "interfaces": [{"number": 0, "collision_domain": "A", "ip": "192.168.1.1/24"}],
        },
    ],
}


@pytest.fixture
def session() -> Session:
    return Session()


@pytest.fixture
def client(session: Session) -> Iterator[TestClient]:
    app = create_app(token=TOKEN)
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app, headers={"X-KGUI-Token": TOKEN}) as test_client:
        yield test_client


# -- validation --------------------------------------------------------


def test_a_clean_plan_reports_nothing(client: TestClient) -> None:
    client.put("/api/topology", json={"name": "lab", "nodes": []})
    body = client.get("/api/topology/addressing/issues").json()
    assert body == {"issues": [], "errors": 0, "warnings": 0}


def test_mixed_subnets_are_reported_as_an_error(client: TestClient) -> None:
    client.put("/api/topology", json=MIXED_SUBNETS)
    body = client.get("/api/topology/addressing/issues").json()

    assert body["errors"] == 1
    issue = next(i for i in body["issues"] if i["code"] == "mixed_subnets")
    assert issue["collision_domain"] == "A"
    assert sorted(issue["devices"]) == ["r1", "r2"]


def test_unaddressed_interfaces_are_warnings(client: TestClient) -> None:
    client.put("/api/topology", json=TRIANGLE)
    body = client.get("/api/topology/addressing/issues").json()
    assert body["errors"] == 0
    assert body["warnings"] == 3


# -- allocation --------------------------------------------------------


def test_allocation_fills_in_the_plan(client: TestClient) -> None:
    client.put("/api/topology", json=TRIANGLE)
    body = client.post("/api/topology/addressing/allocate", json={}).json()

    assert body["changed"] is True
    assert body["assigned_subnets"] == {"A": "10.0.0.0/24", "B": "10.0.1.0/24"}
    assert body["assigned_addresses"]["r1:0"] == "10.0.0.1/24"


def test_allocation_becomes_the_edited_topology(client: TestClient) -> None:
    client.put("/api/topology", json=TRIANGLE)
    client.post("/api/topology/addressing/allocate", json={})

    stored = client.get("/api/topology").json()["topology"]
    assert stored["nodes"][0]["interfaces"][0]["ip"] == "10.0.0.1/24"


def test_allocation_clears_the_missing_address_warnings(client: TestClient) -> None:
    client.put("/api/topology", json=TRIANGLE)
    client.post("/api/topology/addressing/allocate", json={})

    body = client.get("/api/topology/addressing/issues").json()
    assert body == {"issues": [], "errors": 0, "warnings": 0}


def test_a_custom_pool_is_honoured(client: TestClient) -> None:
    client.put("/api/topology", json=TRIANGLE)
    body = client.post(
        "/api/topology/addressing/allocate",
        json={"pool": "172.16.0.0/16", "prefix": 30},
    ).json()
    assert body["assigned_subnets"]["A"] == "172.16.0.0/30"


def test_a_prefix_larger_than_the_pool_is_refused_with_a_reason(client: TestClient) -> None:
    client.put("/api/topology", json=TRIANGLE)
    response = client.post(
        "/api/topology/addressing/allocate", json={"pool": "10.0.0.0/24", "prefix": 16}
    )
    assert response.status_code == 422
    assert "larger than the pool" in response.json()["detail"]


def test_an_unparseable_pool_is_refused(client: TestClient) -> None:
    client.put("/api/topology", json=TRIANGLE)
    response = client.post(
        "/api/topology/addressing/allocate", json={"pool": "not-a-network", "prefix": 24}
    )
    assert response.status_code == 422


def test_allocation_preserves_hand_written_addresses_by_default(client: TestClient) -> None:
    client.put(
        "/api/topology",
        json={
            "name": "lab",
            "nodes": [
                {
                    "name": "r1",
                    "interfaces": [
                        {"number": 0, "collision_domain": "A", "ip": "172.16.9.1/24"}
                    ],
                },
                {"name": "r2", "interfaces": [{"number": 0, "collision_domain": "A"}]},
            ],
            "collision_domains": [{"name": "A", "subnet": "172.16.9.0/24"}],
        },
    )
    body = client.post("/api/topology/addressing/allocate", json={}).json()

    assert body["topology"]["nodes"][0]["interfaces"][0]["ip"] == "172.16.9.1/24"
    assert body["topology"]["nodes"][1]["interfaces"][0]["ip"] == "172.16.9.2/24"


def test_overwrite_renumbers_everything(client: TestClient) -> None:
    client.put(
        "/api/topology",
        json={
            "name": "lab",
            "nodes": [
                {
                    "name": "r1",
                    "interfaces": [
                        {"number": 0, "collision_domain": "A", "ip": "172.16.9.1/24"}
                    ],
                }
            ],
            "collision_domains": [{"name": "A", "subnet": "172.16.9.0/24"}],
        },
    )
    body = client.post(
        "/api/topology/addressing/allocate", json={"overwrite": True}
    ).json()
    assert body["topology"]["nodes"][0]["interfaces"][0]["ip"] == "10.0.0.1/24"


# -- exam mode (Capability 8) -----------------------------------------


def test_the_calculator_can_be_withdrawn_for_a_scenario(
    client: TestClient, session: Session
) -> None:
    session.set_features(Features(subnet_calculator=False))
    client.put("/api/topology", json=TRIANGLE)

    response = client.post("/api/topology/addressing/allocate", json={})
    assert response.status_code == 403
    assert "disabled for this scenario" in response.json()["detail"]


def test_a_withdrawn_calculator_changes_nothing(client: TestClient, session: Session) -> None:
    """The refusal must be real, not merely a message."""
    client.put("/api/topology", json=TRIANGLE)
    session.set_features(Features(subnet_calculator=False))
    client.post("/api/topology/addressing/allocate", json={})

    stored = client.get("/api/topology").json()["topology"]
    assert stored["nodes"][0]["interfaces"][0]["ip"] is None


def test_validation_can_be_withdrawn_separately(client: TestClient, session: Session) -> None:
    """A troubleshooting exam may allow planning but hide the answers."""
    session.set_features(Features(addressing_validation=False))
    client.put("/api/topology", json=MIXED_SUBNETS)

    assert client.get("/api/topology/addressing/issues").status_code == 403
    # The calculator is untouched by the other flag.
    assert client.post("/api/topology/addressing/allocate", json={}).status_code == 200


def test_features_default_to_permissive(session: Session) -> None:
    assert session.features.subnet_calculator is True
    assert session.features.addressing_validation is True


def test_resetting_the_scenario_restores_the_defaults(session: Session) -> None:
    """Exam restrictions belong to the scenario, not to the running program."""
    session.set_features(Features(subnet_calculator=False))
    session.reset()
    assert session.features.subnet_calculator is True


def test_addressing_endpoints_require_the_session_token() -> None:
    app = create_app(token=TOKEN)
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/topology/addressing/issues").status_code == 401
        assert anonymous.post("/api/topology/addressing/allocate", json={}).status_code == 401


# -- stateless check ---------------------------------------------------


def test_check_validates_a_supplied_topology_without_storing_it(client: TestClient) -> None:
    """The editor validates the in-browser document, which is ahead of the session."""
    response = client.post("/api/topology/addressing/check", json=MIXED_SUBNETS)
    assert response.status_code == 200
    assert response.json()["errors"] == 1

    # The session is untouched.
    assert client.get("/api/topology").json()["topology"]["nodes"] == []


def test_check_agrees_with_the_session_endpoint(client: TestClient) -> None:
    """One rule set, so a student cannot be told two different things."""
    client.put("/api/topology", json=MIXED_SUBNETS)
    stored = client.get("/api/topology/addressing/issues").json()
    supplied = client.post("/api/topology/addressing/check", json=MIXED_SUBNETS).json()
    assert stored == supplied


def test_check_is_withdrawn_with_validation(client: TestClient, session: Session) -> None:
    session.set_features(Features(addressing_validation=False))
    assert client.post("/api/topology/addressing/check", json=MIXED_SUBNETS).status_code == 403


# -- regression: unsaved edits must not be discarded -------------------


def test_allocate_uses_the_supplied_topology_not_the_stale_session(client: TestClient) -> None:
    """The editor's document is ahead of the session until the user saves.

    Allocating over the session instead returned an empty topology, which the
    browser then adopted — wiping every device off the canvas.
    """
    # Session is empty, as it is before the first save.
    assert client.get("/api/topology").json()["topology"]["nodes"] == []

    body = client.post(
        "/api/topology/addressing/allocate", json={"topology": TRIANGLE}
    ).json()

    assert [n["name"] for n in body["topology"]["nodes"]] == ["r1", "r2", "r3"]
    assert body["topology"]["nodes"][0]["interfaces"][0]["ip"] == "10.0.0.1/24"


def test_allocate_never_returns_fewer_devices_than_it_was_given(client: TestClient) -> None:
    """The property that failed: devices in, the same devices out."""
    for payload in (TRIANGLE, MIXED_SUBNETS):
        body = client.post(
            "/api/topology/addressing/allocate", json={"topology": payload}
        ).json()
        assert len(body["topology"]["nodes"]) == len(payload["nodes"])


def test_allocating_a_supplied_topology_updates_the_session(client: TestClient) -> None:
    client.post("/api/topology/addressing/allocate", json={"topology": TRIANGLE})
    stored = client.get("/api/topology").json()["topology"]
    assert [n["name"] for n in stored["nodes"]] == ["r1", "r2", "r3"]


def test_omitting_the_topology_still_uses_the_session(client: TestClient) -> None:
    """Kept for API callers driving the server directly."""
    client.put("/api/topology", json=TRIANGLE)
    body = client.post("/api/topology/addressing/allocate", json={}).json()
    assert len(body["topology"]["nodes"]) == 3


def test_a_pinned_subnet_is_honoured_and_the_rest_allocated(client: TestClient) -> None:
    """Pin one domain, let the allocator fill in the others around it."""
    body = client.post(
        "/api/topology/addressing/allocate",
        json={
            "topology": {
                "name": "lab",
                "nodes": [
                    {
                        "name": "r1",
                        "interfaces": [
                            {"number": 0, "collision_domain": "A"},
                            {"number": 1, "collision_domain": "C"},
                        ],
                    },
                    {
                        "name": "r2",
                        "interfaces": [{"number": 0, "collision_domain": "A"}],
                    },
                    {
                        "name": "r3",
                        "interfaces": [{"number": 0, "collision_domain": "C"}],
                    },
                ],
                "collision_domains": [{"name": "C", "subnet": "192.168.1.0/24"}],
            }
        },
    ).json()

    addresses = {
        f"{n['name']}:{i['number']}": i["ip"]
        for n in body["topology"]["nodes"]
        for i in n["interfaces"]
    }
    # C keeps the pinned network; A is allocated from the pool.
    assert addresses["r1:1"] == "192.168.1.1/24"
    assert addresses["r3:0"] == "192.168.1.2/24"
    assert addresses["r1:0"].startswith("10.")
    assert "C" not in body["assigned_subnets"]


def test_renumbering_discards_a_pinned_subnet(client: TestClient) -> None:
    """Documented behaviour: Renumber all means all, pinned subnets included."""
    body = client.post(
        "/api/topology/addressing/allocate",
        json={
            "overwrite": True,
            "topology": {
                "name": "lab",
                "nodes": [{"name": "r1", "interfaces": [{"number": 0, "collision_domain": "C"}]}],
                "collision_domains": [{"name": "C", "subnet": "192.168.1.0/24"}],
            },
        },
    ).json()
    assert body["topology"]["nodes"][0]["interfaces"][0]["ip"] == "10.0.0.1/24"
