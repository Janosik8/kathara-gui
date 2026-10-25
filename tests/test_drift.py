"""What has changed since the lab was deployed (FR-21).

The reported confusion: change an address on the canvas, press Verify links,
and the results describe the *old* address. Both halves work as designed —
diagnostics ping real containers — but nothing said the two had parted company,
so a correct answer looked like a fault.
"""

from __future__ import annotations

from kathara_gui.domain.drift import describe_drift, describe_live_drift
from kathara_gui.domain.model import Interface, Node, Position, Topology


def lab(**addresses: str | None) -> Topology:
    return Topology(
        name="lab",
        nodes=[
            Node(
                name=name,
                kind="router",
                daemons=["zebra"],
                interfaces=[Interface(number=0, collision_domain="A", ip=ip)],
            )
            for name, ip in addresses.items()
        ],
    )


# -- nothing to report --------------------------------------------------


def test_nothing_deployed_means_nothing_to_compare() -> None:
    assert describe_drift(None, lab(r1="10.0.0.1/24")) == []


def test_an_unchanged_topology_reports_nothing() -> None:
    deployed = lab(r1="10.0.0.1/24", r2="10.0.0.2/24")
    assert describe_drift(deployed, lab(r1="10.0.0.1/24", r2="10.0.0.2/24")) == []


def test_moving_a_device_on_the_canvas_is_not_drift() -> None:
    """It changes the picture, not the network. Warning about it would train
    the user to ignore the warning."""
    deployed = lab(r1="10.0.0.1/24")
    moved = lab(r1="10.0.0.1/24")
    moved.nodes[0].position = Position(x=900, y=900)

    assert describe_drift(deployed, moved) == []


# -- the reported case --------------------------------------------------


def test_a_changed_address_is_reported_with_both_values() -> None:
    changes = describe_drift(lab(r1="10.0.0.1/24"), lab(r1="192.168.1.1/24"))

    assert len(changes) == 1
    assert "192.168.1.1/24" in changes[0], "the canvas value"
    assert "10.0.0.1/24" in changes[0], "the running value"
    assert "r1 eth0" in changes[0]


def test_an_address_being_cleared_is_reported() -> None:
    (change,) = describe_drift(lab(r1="10.0.0.1/24"), lab(r1=None))
    assert "unaddressed" in change


# -- structure ----------------------------------------------------------


def test_an_added_device_is_reported() -> None:
    changes = describe_drift(lab(r1="10.0.0.1/24"), lab(r1="10.0.0.1/24", r2="10.0.0.2/24"))
    assert changes == ["r2 was added and is not running"]


def test_a_removed_device_is_reported_as_still_running() -> None:
    changes = describe_drift(lab(r1="10.0.0.1/24", r2="10.0.0.2/24"), lab(r1="10.0.0.1/24"))
    assert changes == ["r2 was removed from the topology but is still running"]


def test_a_rewired_interface_is_reported() -> None:
    deployed = lab(r1="10.0.0.1/24")
    rewired = lab(r1="10.0.0.1/24")
    rewired.nodes[0].interfaces[0].collision_domain = "B"

    (change,) = describe_drift(deployed, rewired)
    assert "moved from A to B" in change


def test_an_added_interface_is_reported() -> None:
    deployed = lab(r1="10.0.0.1/24")
    extended = lab(r1="10.0.0.1/24")
    extended.nodes[0].interfaces.append(
        Interface(number=1, collision_domain="B", ip="10.0.1.1/24")
    )

    (change,) = describe_drift(deployed, extended)
    assert "eth1 was added on B" in change and "10.0.1.1/24" in change


def test_a_removed_interface_is_reported() -> None:
    deployed = lab(r1="10.0.0.1/24")
    deployed.nodes[0].interfaces.append(Interface(number=1, collision_domain="B"))

    (change,) = describe_drift(deployed, lab(r1="10.0.0.1/24"))
    assert "eth1 was removed" in change


# -- what the device runs ------------------------------------------------


def test_a_changed_image_is_reported() -> None:
    deployed = lab(r1="10.0.0.1/24")
    deployed.nodes[0].image = "kathara/frr"
    changed = lab(r1="10.0.0.1/24")
    changed.nodes[0].image = "kathara/base"

    (change,) = describe_drift(deployed, changed)
    assert "kathara/base" in change and "kathara/frr" in change


