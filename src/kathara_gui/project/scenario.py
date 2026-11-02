"""The scenario folder as the document.

A scenario *is* a Kathará lab directory::

    untitled/
      lab.conf                 topology, layout, metadata
      kgui.json                feature toggles and a format version
      r1.startup               addressing
      r1/etc/frr/frr.conf      configuration captured from the running router

Nothing here is a container format. `lab.conf` already round-trips the whole
model — positions and device kinds ride in ``# kgui:`` comments that Kathará
ignores — so a separate ``topology.json`` would be a *second* source of truth
that could disagree with it. It did: a package's stored topology silently won
over an edited `lab.conf` inside the same archive. Deleting that duplication is
the point of this module.

**Export is a plain zip of the folder**, so anyone can unzip it and read the
startup scripts and FRR configs with no special tool, and anyone with Kathará
can ``kathara lstart`` it. **Import accepts a scenario written by someone
else**, which will have no ``kgui.json`` and no ``# kgui:`` comments: those are
optional everywhere, and their absence just means default settings and no saved
layout.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from kathara_gui import __version__
from kathara_gui.domain.addressing import infer_subnets
from kathara_gui.domain.clusters import clustered_layout, routing_groups
from kathara_gui.domain.codec.labconf import parse
from kathara_gui.domain.codec.startup import parse_loopbacks, parse_startup
from kathara_gui.domain.layout import arrange, needs_layout
from kathara_gui.domain.model import (
    KNOWN_DAEMONS,
    CollisionDomain,
    Node,
    Position,
    Topology,
    Zone,
)
from kathara_gui.features import Features
from kathara_gui.fsutil import write_text_lf
from kathara_gui.project.examlock import ExamLock
from kathara_gui.project.labdir import write_lab

__all__ = [
    "FORMAT_VERSION",
    "SETTINGS_NAME",
    "LAB_CONF",
    "Scenario",
    "ScenarioError",
    "save",
    "write_settings",
    "load",
    "recover_device_configuration",
    "export_zip",
    "import_archive",
    "import_archive_bytes",
    "is_scenario",
    "set_lab_name",
]

FORMAT_VERSION = 1
SETTINGS_NAME = "kgui.json"
LAB_CONF = "lab.conf"

#: Fixed so an unchanged scenario exports to identical bytes rather than a new
#: version every time it is sent.
_FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)

#: An archive is held in memory while it is checked, so it needs a ceiling.
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024


class ScenarioError(Exception):
    """The folder or archive is not a usable scenario."""


@dataclass
class Scenario:
    """A scenario read from a folder."""

    topology: Topology
    features: Features
    folder: Path
    #: Lines of ``lab.conf`` that could not be understood. Import is forgiving,
    #: so these are reported rather than silently dropped.
    warnings: list[str] = field(default_factory=list)
    #: True when the folder carried no ``kgui.json`` — someone else's lab.
    foreign: bool = False
    #: The exam author's lock on ``features``, if the scenario has one (note 1).
    exam_lock: ExamLock | None = None


#: Naming conventions common in published Kathará and Netkit labs. Only used
#: where there is no stronger evidence, and only for prefixes that are not
#: ambiguous — "s1" could be a switch or a server, so "s" is not here.
_KIND_BY_PREFIX: tuple[tuple[tuple[str, ...], str], ...] = (
    (("pc", "host", "client", "ws"), "pc"),
    (("server", "srv"), "server"),
    (("switch", "sw", "bridge"), "switch"),
)


def _infer_kind(name: str) -> str | None:
    """Guess a device's kind from its name, or None to leave it alone.

    Kathará's format records no device kind, so an imported lab would otherwise
    show every host as a router. This is a presentational guess and nothing
    more: it picks the icon and the default image, both of which the user can
    change in the inspector, and it never overrides evidence from FRR.
    """
    lowered = name.lower()
    for prefixes, kind in _KIND_BY_PREFIX:
        for prefix in prefixes:
            rest = lowered.removeprefix(prefix)
            if rest != lowered and (not rest or rest.isdigit()):
                return kind
    return None


def _read(path: Path) -> str | None:
    """File contents, or None if it is absent or not text we can use."""
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _daemons_from_file(text: str) -> list[str]:
    """Daemons enabled in an FRR ``daemons`` file."""
    enabled = []
    for line in text.splitlines():
        statement = line.split("#", 1)[0].strip()
        if "=" not in statement:
            continue
        name, _, value = statement.partition("=")
        if name.strip() in KNOWN_DAEMONS and value.strip().lower() in ("yes", "1", "true"):
            enabled.append(name.strip())
    return enabled


#: Where a router's BGP and OSPF configuration may be, in labs from FRR or Quagga days.
_ROUTING_FILES = (
    ("etc", "frr", "frr.conf"),
    ("etc", "frr", "bgpd.conf"),
    ("etc", "frr", "ospfd.conf"),
    ("etc", "quagga", "bgpd.conf"),
    ("etc", "quagga", "ospfd.conf"),
)


def read_routing_configs(topology: Topology, folder: Path) -> dict[str, str]:
    """Each device's routing configuration, every file of it there is, by name."""
    configs: dict[str, str] = {}
    for node in topology.nodes:
        texts = [
            text for parts in _ROUTING_FILES if (text := _read(folder.joinpath(node.name, *parts)))
        ]
        if texts:
            configs[node.name] = "\n".join(texts)
    return configs


