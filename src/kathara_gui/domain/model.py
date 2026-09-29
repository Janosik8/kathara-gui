"""The topology model — the application's source of truth.

``lab.conf`` is a *build artifact* generated from this model, never the place
state lives. That inversion is what makes iterative editing cheap: the GUI
mutates a typed object and regenerates files, rather than rewriting text.

The model carries more than Kathara does. Positions, device kinds, addressing
plans and routing daemons have no representation in ``lab.conf``, so they are
round-tripped through comments (see :mod:`kathara_gui.domain.codec.labconf`).
A lab written by this tool therefore stays a perfectly ordinary Kathara lab.
"""

from __future__ import annotations

import ipaddress
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from kathara_gui.domain.naming import check_unique_names, validate_device_name

DeviceKind = Literal["router", "switch", "pc", "server"]

# Sensible starting images per kind. Routers need a routing suite; everything
# else only needs a shell and the usual network utilities.
DEFAULT_IMAGES: dict[DeviceKind, str] = {
    "router": "kathara/frr",
    "switch": "kathara/base",
    "pc": "kathara/base",
    "server": "kathara/base",
}

# FRR daemons the addressing/config generators know how to enable.
KNOWN_DAEMONS = frozenset(
    ["zebra", "bgpd", "ospfd", "ospf6d", "ripd", "ripngd", "isisd", "staticd"]
)


class Position(BaseModel):
    """Canvas coordinates. Preserved so a shared lab reopens looking the same."""

    x: float = 0.0
    y: float = 0.0


class Interface(BaseModel):
    """One network interface, i.e. ``ethN`` attached to a collision domain."""

    number: int = Field(ge=0, description="Interface index; 0 means eth0")
    collision_domain: str
    mac_address: str | None = None
    ip: str | None = Field(default=None, description="Address in CIDR form, e.g. 10.0.0.1/24")

    @field_validator("collision_domain")
    @classmethod
    def _cd_is_usable(cls, value: str) -> str:
        if not value or not value.replace("_", "").replace("-", "").isalnum():
            raise ValueError(
                f"Collision domain {value!r} must be alphanumeric "
                "(dashes and underscores allowed)."
            )
        return value

    @field_validator("ip")
    @classmethod
    def _ip_is_cidr(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            # strict=False keeps host addresses such as 10.0.0.1/24, which is
            # exactly what an interface carries.
            ipaddress.ip_interface(value)
        except ValueError as exc:
            raise ValueError(f"{value!r} is not a valid address in CIDR form: {exc}") from exc
        return value

    @property
    def name(self) -> str:
        return f"eth{self.number}"


class Node(BaseModel):
    """A device: router, switch, PC or server."""

    name: str
    kind: DeviceKind = "router"
    image: str | None = Field(default=None, description="None means the kind's default")
    memory: str | None = Field(default=None, description="Kathara mem syntax, e.g. '128m'")
    cpus: float | None = None
    bridged: bool = False
    position: Position = Field(default_factory=Position)
    interfaces: list[Interface] = Field(default_factory=list)
    daemons: list[str] = Field(default_factory=list)
    extra_options: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "lab.conf options this model does not interpret (port, sysctl, env, ...). "
            "Preserved verbatim so importing and re-exporting a lab never loses data."
        ),
    )

    @field_validator("name")
    @classmethod
    def _name_is_portable(cls, value: str) -> str:
        validate_device_name(value)
        return value

    @field_validator("daemons")
    @classmethod
    def _daemons_are_known(cls, value: list[str]) -> list[str]:
        unknown = sorted(set(value) - KNOWN_DAEMONS)
        if unknown:
            raise ValueError(
                f"Unknown FRR daemon(s): {', '.join(unknown)}. "
                f"Known: {', '.join(sorted(KNOWN_DAEMONS))}"
            )
        return value

    @model_validator(mode="after")
    def _interface_numbers_are_unique(self) -> Node:
        numbers = [iface.number for iface in self.interfaces]
        duplicates = sorted({n for n in numbers if numbers.count(n) > 1})
        if duplicates:
            raise ValueError(
                f"Device {self.name!r} has more than one interface numbered "
                f"{', '.join(f'eth{n}' for n in duplicates)}."
            )
        return self

    @property
    def effective_image(self) -> str:
        return self.image or DEFAULT_IMAGES[self.kind]

    def next_interface_number(self) -> int:
        """Lowest unused interface index, so numbering stays gap-free."""
        used = {iface.number for iface in self.interfaces}
        candidate = 0
        while candidate in used:
            candidate += 1
        return candidate

    def interface(self, number: int) -> Interface | None:
        return next((i for i in self.interfaces if i.number == number), None)

    def compacted(self) -> tuple[Node, list[tuple[int, int]]]:
        """This device with its interfaces renumbered 0, 1, 2… in order.

        Kathará refuses a device whose interfaces have a gap — eth1 with no
        eth0 fails the whole deploy with ``NonSequentialMachineInterfaceError``
        — and a gap is what removing a link leaves behind. Each interface keeps
        its domain and address; only its number moves down. Returns the
        renumbered device and every ``(old, new)`` pair that changed.
        """
        ordered = sorted(self.interfaces, key=lambda i: i.number)
        moves = [(iface.number, new) for new, iface in enumerate(ordered) if iface.number != new]
        if not moves:
            return self, []
        interfaces = [
            iface.model_copy(update={"number": new}) for new, iface in enumerate(ordered)
        ]
        return self.model_copy(update={"interfaces": interfaces}), moves