def test_changed_daemons_are_reported() -> None:
    deployed = lab(r1="10.0.0.1/24")
    changed = lab(r1="10.0.0.1/24")
    changed.nodes[0].daemons = ["zebra", "ospfd"]

    (change,) = describe_drift(deployed, changed)
    assert "ospfd" in change


def test_daemon_order_alone_is_not_drift() -> None:
    deployed = lab(r1="10.0.0.1/24")
    deployed.nodes[0].daemons = ["zebra", "ospfd"]
    reordered = lab(r1="10.0.0.1/24")
    reordered.nodes[0].daemons = ["ospfd", "zebra"]

    assert describe_drift(deployed, reordered) == []


# -- presentation --------------------------------------------------------


def test_several_changes_are_listed_separately_and_stably() -> None:
    """One sentence per difference, so the user is not left hunting."""
    deployed = lab(r1="10.0.0.1/24", r2="10.0.0.2/24")
    current = lab(r1="192.168.1.1/24", r3="10.0.0.3/24")

    changes = describe_drift(deployed, current)
    assert changes == describe_drift(deployed, current), "unstable order"
    assert len(changes) == 3
    assert any("r2 was removed" in c for c in changes)
    assert any("r3 was added" in c for c in changes)
    assert any("r1 eth0" in c for c in changes)


# -- the other direction: the container changed, the canvas did not -----


class TestLiveDrift:
    """Configuring an address inside a container leaves the canvas *and* the
    deployed snapshot stale in the same way, so they agree with each other and
    both are wrong. Only reading the container can see it."""

    def test_an_address_changed_inside_a_container_is_reported(self) -> None:
        deployed = lab(r1="10.0.0.1/24")
        (change,) = describe_live_drift(deployed, {"r1": {0: "192.168.5.5/24"}})

        assert "192.168.5.5/24" in change, "what the container has"
        assert "10.0.0.1/24" in change, "what was deployed"
        assert "running container" in change

    def test_a_canvas_edit_is_not_reported_twice(self) -> None:
        """Measured against the deployed snapshot precisely so that it is not.

        Comparing the containers with the canvas restated every canvas edit
        backwards, and the header counted one difference as two.
        """
        deployed = lab(r1="10.0.0.1/24")
        edited_on_canvas = lab(r1="192.168.1.1/24")

        # The container still has what was deployed; only the canvas moved.
        assert describe_live_drift(deployed, {"r1": {0: "10.0.0.1/24"}}) == []
        assert len(describe_drift(deployed, edited_on_canvas)) == 1

    def test_agreement_is_silence(self) -> None:
        assert describe_live_drift(lab(r1="10.0.0.1/24"), {"r1": {0: "10.0.0.1/24"}}) == []

    def test_a_device_that_could_not_be_read_is_not_called_changed(self) -> None:
        """A stopped container reports nothing; that is not a difference."""
        assert describe_live_drift(lab(r1="10.0.0.1/24"), {}) == []

    def test_an_address_deleted_inside_a_container_is_reported(self) -> None:
        """Test 4B.2: a device that answered without eth0 has no address there."""
        (change,) = describe_live_drift(lab(r1="10.0.0.1/24"), {"r1": {}})
        assert "no address" in change
        assert "10.0.0.1/24" in change

    def test_an_address_moved_to_another_interface_is_reported(self) -> None:
        """Test 4B.1: eth0's address moved to eth1, which the lab does not use."""
        (change,) = describe_live_drift(lab(r1="10.0.0.1/24"), {"r1": {1: "10.0.0.1/24"}})
        assert "r1 eth0 has no address" in change

    def test_an_unaddressed_interface_left_unaddressed_is_silence(self) -> None:
        assert describe_live_drift(lab(r1=None), {"r1": {}}) == []

    def test_an_address_appearing_where_the_canvas_has_none_is_reported(self) -> None:
        (change,) = describe_live_drift(lab(r1=None), {"r1": {0: "10.0.0.1/24"}})
        assert "unaddressed" in change

    def test_the_order_is_stable(self) -> None:
        current = lab(r1="10.0.0.1/24", r2="10.0.0.2/24")
        live = {"r1": {0: "1.1.1.1/24"}, "r2": {0: "2.2.2.2/24"}}
        assert describe_live_drift(current, live) == describe_live_drift(current, live)