def _arrange_by_routing(
    topology: Topology, folder: Path
) -> tuple[dict[str, Position], list[Zone]]:
    """A layout for a lab that has none, each AS and OSPF area in its own zone (9B.2)."""
    groups = routing_groups(topology, read_routing_configs(topology, folder))
    if not groups:
        # One AS or area, or none, is a lab with nothing to separate.
        return arrange(topology), []
    return clustered_layout(topology, groups)


def recover_device_configuration(topology: Topology, folder: Path) -> Topology:
    """Fill in what ``lab.conf`` cannot express, from the files beside it.

    A Kathará lab keeps its addressing in ``<device>.startup`` and its routing
    daemons in ``<device>/etc/frr/daemons``. Reading only ``lab.conf`` therefore
    produces a topology the addressing validator reports as unaddressed, even
    though the addresses were on disk all along — the reported complaint that
    "the configuration is lost" on import.

    Only ever *fills in*: a value already in the model, having come from our own
    ``# kgui:`` comments, is more precise than one inferred from a script and is
    left alone.
    """
    folder = Path(folder)
    nodes: list[Node] = []

    # Our own labs record the kind in a `# kgui:` comment, so guessing from
    # names would only ever contradict something we already know exactly.
    lab_conf = _read(folder / LAB_CONF) or ""
    explicit_kinds = "kgui:node" in lab_conf

    for node in topology.nodes:
        changes: dict[str, object] = {}

        startup = _read(folder / f"{node.name}.startup")
        if startup and not node.loopbacks:
            loopbacks = parse_loopbacks(startup)
            if loopbacks:
                changes["loopbacks"] = loopbacks
        if startup:
            addresses = parse_startup(startup)
            if addresses:
                changes["interfaces"] = [
                    iface
                    if iface.ip
                    else iface.model_copy(update={"ip": addresses.get(iface.number)})
                    for iface in node.interfaces
                ]

        daemons_file = _read(folder / node.name / "etc" / "frr" / "daemons")
        found = _daemons_from_file(daemons_file) if daemons_file else []
        if found and not node.daemons:
            changes["daemons"] = found

        has_frr = bool(found) or (folder / node.name / "etc" / "frr" / "frr.conf").is_file()
        if has_frr:
            # Running routing daemons is proof, and outranks any guess.
            changes["kind"] = "router"
        elif not explicit_kinds:
            guessed = _infer_kind(node.name)
            if guessed:
                changes["kind"] = guessed

        nodes.append(node.model_copy(update=changes) if changes else node)

    topology = topology.model_copy(update={"nodes": nodes})

    # Kathará records the wiring but not the plan, so a domain arrives named
    # and subnet-less even though its members' addresses say exactly what it
    # is. Without this the panel and the diagram show a bare letter where they
    # should show a network.
    inferred = infer_subnets(topology)
    if inferred:
        existing = {cd.name: cd for cd in topology.collision_domains}
        domains = [
            cd.model_copy(update={"subnet": inferred[cd.name]})
            if cd.subnet is None and cd.name in inferred
            else cd
            for cd in topology.collision_domains
        ]
        # A domain the codec did not list at all still deserves its subnet.
        domains.extend(
            CollisionDomain(name=name, subnet=subnet)
            for name, subnet in sorted(inferred.items())
            if name not in existing
        )
        topology = topology.model_copy(update={"collision_domains": domains})

    return topology


def is_scenario(folder: Path) -> bool:
    """Whether ``folder`` looks like a Kathará lab we can open."""
    return (Path(folder) / LAB_CONF).is_file()


def _settings(features: Features, exam_lock: ExamLock | None = None) -> str:
    """The scenario's settings file.

    Deliberately carries no timestamp. One was here, and it quietly defeated
    the property the fixed zip timestamps exist to provide: exporting an
    unchanged scenario twice produced different bytes whenever the clock ticked
    between the two, so the test asserting reproducibility failed roughly at
    random. The filesystem records when a file was written; a scenario does not
    need to disagree with it.
    """
    settings: dict[str, object] = {
        "format": FORMAT_VERSION,
        "application": __version__,
        "features": features.model_dump(),
    }
    if exam_lock is not None:
        settings["exam_lock"] = exam_lock.model_dump()
    return json.dumps(settings, indent=2) + "\n"


