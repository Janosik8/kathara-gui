"""Addressing allocation and conflict detection."""

from __future__ import annotations

import pytest

from kathara_gui.domain.addressing import (
    Severity,
    allocate,
    infer_subnets,
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


def test_overlap_is_a_warning_because_a_vpn_lab_means_it() -> None:
    """Bug 23: the same subnet on both sides of a VPN was reported as an error."""
    topo = topology(("r1", [(0, "A", "10.9.0.1/24")]), ("r2", [(0, "B", "10.9.0.1/24")]))
    topo.collision_domains = [
        CollisionDomain(name="A", subnet="10.9.0.0/24"),
        CollisionDomain(name="B", subnet="10.9.0.0/24"),
    ]
    issues = [i for i in validate(topo) if i.code == "overlapping_subnets"]
    assert [i.severity for i in issues] == [Severity.WARNING]
    assert "VPN" in issues[0].message
    # Nor is the same host address on two separate domains a duplicate.
    assert not [i for i in validate(topo) if i.severity is Severity.ERROR]


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


def test_a_pool_with_host_bits_set_is_refused_with_both_readings() -> None:
    """Test step 3B.1: 192.168.0.0/8 was silently read as 192.0.0.0/8."""
    topo = topology(("r1", [(0, "A", None)]))
    with pytest.raises(ValueError) as caught:
        allocate(topo, pool="192.168.0.0/8", prefix=24)
    message = str(caught.value)
    assert "192.0.0.0/8" in message  # what the mask means
    assert "192.168.0.0/16" in message  # what the address means


def test_a_pool_that_is_not_an_address_says_so() -> None:
    topo = topology(("r1", [(0, "A", None)]))
    with pytest.raises(ValueError, match="not an address pool"):
        allocate(topo, pool="ten dot zero", prefix=24)


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


# -- inferring a subnet from the addresses already on the wire ----------


class TestInferSubnets:
    """Kathará records the wiring but not the plan.

    An imported lab therefore arrives with named collision domains and no
    subnets, even though every member's address says exactly what the network
    is — so the panel and the diagram showed a bare letter where they should
    have shown `10.10.0.0/24`.
    """

    def test_a_domain_takes_the_network_its_members_share(self) -> None:
        topology = Topology(
            name="imported",
            nodes=[
                Node(
                    name="r1",
                    interfaces=[Interface(number=0, collision_domain="K", ip="10.10.0.1/24")],
                ),
                Node(
                    name="pc1",
                    interfaces=[Interface(number=0, collision_domain="K", ip="10.10.0.50/24")],
                ),
            ],
        )
        assert infer_subnets(topology) == {"K": "10.10.0.0/24"}

    def test_a_point_to_point_link_keeps_its_narrow_mask(self) -> None:
        topology = Topology(
            name="imported",
            nodes=[
                Node(
                    name="r1",
                    interfaces=[Interface(number=0, collision_domain="L", ip="172.16.5.1/30")],
                ),
                Node(
                    name="r2",
                    interfaces=[Interface(number=0, collision_domain="L", ip="172.16.5.2/30")],
                ),
            ],
        )
        assert infer_subnets(topology) == {"L": "172.16.5.0/30"}

    def test_a_domain_whose_members_disagree_is_left_alone(self) -> None:
        """The specification's headline fault. Inventing a subnet here would
        paper over exactly what the user needs to see."""
        topology = Topology(
            name="broken",
            nodes=[
                Node(
                    name="r1",
                    interfaces=[Interface(number=0, collision_domain="X", ip="192.168.1.1/24")],
                ),
                Node(
                    name="r2",
                    interfaces=[Interface(number=0, collision_domain="X", ip="10.99.0.1/24")],
                ),
            ],
        )
        assert infer_subnets(topology) == {}
        assert any(i.code == "mixed_subnets" for i in validate(topology))

    def test_a_domain_with_no_addresses_yields_nothing(self) -> None:
        topology = Topology(
            name="bare",
            nodes=[Node(name="pc1", interfaces=[Interface(number=0, collision_domain="Z")])],
        )
        assert infer_subnets(topology) == {}

    def test_one_addressed_member_is_enough(self) -> None:
        """A router addressed and a host not yet: the network is still known."""
        topology = Topology(
            name="partial",
            nodes=[
                Node(
                    name="r1",
                    interfaces=[Interface(number=0, collision_domain="K", ip="10.0.0.1/24")],
                ),
                Node(name="pc1", interfaces=[Interface(number=0, collision_domain="K")]),
            ],
        )
        assert infer_subnets(topology) == {"K": "10.0.0.0/24"}

    def test_every_domain_is_considered(self) -> None:
        topology = Topology(
            name="several",
            nodes=[
                Node(
                    name="r1",
                    interfaces=[
                        Interface(number=0, collision_domain="K", ip="10.10.0.1/24"),
                        Interface(number=1, collision_domain="L", ip="172.16.5.1/30"),
                    ],
                )
            ],
        )
        assert infer_subnets(topology) == {"K": "10.10.0.0/24", "L": "172.16.5.0/30"}
