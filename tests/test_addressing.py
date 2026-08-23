"""Addressing allocation and conflict detection."""

from __future__ import annotations

import pytest

from kathara_gui.domain.addressing import (
    Severity,
    allocate,
    validate,
)
from kathara_gui.domain.model import CollisionDomain, Interface, Node, Topology


def topology(*specs: tuple[str, list[tuple[int, str, str | None]]], **kwargs) -> Topology:
    """Build a topology from (device, [(iface, domain, ip)]) tuples."""
    nodes = [
        Node(
            name=name,
            interfaces=[
                Interface(number=n, collision_domain=cd, ip=ip) for n, cd, ip in interfaces
            ],
        )
        for name, interfaces in specs
    ]
    return Topology(nodes=nodes, **kwargs)


def codes(issues) -> list[str]:
    return [i.code for i in issues]


# -- the failure the specification singles out -------------------------


def test_two_subnets_on_one_collision_domain_is_an_error() -> None:
    """The classic lab failure: everything up, nothing reachable."""
    topo = topology(
        ("r1", [(0, "A", "10.0.0.1/24")]),
        ("r2", [(0, "A", "192.168.1.1/24")]),
    )
    issues = validate(topo)
    mixed = [i for i in issues if i.code == "mixed_subnets"]

    assert len(mixed) == 1
    assert mixed[0].severity is Severity.ERROR
    assert mixed[0].collision_domain == "A"
    assert set(mixed[0].devices) == {"r1", "r2"}


def test_the_message_names_both_subnets_and_who_is_on_them() -> None:
    topo = topology(
        ("r1", [(0, "A", "10.0.0.1/24")]),
        ("r2", [(0, "A", "192.168.1.1/24")]),
    )
    message = next(i for i in validate(topo) if i.code == "mixed_subnets").message
    assert "10.0.0.0/24" in message
    assert "192.168.1.0/24" in message
    assert "r1 eth0" in message and "r2 eth0" in message


def test_differing_masks_on_one_domain_are_caught() -> None:
    """A /24 and a /25 put these two on different networks."""
    topo = topology(
        ("r1", [(0, "A", "10.0.0.1/24")]),
        ("r2", [(0, "A", "10.0.0.200/25")]),
    )
    assert "mixed_subnets" in codes(validate(topo))


def test_one_subnet_per_domain_is_clean() -> None:
    topo = topology(
        ("r1", [(0, "A", "10.0.0.1/24")]),
        ("r2", [(0, "A", "10.0.0.2/24")]),
    )
    assert "mixed_subnets" not in codes(validate(topo))


def test_separate_domains_may_use_different_subnets() -> None:
    topo = topology(
        ("r1", [(0, "A", "10.0.0.1/24"), (1, "B", "10.0.1.1/24")]),
        ("r2", [(0, "A", "10.0.0.2/24")]),
        ("r3", [(0, "B", "10.0.1.2/24")]),
    )
    assert [i for i in validate(topo) if i.severity is Severity.ERROR] == []


# -- other conflicts ---------------------------------------------------


def test_duplicate_address_on_one_domain() -> None:
    topo = topology(
        ("r1", [(0, "A", "10.0.0.1/24")]),
        ("r2", [(0, "A", "10.0.0.1/24")]),
    )
    assert "duplicate_address" in codes(validate(topo))


def test_same_address_on_different_domains_is_allowed() -> None:
    # Unusual, but not a conflict: they are separate broadcast domains.
    topo = topology(
        ("r1", [(0, "A", "10.0.0.1/24")]),
        ("r2", [(0, "B", "10.0.0.1/24")]),
    )
    assert "duplicate_address" not in codes(validate(topo))


def test_address_outside_the_planned_subnet() -> None:
    topo = topology(("r1", [(0, "A", "192.168.5.1/24")]))
    topo.collision_domains = [CollisionDomain(name="A", subnet="10.0.0.0/24")]
    assert "outside_planned_subnet" in codes(validate(topo))


def test_overlapping_planned_subnets() -> None:
    topo = topology(("r1", [(0, "A", None)]), ("r2", [(0, "B", None)]))
    topo.collision_domains = [
        CollisionDomain(name="A", subnet="10.0.0.0/16"),
        CollisionDomain(name="B", subnet="10.0.1.0/24"),
    ]
    assert "overlapping_subnets" in codes(validate(topo))


def test_adjacent_subnets_do_not_overlap() -> None:
    topo = topology(("r1", [(0, "A", None)]), ("r2", [(0, "B", None)]))
    topo.collision_domains = [
        CollisionDomain(name="A", subnet="10.0.0.0/24"),
        CollisionDomain(name="B", subnet="10.0.1.0/24"),
    ]
    assert "overlapping_subnets" not in codes(validate(topo))


@pytest.mark.parametrize("address", ["10.0.0.0/24", "10.0.0.255/24"])
def test_network_and_broadcast_addresses_are_rejected(address: str) -> None:
    topo = topology(("r1", [(0, "A", address)]))
    assert "reserved_address" in codes(validate(topo))


def test_a_slash_31_link_has_no_reserved_addresses() -> None:
    """RFC 3021: both addresses of a /31 are usable on a point-to-point link."""
    topo = topology(
        ("r1", [(0, "A", "10.0.0.0/31")]),
        ("r2", [(0, "A", "10.0.0.1/31")]),
    )
    assert "reserved_address" not in codes(validate(topo))


