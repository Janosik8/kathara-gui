"""The user's interface preferences, kept in the workspace between launches.

Browser storage cannot hold them: the server takes a new port on every run,
and the browser keys storage by origin, so whatever a page stored is gone on
the next launch (F42). A small file in the workspace survives, and the
workspace is already the one place the application writes to.

Today it holds the side panels' layout (the tester's note 3): the order
of their sections and which are collapsed. The file is a dot-file, so the
scenario list, which skips dot-entries, never mistakes it for a lab.

A preference is a convenience, never a reason to fail. A missing, unreadable or
hand-mangled file gives the defaults; a section id this version does not know is
dropped, and one it does know but the file lacks is added in its default place,
so a section added later cannot be lost by an older file.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, ValidationError

from kathara_gui.fsutil import write_text_lf
from kathara_gui.project.session import Session, get_session

router = APIRouter(prefix="/api/preferences", tags=["preferences"])

FILE_NAME = ".kgui-preferences.json"

# The sections of each side panel, in their default order. The frontend names
# the same ids; an id outside these is dropped on the way in.
SECTIONS: dict[str, tuple[str, ...]] = {
    "left": ("palette", "connect", "domains", "zones", "texts", "topology"),
    "right": ("details", "addressing", "arrange", "scenario", "exam", "lab"),
}

# Sections that start collapsed, in a fresh layout and when they first appear
# in a stored one. The exam switches matter to an instructor, rarely to anyone
# else, so they wait behind their heading (FR-28).
COLLAPSED: dict[str, tuple[str, ...]] = {"left": (), "right": ("exam",)}


class PanelLayout(BaseModel):
    order: list[str] = Field(description="Section ids, top to bottom.")
    collapsed: list[str] = Field(default_factory=list, description="Section ids shown collapsed.")
    hidden: bool = Field(default=False, description="The whole panel hidden (note 6).")


class Panels(BaseModel):
    left: PanelLayout = Field(default_factory=lambda: _default("left"))
    right: PanelLayout = Field(default_factory=lambda: _default("right"))


class Preferences(BaseModel):
    panels: Panels = Field(default_factory=Panels)


def _default(side: str) -> PanelLayout:
    return PanelLayout(order=list(SECTIONS[side]), collapsed=list(COLLAPSED[side]))


def _clean(side: str, layout: PanelLayout) -> PanelLayout:
    """Known ids only, each once, every known id present."""
    known = SECTIONS[side]
    order = [s for i, s in enumerate(layout.order) if s in known and s not in layout.order[:i]]
    arrived = [s for s in known if s not in order]
    for index, section in enumerate(known):
        if section in order:
            continue
        # After the section that precedes it by default, so a new section
        # arrives where it was designed to sit rather than at the bottom.
        before = [s for s in known[:index] if s in order]
        order.insert(order.index(before[-1]) + 1 if before else 0, section)
    collapsed = [
        s for s in known if s in layout.collapsed or (s in arrived and s in COLLAPSED[side])
    ]
    return PanelLayout(order=order, collapsed=collapsed, hidden=layout.hidden)


def normalise(preferences: Preferences) -> Preferences:
    return Preferences(
        panels=Panels(
            left=_clean("left", preferences.panels.left),
            right=_clean("right", preferences.panels.right),
        )
    )


def load(session: Session) -> Preferences:
    path = session.workspace_root / FILE_NAME
    try:
        stored = Preferences.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, ValidationError):
        # json.JSONDecodeError and UnicodeDecodeError are both ValueErrors.
        return Preferences()
    return normalise(stored)


@router.get("", response_model=Preferences)
def get_preferences(session: Session = Depends(get_session)) -> Preferences:
    return load(session)


@router.put("", response_model=Preferences)
def put_preferences(
    preferences: Preferences, session: Session = Depends(get_session)
) -> Preferences:
    """Store the preferences, cleaned, and return what was stored."""
    cleaned = normalise(preferences)
    write_text_lf(
        session.workspace_root / FILE_NAME, json.dumps(cleaned.model_dump(), indent=2)
    )
    return cleaned
