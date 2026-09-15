"""What has changed since the lab was deployed.

The reported confusion: change an address on the canvas, press **Verify
links**, and the results describe the *old* address. Both halves of that are
working as designed — diagnostics ping real containers, so they can only ever
report what is running — but the interface said nothing about the two having
parted company, which made a correct answer look like a bug.

So the comparison is made explicit. A running lab is a snapshot of the topology
at the moment it was deployed; the canvas moves on, and the difference is worth
naming precisely rather than reducing to a dot.

Only differences that change *what runs* are reported. Moving a device on the
canvas is not a change to the network, and warning about it would train the
user to ignore the warning.
"""

from __future__ import annotations

from kathara_gui.domain.model import Node, Topology

__all__ = ["describe_drift"]


def _interfaces(node: Node) -> dict[int, tuple[str, str | None]]:
    return {i.number: (i.collision_domain, i.ip) for i in node.interfaces}


def _describe_device(deployed: Node, current: Node) -> list[str]:
    changes: list[str] = []

    if (deployed.image or None) != (current.image or None):
        changes.append(
            f"{current.name} would run {current.image or 'the default image'} "
            f"instead of {deployed.image or 'the default image'}"
        )

    if sorted(deployed.daemons) != sorted(current.daemons):
        changes.append(
            f"{current.name} routing daemons changed to "
            f"{', '.join(sorted(current.daemons)) or 'none'}"
        )

    was, now = _interfaces(deployed), _interfaces(current)

    for number in sorted(set(was) | set(now)):
        if number not in now:
            changes.append(f"{current.name} eth{number} was removed")
            continue
        if number not in was:
            domain, ip = now[number]
            changes.append(
                f"{current.name} eth{number} was added on {domain}"
                + (f" with {ip}" if ip else "")
            )
            continue

        old_domain, old_ip = was[number]
        new_domain, new_ip = now[number]
        if old_domain != new_domain:
            changes.append(
                f"{current.name} eth{number} moved from {old_domain} to {new_domain}"
            )
        if old_ip != new_ip:
            changes.append(
                f"{current.name} eth{number} is {new_ip or 'unaddressed'} on the canvas "
                f"but {old_ip or 'unaddressed'} in the running lab"
            )

    return changes


def describe_drift(deployed: Topology | None, current: Topology) -> list[str]:
    """Differences between what is running and what the editor holds.

    Returns one plain sentence per difference, in a stable order, so the
    interface can list them rather than saying only that *something* differs —
    which would leave the user hunting for it.

    ``None`` means nothing has been deployed from this session, so there is
    nothing to compare against and nothing to report.
    """
    if deployed is None:
        return []

    was = {node.name: node for node in deployed.nodes}
    now = {node.name: node for node in current.nodes}

    changes: list[str] = []

    for name in sorted(set(was) - set(now)):
        changes.append(f"{name} was removed from the topology but is still running")

    for name in sorted(set(now) - set(was)):
        changes.append(f"{name} was added and is not running")

    for name in sorted(set(was) & set(now)):
        changes.extend(_describe_device(was[name], now[name]))

    return changes