def test_missing_address_is_a_warning_not_an_error() -> None:
    issues = validate(topology(("r1", [(0, "A", None)])))
    missing = [i for i in issues if i.code == "missing_address"]
    assert len(missing) == 1
    assert missing[0].severity is Severity.WARNING


def test_errors_are_reported_before_warnings() -> None:
    topo = topology(
        ("r1", [(0, "A", "10.0.0.1/24")]),
        ("r2", [(0, "A", "192.168.1.1/24"), (1, "B", None)]),
    )
    severities = [i.severity for i in validate(topo)]
    assert severities == sorted(severities, key=lambda s: 0 if s is Severity.ERROR else 1)


def test_a_clean_topology_reports_nothing() -> None:
    topo = topology(
        ("r1", [(0, "A", "10.0.0.1/24")]),
        ("r2", [(0, "A", "10.0.0.2/24")]),
    )
    assert validate(topo) == []


# -- allocation --------------------------------------------------------


def test_allocation_gives_each_domain_its_own_subnet() -> None:
    topo = topology(
        ("r1", [(0, "A", None), (1, "B", None)]),
        ("r2", [(0, "A", None)]),
        ("r3", [(0, "B", None)]),
    )
    result = allocate(topo)
    assert result.assigned_subnets == {"A": "10.0.0.0/24", "B": "10.0.1.0/24"}


def test_allocation_numbers_hosts_from_one() -> None:
    topo = topology(("r1", [(0, "A", None)]), ("r2", [(0, "A", None)]))
    result = allocate(topo)
    addresses = [i.ip for n in result.topology.nodes for i in n.interfaces]
    assert addresses == ["10.0.0.1/24", "10.0.0.2/24"]


def test_allocation_produces_a_plan_that_validates() -> None:
    topo = topology(
        ("r1", [(0, "A", None), (1, "C", None)]),
        ("r2", [(0, "A", None), (1, "B", None)]),
        ("r3", [(0, "B", None), (1, "C", None)]),
    )
    assert [i for i in validate(allocate(topo).topology) if i.severity is Severity.ERROR] == []


def test_allocation_leaves_the_original_untouched() -> None:
    topo = topology(("r1", [(0, "A", None)]))
    allocate(topo)
    assert topo.nodes[0].interfaces[0].ip is None


def test_allocation_preserves_hand_written_addresses() -> None:
    """The tool assists the designer; it does not overrule them."""
    topo = topology(
        ("r1", [(0, "A", "172.16.9.1/24")]),
        ("r2", [(0, "A", None)]),
    )
    topo.collision_domains = [CollisionDomain(name="A", subnet="172.16.9.0/24")]
    result = allocate(topo)

    assert result.topology.nodes[0].interfaces[0].ip == "172.16.9.1/24"
    # The gap is filled without colliding with what was already there.
    assert result.topology.nodes[1].interfaces[0].ip == "172.16.9.2/24"


def test_allocation_does_not_reuse_a_manually_reserved_subnet() -> None:
    topo = topology(("r1", [(0, "A", None)]), ("r2", [(0, "B", None)]))
    topo.collision_domains = [
        CollisionDomain(name="A", subnet="10.0.0.0/24"),
        CollisionDomain(name="B"),
    ]
    result = allocate(topo)
    assert result.assigned_subnets["B"] != "10.0.0.0/24"


def test_overwrite_renumbers_everything() -> None:
    topo = topology(("r1", [(0, "A", "172.16.9.1/24")]))
    topo.collision_domains = [CollisionDomain(name="A", subnet="172.16.9.0/24")]
    result = allocate(topo, overwrite=True)

    assert result.topology.collision_domains[0].subnet == "10.0.0.0/24"
    assert result.topology.nodes[0].interfaces[0].ip == "10.0.0.1/24"


def test_a_custom_pool_and_prefix_are_honoured() -> None:
    topo = topology(("r1", [(0, "A", None)]), ("r2", [(0, "A", None)]))
    result = allocate(topo, pool="192.168.0.0/16", prefix=30)

    assert result.assigned_subnets == {"A": "192.168.0.0/30"}
    assert result.topology.nodes[0].interfaces[0].ip == "192.168.0.1/30"


def test_a_prefix_larger_than_the_pool_is_refused() -> None:
    topo = topology(("r1", [(0, "A", None)]))
    with pytest.raises(ValueError, match="larger than the pool"):
        allocate(topo, pool="10.0.0.0/24", prefix=16)


def test_running_out_of_host_addresses_is_reported_not_silent() -> None:
    # A /30 holds two hosts; the third device cannot be numbered.
    topo = topology(
        ("r1", [(0, "A", None)]),
        ("r2", [(0, "A", None)]),
        ("r3", [(0, "A", None)]),
    )
    result = allocate(topo, prefix=30)
    assert "r3 eth0" in result.skipped
    assert result.topology.nodes[2].interfaces[0].ip is None


def test_allocation_reports_whether_it_changed_anything() -> None:
    topo = topology(("r1", [(0, "A", "10.0.0.1/24")]))
    topo.collision_domains = [CollisionDomain(name="A", subnet="10.0.0.0/24")]
    assert allocate(topo).changed is False
    assert allocate(topology(("r1", [(0, "A", None)]))).changed is True


def test_domains_with_no_members_are_not_allocated() -> None:
    """An orphan left by a disconnect should not consume address space."""
    topo = topology(("r1", [(0, "A", None)]))
    topo.collision_domains.append(CollisionDomain(name="Z"))
    result = allocate(topo)
    assert "Z" not in result.assigned_subnets
