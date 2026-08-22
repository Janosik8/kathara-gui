"""Translation between :class:`Topology` and Kathara's ``lab.conf`` format.

``lab.conf`` records which device sits on which collision domain and little
else. It has nowhere to put canvas coordinates, device kinds, addressing plans
or routing daemons — yet losing those on every save is precisely the tedium
this project exists to remove.

The format does support ``#`` comments, and Kathara ignores them. So the extra
state travels in a small, greppable comment block::

    # kgui:v1
    # kgui:node r1 pos=120,340 kind=router daemons=zebra,ospfd
    # kgui:cd A subnet=10.0.0.0/24
    # kgui:iface r1:0 ip=10.0.0.1/24

    r1[0]="A"

The result is an ordinary Kathara lab that `kathara lstart` runs unmodified,
which also reopens in this tool with its layout intact — and no sidecar file to
lose when someone shares the directory.

Options this model does not interpret are preserved verbatim, so importing a
hand-written lab and exporting it again is non-destructive.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from kathara_gui.domain.model import (
    CollisionDomain,
    Interface,
    Node,
    Position,
    Topology,
)

MARKER = "kgui"
FORMAT_VERSION = 1

# device[key]=value  — key is an interface number or an option name.
_ASSIGNMENT = re.compile(
    r"^(?P<device>[^\s\[\]]+)\s*\[\s*(?P<key>[^\]]+?)\s*\]\s*=\s*(?P<value>.*)$"
)
# LAB_NAME=value and friends.
_LAB_META = re.compile(r"^(?P<key>LAB_[A-Z_]+)\s*=\s*(?P<value>.*)$")
# # kgui:<record> <subject> k=v k=v
_KGUI = re.compile(rf"^#\s*{MARKER}:(?P<record>\w+)\s*(?P<rest>.*)$", re.IGNORECASE)

_LAB_META_FIELDS = {
    "LAB_NAME": "name",
    "LAB_DESCRIPTION": "description",
    "LAB_VERSION": "version",
    "LAB_AUTHOR": "author",
    "LAB_EMAIL": "email",
    "LAB_WEB": "web",
}
_FIELD_TO_LAB_META = {v: k for k, v in _LAB_META_FIELDS.items()}

# lab.conf options mapped onto typed model fields; anything else is passed through.
_MODELLED_OPTIONS = {"image", "mem", "cpus", "bridged"}


@dataclass
class ParseResult:
    """A parsed topology plus anything that looked wrong along the way.

    Import must be forgiving: a legacy lab written by hand may contain lines
    this parser does not recognise, and refusing the whole file would be
    useless to someone trying to migrate. Problems are reported, not fatal.
    """

    topology: Topology
    warnings: list[str] = field(default_factory=list)


def _unquote(value: str) -> str:
    """Strip an inline comment and surrounding quotes from a lab.conf value."""
    value = value.strip()
    if value[:1] in {'"', "'"}:
        quote = value[0]
        end = value.find(quote, 1)
        if end != -1:
            return value[1:end]
        return value[1:]
    # Unquoted values run to an unescaped '#' or end of line.
    return value.split("#", 1)[0].strip()


def _quote(value: str) -> str:
    return '"' + value.replace('"', '\\"') + '"'


def _parse_kv(rest: str) -> dict[str, str]:
    return dict(
        part.split("=", 1) for part in rest.split() if "=" in part  # noqa: B905 - pairs only
    )


# ---------------------------------------------------------------- parsing


def parse(text: str) -> ParseResult:
    """Read ``lab.conf`` text into a :class:`Topology`."""
    warnings: list[str] = []
    meta: dict[str, str] = {}
    # Device order follows first appearance, which keeps output stable.
    devices: dict[str, dict] = {}
    kgui_nodes: dict[str, dict[str, str]] = {}
    kgui_ifaces: dict[str, dict[str, str]] = {}
    kgui_cds: dict[str, dict[str, str]] = {}

    def device(name: str) -> dict:
        return devices.setdefault(name, {"interfaces": {}, "options": {}})

    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue

        if line.startswith("#"):
            match = _KGUI.match(line)
            if not match:
                continue  # an ordinary comment
            record = match.group("record").lower()
            rest = match.group("rest").strip()
            if record == "v1":
                continue
            subject, _, kv = rest.partition(" ")
            if record == "node":
                kgui_nodes[subject] = _parse_kv(kv)
            elif record == "iface":
                kgui_ifaces[subject] = _parse_kv(kv)
            elif record == "cd":
                kgui_cds[subject] = _parse_kv(kv)
            continue

        lab_match = _LAB_META.match(line)
        if lab_match:
            key = lab_match.group("key")
            if key in _LAB_META_FIELDS:
                meta[_LAB_META_FIELDS[key]] = _unquote(lab_match.group("value"))
            else:
                warnings.append(f"Line {lineno}: unrecognised lab metadata {key!r}, ignored.")
            continue

        assignment = _ASSIGNMENT.match(line)
        if not assignment:
            warnings.append(f"Line {lineno}: could not understand {raw.strip()!r}, ignored.")
            continue

        name = assignment.group("device")
        key = assignment.group("key")
        value = _unquote(assignment.group("value"))

        if key.isdigit():
            # An interface: value is "collision_domain" or "collision_domain/MAC".
            cd, _, mac = value.partition("/")
            if not cd:
                warnings.append(f"Line {lineno}: {name}[{key}] has no collision domain, ignored.")
                continue
            device(name)["interfaces"][int(key)] = (cd, mac or None)
        else:
            device(name)["options"][key.lower()] = value

    # -- assemble ------------------------------------------------------

    nodes: list[Node] = []
    for name, data in devices.items():
        hints = kgui_nodes.get(name, {})
        options = dict(data["options"])

        interfaces = []
        for number in sorted(data["interfaces"]):
            cd, mac = data["interfaces"][number]
            iface_hints = kgui_ifaces.get(f"{name}:{number}", {})
            interfaces.append(
                Interface(
                    number=number,
                    collision_domain=cd,
                    mac_address=mac,
                    ip=iface_hints.get("ip"),
                )
            )

        cpus = None
        if "cpus" in options:
            try:
                cpus = float(options["cpus"])
            except ValueError:
                warnings.append(f"Device {name!r}: cpus={options['cpus']!r} is not a number.")

        position = Position()
        if "pos" in hints:
            try:
                x_text, _, y_text = hints["pos"].partition(",")
                position = Position(x=float(x_text), y=float(y_text))
            except ValueError:
                warnings.append(f"Device {name!r}: could not read position {hints['pos']!r}.")

        daemons = [d for d in hints.get("daemons", "").split(",") if d]
        kind = hints.get("kind", "router")

        try:
            nodes.append(
                Node(
                    name=name,
                    kind=kind,  # type: ignore[arg-type]
                    image=options.get("image"),
                    memory=options.get("mem"),
                    cpus=cpus,
                    bridged=options.get("bridged", "").lower() in {"true", "1", "yes"},
                    position=position,
                    interfaces=interfaces,
                    daemons=daemons,
                    extra_options={
                        k: v for k, v in options.items() if k not in _MODELLED_OPTIONS
                    },
                )
            )
        except ValueError as exc:
            warnings.append(f"Device {name!r} skipped: {exc}")

    topology = Topology(**meta, nodes=nodes)

    # Register every collision domain in use, carrying any planned subnet.
    for cd_name in topology.referenced_collision_domains():
        topology.collision_domains.append(
            CollisionDomain(name=cd_name, subnet=kgui_cds.get(cd_name, {}).get("subnet"))
        )

    return ParseResult(topology=topology, warnings=warnings)


# ------------------------------------------------------------ serializing


def serialize(topology: Topology) -> str:
    """Render a :class:`Topology` as ``lab.conf`` text.

    Output is deterministic so that saving an unchanged lab produces an
    unchanged file — which keeps diffs meaningful under version control.
    Uses ``\\n`` throughout; write it with
    :func:`kathara_gui.fsutil.write_text_lf`.
    """
    lines: list[str] = []

    for attr, key in ((v, k) for k, v in _LAB_META_FIELDS.items()):
        value = getattr(topology, attr, None)
        if value:
            lines.append(f"{key}={_quote(str(value))}")
    if lines:
        lines.append("")

    metadata = _render_kgui_block(topology)
    if metadata:
        lines.extend(metadata)
        lines.append("")

    for node in topology.nodes:
        for iface in sorted(node.interfaces, key=lambda i: i.number):
            target = iface.collision_domain
            if iface.mac_address:
                target = f"{target}/{iface.mac_address}"
            lines.append(f"{node.name}[{iface.number}]={_quote(target)}")

        if node.image:
            lines.append(f"{node.name}[image]={_quote(node.image)}")
        if node.memory:
            lines.append(f"{node.name}[mem]={_quote(node.memory)}")
        if node.cpus is not None:
            lines.append(f"{node.name}[cpus]={_quote(_format_number(node.cpus))}")
        if node.bridged:
            lines.append(f"{node.name}[bridged]={_quote('true')}")
        for key in sorted(node.extra_options):
            lines.append(f"{node.name}[{key}]={_quote(node.extra_options[key])}")

        lines.append("")

    return "\n".join(lines).rstrip("\n") + "\n"


def _format_number(value: float) -> str:
    """Render 2.0 as '2' but keep 1.5 intact, so round trips stay stable."""
    return str(int(value)) if value == int(value) else str(value)


def _render_kgui_block(topology: Topology) -> list[str]:
    """Emit only the state Kathara cannot express, and only when it exists."""
    records: list[str] = []

    for node in topology.nodes:
        parts = [f"pos={_format_number(node.position.x)},{_format_number(node.position.y)}"]
        if node.kind != "router":
            parts.append(f"kind={node.kind}")
        if node.daemons:
            parts.append(f"daemons={','.join(node.daemons)}")
        # Position always travels; it is the reason this block exists.
        records.append(f"# {MARKER}:node {node.name} {' '.join(parts)}")

    for cd in topology.collision_domains:
        if cd.subnet:
            records.append(f"# {MARKER}:cd {cd.name} subnet={cd.subnet}")

    for node in topology.nodes:
        for iface in sorted(node.interfaces, key=lambda i: i.number):
            if iface.ip:
                records.append(f"# {MARKER}:iface {node.name}:{iface.number} ip={iface.ip}")

    if not records:
        return []
    return [f"# {MARKER}:v{FORMAT_VERSION}", *records]
