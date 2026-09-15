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
    narrow = css()[css().index("@media (max-width: 60rem)") :]
    block = narrow[: narrow.index("\n}\n\n") if "\n}\n\n" in narrow else len(narrow)]
    assert "flex-direction: column" in block


def test_the_canvas_keeps_a_height_when_stacked() -> None:
    """A diagram collapsed to nothing is a loss of function, not a reflow."""
    narrow = css()[css().index("@media (max-width: 60rem)") :]
    assert "min-height" in narrow[: narrow.index("\n}\n\n")] or "min-height" in narrow


def test_the_breakpoint_is_in_rem_so_it_follows_the_user_font_size() -> None:
    """A user who enlarges text, rather than zooming, must reflow too — and a
    breakpoint in pixels would ignore them entirely."""
    assert re.search(r"@media \(max-width: \d+rem\)", css())