def write_settings(folder: Path, features: Features, exam_lock: ExamLock | None = None) -> None:
    """Write only ``kgui.json``: the switches and their lock, not the design."""
    write_text_lf(Path(folder) / SETTINGS_NAME, _settings(features, exam_lock))


def save(
    topology: Topology,
    folder: Path,
    *,
    features: Features | None = None,
    exam_lock: ExamLock | None = None,
) -> Path:
    """Write ``topology`` into ``folder`` as a complete scenario.

    Generated files are refreshed and files belonging to departed devices are
    removed, but anything else — a captured ``frr.conf``, a manual, notes —
    is left where it is. See :func:`write_lab`.
    """
    folder = Path(folder)
    write_lab(topology, folder)
    write_settings(folder, features or Features(), exam_lock)
    return folder


def load(folder: Path) -> Scenario:
    """Read the scenario in ``folder``.

    ``kgui.json`` is optional: a lab written by hand or by another tool has
    none, and simply gets the default settings.
    """
    folder = Path(folder)
    lab_conf = folder / LAB_CONF
    if not lab_conf.is_file():
        raise ScenarioError(f"{folder.name} has no {LAB_CONF}, so it is not a Kathará lab.")

    try:
        result = parse(lab_conf.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise ScenarioError(f"{LAB_CONF} could not be read: {exc}") from exc

    settings_file = folder / SETTINGS_NAME
    features, foreign, exam_lock = Features(), True, None
    if settings_file.is_file():
        foreign = False
        try:
            stored = json.loads(settings_file.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise ScenarioError(f"{SETTINGS_NAME} is not readable JSON: {exc}") from exc

        version = stored.get("format", FORMAT_VERSION)
        if isinstance(version, int) and version > FORMAT_VERSION:
            raise ScenarioError(
                f"This scenario was written by a newer version of Kathara GUI "
                f"(format {version}, this version reads {FORMAT_VERSION}). Update to open it."
            )
        features = Features(**stored.get("features", {}))
        if stored.get("exam_lock") is not None:
            try:
                exam_lock = ExamLock(**stored["exam_lock"])
            except (TypeError, ValueError) as exc:
                # Damaged rather than missing: still evidence, so not ignored.
                raise ScenarioError(
                    f"The exam lock in {SETTINGS_NAME} is damaged, so the scenario cannot "
                    "be opened as it was locked."
                ) from exc

    # The folder's own name is the better title when lab.conf carries none:
    # Kathará's LAB_NAME is optional, and "lab" tells the user nothing.
    topology = result.topology
    if topology.name in ("", "lab"):
        topology = topology.model_copy(update={"name": folder.name})

    topology = recover_device_configuration(topology, folder)

    # After recovery, not before: the .startup files name interfaces by their
    # old numbers, so the addresses must be attached before the numbers move.
    # A gap here is a lab saved before removing a link renumbered the rest,
    # and Kathará would refuse to deploy it.
    topology, renumbered = topology.compacted()

    # A lab from elsewhere carries no coordinates, so every device would land
    # on the same spot and the diagram would be unreadable until dragged apart
    # by hand. Only ever applied when there is no layout to lose.
    if needs_layout(topology):
        positions, zones = _arrange_by_routing(topology, folder)
        topology = topology.model_copy(
            update={
                "nodes": [
                    node.model_copy(update={"position": positions[node.name]})
                    if node.name in positions
                    else node
                    for node in topology.nodes
                ],
                "zones": zones or topology.zones,
            }
        )

    return Scenario(
        topology=topology,
        features=features,
        folder=folder,
        warnings=[*result.warnings, *renumbered],
        foreign=foreign,
        exam_lock=exam_lock,
    )


#: ``LAB_NAME=...`` at the start of a line, as Kathará reads it.
_LAB_NAME_LINE = re.compile(r"^\s*LAB_NAME\s*=")


def set_lab_name(folder: Path, name: str) -> None:
    """Make ``LAB_NAME`` in ``folder``'s ``lab.conf`` say ``name``.

    A text edit of that one line, not a :func:`save`: an imported lab may hold
    lines the parser does not understand, and comments, and rewriting the whole
    file would drop them. Every other file, ``kgui.json`` included, is left as
    it was. A lab that names itself nowhere gets the line at the top.
    """
    lab_conf = Path(folder) / LAB_CONF
    line = 'LAB_NAME="' + name.replace('"', '\\"') + '"'
    lines = lab_conf.read_text(encoding="utf-8").splitlines()
    for index, existing in enumerate(lines):
        if _LAB_NAME_LINE.match(existing):
            lines[index] = line
            break
    else:
        lines.insert(0, line)
    write_text_lf(lab_conf, "\n".join(lines))


def export_zip(folder: Path, destination: Path) -> Path:
    """Zip ``folder`` into ``destination``, entries relative to the folder.

    No wrapper directory inside the archive: unzipping gives the scenario's
    files directly, which is what someone reaching for ``lab.conf`` expects.
    """
    folder, destination = Path(folder), Path(destination)
    if not folder.is_dir():
        raise ScenarioError(f"{folder} is not a folder.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(p for p in folder.rglob("*") if p.is_file()):
            info = zipfile.ZipInfo(
                path.relative_to(folder).as_posix(), date_time=_FIXED_TIMESTAMP
            )
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
    return destination


#: Archive entries that are an artefact of the tool that made the zip rather
#: than part of the scenario. macOS Finder is the reason this exists: it adds a
#: parallel ``__MACOSX`` tree of resource forks, which made a perfectly ordinary
#: right-click-Compress archive look like it had two root folders, so the
#: wrapper was not stripped and the import was rejected as "not a Kathará lab".
_JUNK_PREFIXES = ("__MACOSX/",)
_JUNK_NAMES = frozenset({".DS_Store", "Thumbs.db", "desktop.ini"})


def _is_junk(name: str) -> bool:
    if name.startswith(_JUNK_PREFIXES):
        return True
    base = name.rsplit("/", 1)[-1]
    # "._name" is a macOS resource fork; it is never scenario content.
    return base in _JUNK_NAMES or base.startswith("._")


def _safe_member(name: str) -> PurePosixPath | None:
    """Where an archive member may be written, or None to refuse it.

    An archive may come from anyone — a submitted exam opened by an instructor
    is the expected case — so a member naming ``../../.ssh/authorized_keys`` or
    an absolute path must not be honoured.
    """
    if not name or name.endswith("/"):
        return None
    relative = PurePosixPath(name)
    # An empty path, or one that is only separators, has no parts at all.
    if not relative.parts:
        return None
    if relative.is_absolute() or any(part in ("..", "") for part in relative.parts):
        return None
    # A Windows-style absolute path arrives as a single opaque segment.
    if ":" in relative.parts[0] or "\\" in name:
        return None
    return relative


def _strip_wrapper(names: list[str]) -> str:
    """The prefix to drop so members land at the scenario's root.

    Zipping a folder in Finder or Explorer nests everything under the folder's
    own name, and a legacy ``.kgui`` nested its lab under ``lab/``. Both are
    normal ways for an archive to arrive, so both are unwrapped rather than
    rejected — which is also what lets a scenario saved before the package
    format was dropped still open, without any code that knows about it.

    Junk is discounted before deciding, or Finder's ``__MACOSX`` tree counts as
    a second root and nothing is stripped at all.
    """
    real = [n for n in names if not _is_junk(n)]
    prefix = ""

    # Descends rather than peeling one layer, because a folder that was zipped
    # after being unzipped once is wrapped twice and looks identical to a user.
    while True:
        inner = [n[len(prefix) :] for n in real if n.startswith(prefix)]
        if LAB_CONF in [n for n in inner if "/" not in n]:
            return prefix

        roots = {n.split("/", 1)[0] for n in inner if "/" in n}
        if len(roots) != 1:
            return ""
        prefix = f"{prefix}{roots.pop()}/"
        if not any(n.startswith(prefix) for n in real):
            return ""


def import_archive_bytes(payload: bytes, destination: Path) -> Path:
    """Unpack a scenario archive held in memory, as an upload arrives."""
    return _unpack(io.BytesIO(payload), Path(destination), "the uploaded file")


def import_archive(source: Path, destination: Path) -> Path:
    """Unpack a scenario archive into ``destination`` and return it."""
    source = Path(source)
    if not source.is_file():
        raise ScenarioError(f"{source} does not exist.")
    return _unpack(source, Path(destination), source.name)


def _unpack(source: Any, destination: Path, label: str) -> Path:
    try:
        with zipfile.ZipFile(source) as archive:
            names = archive.namelist()
            prefix = _strip_wrapper(names)

            written = 0
            for name in names:
                if _is_junk(name):
                    continue
                if prefix and not name.startswith(prefix):
                    continue
                relative = _safe_member(name[len(prefix) :] if prefix else name)
                if relative is None:
                    continue
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
                written += 1
    except zipfile.BadZipFile as exc:
        raise ScenarioError(f"{label} is not a readable archive: {exc}") from exc

    if not written:
        raise ScenarioError(f"{label} contained no files that could be read.")
    if not is_scenario(destination):
        raise ScenarioError(f"{label} has no {LAB_CONF} in it, so it is not a Kathará lab.")
    return destination
