"""The `.kgui` scenario package: one file holding a whole laboratory.

Capability 5 asks for a scenario to travel as a single artefact — a student
hibernating a half-finished lab, an exam submitted to an e-learning platform,
an instructor opening that submission and deploying it to mark it.

**A zip, not a bespoke container.** It can be inspected, repaired and unpacked
with tools everyone already has. A student who cannot open the application on
the morning of a deadline can still see what they submitted.

**The topology is authoritative; the lab directory travels with it anyway.**
`topology.json` is what the editor reads back, so opening a package can never
depend on parsing generated files. But the generated `lab/` tree is included
too, for two reasons: it makes the package usable by someone who has Kathará
and not this application — unzip and `kathara lstart` — and it carries the
configuration captured from running containers, which the model has no way to
express. Regenerating the lab on save leaves those captured files untouched,
because :func:`write_lab` only overwrites what it generates.

Layout::

    kgui.json        format version, application version, feature toggles
    topology.json    the model, including canvas positions
    lab/             the generated Kathará lab, plus any captured state
      lab.conf
      r1.startup
      r1/etc/frr/frr.conf
"""

from __future__ import annotations

import datetime as dt
import json
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from kathara_gui import __version__
from kathara_gui.domain.model import Topology
from kathara_gui.features import Features
from kathara_gui.project.labdir import write_lab

__all__ = [
    "FORMAT_VERSION",
    "SUFFIX",
    "Package",
    "PackageError",
    "write_package",
    "read_package",
    "extract_lab",
]

FORMAT_VERSION = 1
SUFFIX = ".kgui"

MANIFEST_NAME = "kgui.json"
TOPOLOGY_NAME = "topology.json"
LAB_ROOT = "lab"

#: Fixed so that saving an unchanged scenario produces an identical file.
#: Zip records a timestamp per member, which would otherwise make every save
#: differ and every package impossible to compare. 1980 is the zip epoch.
_FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


class PackageError(Exception):
    """The file is not a usable scenario package."""


@dataclass
class Package:
    """What a package contains, once read."""

    topology: Topology
    features: Features
    format: int
    application: str
    created: str | None = None


def _manifest(features: Features) -> str:
    return json.dumps(
        {
            "format": FORMAT_VERSION,
            "application": __version__,
            "created": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "features": features.model_dump(),
        },
        indent=2,
    )


def _add(archive: zipfile.ZipFile, name: str, text: str) -> None:
    """Write a text member with a fixed timestamp."""
    info = zipfile.ZipInfo(name, date_time=_FIXED_TIMESTAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    # Regular file, readable by everyone.
    info.external_attr = 0o644 << 16
    archive.writestr(info, text)


def write_package(
    topology: Topology,
    destination: Path,
    *,
    features: Features | None = None,
    lab_dir: Path | None = None,
) -> Path:
    """Write ``topology`` to ``destination`` as a `.kgui` package.

    ``lab_dir`` supplies the generated lab and anything captured alongside it,
    such as configuration pulled from running containers. Without it a fresh
    lab is generated into the package, so a scenario that has never been
    deployed still produces a complete, runnable file.
    """
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    source = Path(lab_dir) if lab_dir else None
    if source is None or not source.is_dir():
        # Generate into a scratch directory beside the destination rather than
        # a temporary one, so a failure leaves something inspectable.
        source = destination.parent / f".{destination.stem}-lab"
        write_lab(topology, source)

    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        _add(archive, MANIFEST_NAME, _manifest(features or Features()))
        _add(archive, TOPOLOGY_NAME, topology.model_dump_json(indent=2))

        for path in sorted(p for p in source.rglob("*") if p.is_file()):
            relative = path.relative_to(source).as_posix()
            _add(archive, f"{LAB_ROOT}/{relative}", path.read_text(encoding="utf-8"))

    return destination


def read_package(source: Path) -> Package:
    """Read the topology and settings out of a package.

    Touches nothing on disk beyond reading the file, so a package can be
    inspected — by a marker deciding whether to open it, say — without
    unpacking anything.
    """
    source = Path(source)
    try:
        with zipfile.ZipFile(source) as archive:
            names = set(archive.namelist())
            if TOPOLOGY_NAME not in names:
                raise PackageError(
                    f"{source.name} is not a Kathara GUI scenario: it has no {TOPOLOGY_NAME}."
                )

            topology = Topology.model_validate_json(archive.read(TOPOLOGY_NAME))
            manifest = json.loads(archive.read(MANIFEST_NAME)) if MANIFEST_NAME in names else {}
    except zipfile.BadZipFile as exc:
        raise PackageError(f"{source.name} is not a readable archive: {exc}") from exc
    except FileNotFoundError as exc:
        raise PackageError(f"{source} does not exist.") from exc
    except ValueError as exc:
        # Malformed JSON, or a topology this version cannot represent.
        raise PackageError(
            f"{source.name} contains a scenario that could not be read: {exc}"
        ) from exc

    stored_format = manifest.get("format", FORMAT_VERSION)
    if isinstance(stored_format, int) and stored_format > FORMAT_VERSION:
        raise PackageError(
            f"{source.name} was written by a newer version of Kathara GUI "
            f"(format {stored_format}, this version reads {FORMAT_VERSION}). Update to open it."
        )

    return Package(
        topology=topology,
        features=Features(**manifest.get("features", {})),
        format=stored_format if isinstance(stored_format, int) else FORMAT_VERSION,
        application=str(manifest.get("application", "unknown")),
        created=manifest.get("created"),
    )


def _safe_member(name: str) -> PurePosixPath | None:
    """The path a lab member should be written to, or None to refuse it.

    A package may arrive from anyone — an exam submission opened by an
    instructor is the expected case — so an archive naming `../../.ssh/id_rsa`
    or an absolute path must not be able to write outside the destination.
    """
    if not name.startswith(f"{LAB_ROOT}/") or name.endswith("/"):
        return None

    relative = PurePosixPath(name[len(LAB_ROOT) + 1 :])
    if relative.is_absolute() or any(part in ("..", "") for part in relative.parts):
        return None
    return relative


def extract_lab(source: Path, destination: Path) -> Path:
    """Write the package's lab directory into ``destination``.

    Members that try to escape the destination are skipped rather than
    honoured.
    """
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(source) as archive:
            for name in archive.namelist():
                relative = _safe_member(name)
                if relative is None:
                    continue
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
    except zipfile.BadZipFile as exc:
        raise PackageError(f"{Path(source).name} is not a readable archive: {exc}") from exc

    return destination
