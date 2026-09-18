"""Whether the layout survives zoom (ACC-05, WCAG 1.4.10 Reflow).

Zoom and a narrow window are the same thing to a stylesheet: at 200% on a
1280-pixel display the viewport is 640 CSS pixels. The three columns were fixed
at 340 and 300 pixels with ``flex-shrink: 0``, so the two panels consumed the
whole viewport, the canvas was pushed off-screen, and the page scrolled in two
directions — which is exactly what 1.4.10 forbids.

Like ``test_contrast.py``, this reads the real stylesheet. jsdom performs no
layout, so a rendered check is impossible here; what can be proved is that the
rules which caused the failure are gone and the rules that fix it are present.
A browser pass is still listed in the manual checks, and this is what keeps the
regression from returning between them.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

STYLES = Path(__file__).resolve().parents[1] / "frontend" / "src" / "styles.css"

#: WCAG 1.4.10 asks for usability down to 320 CSS pixels wide.
REFLOW_TARGET_PX = 320


def css() -> str:
    return STYLES.read_text(encoding="utf-8")


def _strip_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)


def _without_comments_and_media(text: str) -> str:
    """The stylesheet's top level: comments gone, media blocks gone.

    Media blocks are removed so a rule inside the narrow-screen override is not
    mistaken for the base rule it overrides — the narrow one legitimately sets
    `width: auto`, and reading that as the base would make the test pass while
    the defect stood.
    """
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)

    out, i = [], 0
    while i < len(text):
        if text.startswith("@media", i):
            depth, j = 0, text.index("{", i)
            while j < len(text):
                depth += (text[j] == "{") - (text[j] == "}")
                j += 1
                if depth == 0:
                    break
            i = j
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def rule(selector: str) -> str:
    """The body of the base rule for ``selector``."""
    stripped = _without_comments_and_media(css())

    for block in re.finditer(r"([^{}]+)\{([^{}]*)\}", stripped):
        selectors = [s.strip() for s in block.group(1).split(",")]
        if selector in selectors:
            return block.group(2)
    raise AssertionError(f"no base rule for {selector}")


def at_rule_bodies(prefix: str) -> str:
    """Every ``@media``/``@container`` block whose query starts with ``prefix``.

    Concatenated rather than sliced by index: there is more than one
    narrow-screen block, and taking "the first one" quietly tested the wrong
    rules — which is how this helper came to exist.
    """
    text = _strip_comments(css())
    found: list[str] = []
    for match in re.finditer(re.escape(prefix), text):
        start = text.index("{", match.start())
        depth, i = 0, start
        while i < len(text):
            depth += (text[i] == "{") - (text[i] == "}")
            i += 1
            if depth == 0:
                break
        found.append(text[start:i])
    assert found, f"no block matching {prefix!r}"
    return "\n".join(found)


def declaration(selector: str, prop: str) -> str | None:
    match = re.search(rf"\b{re.escape(prop)}\s*:\s*([^;]+);", rule(selector))
    return match.group(1).strip() if match else None


# -- the defect ---------------------------------------------------------


@pytest.mark.parametrize("selector", [".panel", ".panel--right"])
def test_a_panel_is_not_a_fixed_pixel_width(selector: str) -> None:
    """The rule that broke it. A panel fixed in pixels cannot give ground when
    the viewport shrinks, so something else has to disappear."""
    width = declaration(selector, "width")
    assert width is not None, f"{selector} sets no width"
    assert not width.endswith("px"), f"{selector} is fixed at {width}"


def test_the_panels_can_give_ground() -> None:
    """`flex-shrink: 0` was the other half: even in rem they would not yield."""
    assert declaration(".panel", "flex-shrink") != "0"


def _rem(value: str | None) -> float:
    assert value is not None and value.endswith("rem"), f"expected rem, got {value}"
    return float(value.removesuffix("rem")) * 16  # at the 16px default root


def test_a_stacked_panel_fits_the_reflow_target() -> None:
    """Once stacked, a panel is full width — but its floor still has to fit.

    A `min-width` wider than 320px would reintroduce the sideways scrollbar the
    stacking was meant to remove.
    """
    assert _rem(declaration(".panel", "min-width")) <= REFLOW_TARGET_PX


def test_the_columns_only_stay_side_by_side_while_all_three_fit() -> None:
    """The breakpoint has to be wider than the two panels' floors, or there is
    a range where the columns are kept and the canvas has nowhere to go."""
    breakpoint_px = _rem(
        re.search(r"@media \(max-width: (\d+rem)\)", css()).group(1)  # type: ignore[union-attr]
    )
    panels_at_their_floor = _rem(declaration(".panel", "min-width")) * 2

    assert breakpoint_px > panels_at_their_floor, (
        f"columns persist down to {breakpoint_px:.0f}px where the panels alone "
        f"need {panels_at_their_floor:.0f}px"
    )
    # And something worth calling a canvas is left at the narrowest column view.
    assert breakpoint_px - panels_at_their_floor >= REFLOW_TARGET_PX


# -- the fix ------------------------------------------------------------


def test_the_layout_stacks_when_it_is_too_narrow_for_columns() -> None:
    assert "@media (max-width: 60rem)" in css(), "no reflow breakpoint"


def test_stacking_puts_the_columns_into_one() -> None:
    assert "flex-direction: column" in at_rule_bodies("@media (max-width: 60rem)")


def test_the_canvas_keeps_a_height_when_stacked() -> None:
    """A diagram collapsed to nothing is a loss of function, not a reflow."""
    assert "min-height" in at_rule_bodies("@media (max-width: 60rem)")


def test_the_breakpoint_is_in_rem_so_it_follows_the_user_font_size() -> None:
    """A user who enlarges text, rather than zooming, must reflow too — and a
    breakpoint in pixels would ignore them entirely."""
    assert re.search(r"@media \(max-width: \d+rem\)", css())


# -- the overview must not swallow the thing it overviews ---------------


def test_the_minimap_is_sized_against_the_canvas_not_fixed() -> None:
    """React Flow ships a fixed 200x150 minimap. On a small canvas that covered
    most of the diagram it exists to help navigate — the reported defect."""
    body = rule(".react-flow__minimap")
    assert "%" in body, "the minimap is not proportional to the canvas"
    assert "max-width" in body and "max-height" in body, "no cap on the minimap"


def test_the_minimap_gives_up_when_there_is_no_room() -> None:
    """Below a point an overview and the thing it overviews cannot share the
    space. The canvas is the work, so the aid is what goes."""
    assert "@container canvas" in css(), "no container query on the canvas"
    assert "display: none" in at_rule_bodies("@container canvas")


def test_the_canvas_is_a_named_container() -> None:
    """Without this the container query silently matches nothing, and the
    minimap would never hide."""
    assert "container: canvas" in rule(".app__canvas")


def test_the_minimap_asks_about_the_canvas_not_the_window() -> None:
    """A media query would measure the window, which is the wrong question:
    with two panels open a wide window can still leave a narrow canvas."""
    text = css()
    query = text[text.index("@container canvas") :].split("{", 1)[0]
    assert "max-width" in query and "max-height" in query


# -- the panels can be resized ------------------------------------------


def test_the_resizer_target_is_wider_than_the_line_it_draws() -> None:
    """A one-pixel grab strip is a dexterity barrier. The visible divider is
    1px; the target is 8. WCAG 2.5.8 asks for 24, which a divider cannot have
    without eating the layout — hence the keyboard route being first-class
    rather than a fallback."""
    assert declaration(".panel-resizer", "width") == "8px"


def test_the_resizer_does_not_let_the_browser_pan_instead() -> None:
    """Without this a touch drag scrolls the page and the divider never moves."""
    assert declaration(".panel-resizer", "touch-action") == "none"


def test_the_resizer_disappears_once_the_layout_has_stacked() -> None:
    """Stacked, the panels are full width and there is no horizontal room to
    trade — a divider there would adjust nothing."""
    stacked = at_rule_bodies("@media (max-width: 60rem)")
    assert ".panel-resizer" in stacked and "display: none" in stacked


# -- the divider must stay reachable ------------------------------------


def test_the_panel_itself_does_not_scroll() -> None:
    """Reported: the divider vanished once the panel was scrolled down.

    An absolutely positioned element inside a scrolling box scrolls away with
    the content. Splitting the panel into a fixed shell and an inner scrolling
    wrapper keeps the divider pinned to the panel's edge at any scroll offset.
    """
    assert declaration(".panel", "overflow") == "hidden"
    assert declaration(".panel", "display") == "flex"


def test_the_inner_wrapper_is_what_scrolls() -> None:
    assert declaration(".panel__scroll", "overflow-y") == "auto"
    assert declaration(".panel__scroll", "min-height") == "0", (
        "a flex child without min-height: 0 will not shrink, and scrolls the page instead"
    )


def test_the_scrollbar_does_not_land_on_the_controls() -> None:
    """Reported: narrowing a panel put the scrollbar over the controls at its
    right-hand edge. Overlay scrollbars take no space until they appear, so the
    space has to be reserved up front."""
    assert declaration(".panel__scroll", "scrollbar-gutter") == "stable"


def test_the_inner_wrapper_stops_scrolling_once_stacked() -> None:
    """Stacked, the page scrolls as one; a panel scrolling inside a scrolling
    page is the nested-scroll trap."""
    stacked = at_rule_bodies("@media (max-width: 60rem)")
    assert ".panel__scroll" in stacked