class CollisionDomain(BaseModel):
    """A shared medium. In Kathara this is the link itself, not a device."""

    name: str
    subnet: str | None = Field(default=None, description="Planned subnet, e.g. 10.0.0.0/24")

    @field_validator("subnet")
    @classmethod
    def _subnet_is_a_network(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            ipaddress.ip_network(value, strict=True)
        except ValueError as exc:
            raise ValueError(
                f"{value!r} is not a valid network. A subnet must have no host bits set "
                f"(use 10.0.0.0/24 rather than 10.0.0.1/24): {exc}"
            ) from exc
        return value


class Topology(BaseModel):
    """A complete network scenario."""

    name: str = "lab"
    description: str | None = None
    version: str | None = None
    author: str | None = None
    email: str | None = None
    web: str | None = None
    nodes: list[Node] = Field(default_factory=list)
    collision_domains: list[CollisionDomain] = Field(default_factory=list)

    @model_validator(mode="after")
    def _names_are_portable_together(self) -> Topology:
        names = [node.name for node in self.nodes]
        exact = sorted({n for n in names if names.count(n) > 1})
        if exact:
            raise ValueError(f"Duplicate device name(s): {', '.join(exact)}")
        # Catches R1/r1, which is two devices on Linux but one on macOS.
        check_unique_names(names)
        return self

    # -- lookups -------------------------------------------------------

    def node(self, name: str) -> Node | None:
        return next((n for n in self.nodes if n.name == name), None)

    def collision_domain(self, name: str) -> CollisionDomain | None:
        return next((cd for cd in self.collision_domains if cd.name == name), None)

    def referenced_collision_domains(self) -> list[str]:
        """Every collision domain actually attached to something, in first-seen order."""
        seen: list[str] = []
        for node in self.nodes:
            for iface in sorted(node.interfaces, key=lambda i: i.number):
                if iface.collision_domain not in seen:
                    seen.append(iface.collision_domain)
        return seen

    def members(self, collision_domain: str) -> list[tuple[Node, Interface]]:
        """Every (node, interface) pair attached to ``collision_domain``."""
        return [
            (node, iface)
            for node in self.nodes
            for iface in sorted(node.interfaces, key=lambda i: i.number)
            if iface.collision_domain == collision_domain
        ]

    def compacted(self) -> tuple[Topology, list[str]]:
        """This topology with every device's interfaces numbered without gaps.

        Returns the result and one sentence per renumbered interface, so a
        caller that opened a lab from disk can say what moved.
        """
        nodes: list[Node] = []
        notes: list[str] = []
        for node in self.nodes:
            fixed, moves = node.compacted()
            nodes.append(fixed)
            notes.extend(
                f"{node.name} eth{old} is now eth{new}: Kathará needs interfaces "
                "numbered from eth0 without gaps."
                for old, new in moves
            )
        if not notes:
            return self, []
        return self.model_copy(update={"nodes": nodes}), notes

    # -- mutation ------------------------------------------------------

    def connect(
        self, node_name: str, collision_domain: str, *, number: int | None = None
    ) -> Interface:
        """Attach a device to a collision domain and return the new interface."""
        node = self.node(node_name)
        if node is None:
            raise KeyError(f"No device named {node_name!r}")

        iface = Interface(
            number=node.next_interface_number() if number is None else number,
            collision_domain=collision_domain,
        )
        node.interfaces.append(iface)
        if self.collision_domain(collision_domain) is None:
            self.collision_domains.append(CollisionDomain(name=collision_domain))
        return iface
