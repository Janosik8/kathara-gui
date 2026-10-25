"""Colour contrast of the theme palette, checked against WCAG 2.1.

Accessibility is a graded deliverable here (Capability 6, EN 301 549), and
contrast is the one part of it the automated browser tooling cannot reach:
axe-core needs a real canvas to sample rendered pixels, so under jsdom its
colour-contrast rule is silently skipped. A clean `npm test` therefore proves
structure, roles and naming — never contrast.

This closes most of that gap from the other side. It parses the real token
values out of `styles.css`, so the palette cannot drift back below threshold
without a test failing.

What it does **not** prove: that a given token is actually the one used behind
a given piece of text. Rendered contrast still needs a browser check, which is
why the manual pass in docs/USAGE.md stays.

Thresholds (WCAG 2.1):
  1.4.3 Contrast (Minimum), text          4.5:1
  1.4.3 large text (>=18.66px bold/24px)  3.0:1
  1.4.11 Non-text Contrast, UI boundaries 3.0:1
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

STYLES = Path(__file__).resolve().parents[1] / "frontend" / "src" / "styles.css"

TEXT_MINIMUM = 4.5
NON_TEXT_MINIMUM = 3.0


# -- colour maths ------------------------------------------------------


def _channel(value: float) -> float:
    return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4


def relative_luminance(hex_colour: str) -> float:
    """WCAG relative luminance of an #rrggbb colour."""
    raw = hex_colour.lstrip("#")
    if len(raw) != 6:
        raise ValueError(f"Expected #rrggbb, got {hex_colour!r}")
    r, g, b = (_channel(int(raw[i : i + 2], 16) / 255) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: str, b: str) -> float:
    la, lb = relative_luminance(a), relative_luminance(b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


# -- reading the real palette -----------------------------------------

_TOKEN = re.compile(r"(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;")


def _block(css: str, start_marker: str) -> str:
    """The text of the brace-delimited block beginning at ``start_marker``."""
    start = css.index(start_marker)
    depth = 0
    for index in range(start, len(css)):
        if css[index] == "{":
            depth += 1
        elif css[index] == "}":
            depth -= 1
            if depth == 0:
                return css[start : index + 1]
    raise ValueError(f"Unbalanced braces after {start_marker!r}")


def _palettes() -> tuple[dict[str, str], dict[str, str]]:
    """The light palette, and the dark palette with light as its base."""
    css = STYLES.read_text(encoding="utf-8")

    light = dict(_TOKEN.findall(_block(css, ":root {")))
    dark = dict(light)
    dark.update(_TOKEN.findall(_block(css, "@media (prefers-color-scheme: dark)")))
    return light, dark


LIGHT, DARK = _palettes()
THEMES = [("light", LIGHT), ("dark", DARK)]


def test_the_palette_was_actually_found() -> None:
    """Guard against the parser silently matching nothing and passing."""
    for name, palette in THEMES:
        assert "--bg" in palette, f"{name}: no tokens parsed from styles.css"
        assert len(palette) >= 8, f"{name}: suspiciously few tokens ({len(palette)})"


def test_light_and_dark_define_the_same_tokens() -> None:
    """A token defined only in light mode renders unthemed in dark mode."""
    assert set(LIGHT) == set(DARK)


# -- text ---------------------------------------------------------------

TEXT_PAIRS = [
    ("body text on the canvas", "--fg", "--bg"),
    ("body text on a panel", "--fg", "--bg-panel"),
    ("body text on a raised surface", "--fg", "--bg-raised"),
    ("secondary text on a panel", "--fg-muted", "--bg-panel"),
    ("secondary text on a raised surface", "--fg-muted", "--bg-raised"),
    ("accent text", "--accent", "--bg"),
    ("error text on a panel", "--danger", "--bg-panel"),
    ("warning text on a panel", "--warning", "--bg-panel"),
    # The header turns loud when the canvas has drifted from the running lab.
    # Loud is no use if it stops the title being readable.
    ("the title on a drifted header", "--fg", "--bg-header-drift"),
    # And red while the lab runs and the design is read-only (test step 3A.2).
    ("the title on a locked header", "--fg", "--bg-header-locked"),
    ("the read-only badge", "--danger-fg", "--danger"),
    # The two working areas have surfaces of their own, so every pairing that
    # text actually lands on has to be checked, not just the generic panel.
    ("the device block's accent as text", "--device", "--bg-panel-devices"),
    ("body text on the device panel", "--fg", "--bg-panel-devices"),
    ("secondary text on the device panel", "--fg-muted", "--bg-panel-devices"),
    ("body text on the lab panel", "--fg", "--bg-panel-lab"),
    ("secondary text on the lab panel", "--fg-muted", "--bg-panel-lab"),
]


@pytest.mark.parametrize(("theme", "palette"), THEMES)
@pytest.mark.parametrize(("what", "fg", "bg"), TEXT_PAIRS)
def test_text_meets_wcag_aa(
    theme: str, palette: dict[str, str], what: str, fg: str, bg: str
) -> None:
    ratio = contrast_ratio(palette[fg], palette[bg])
    assert ratio >= TEXT_MINIMUM, (
        f"{theme}: {what} — {palette[fg]} on {palette[bg]} is {ratio:.2f}:1, "
        f"below the {TEXT_MINIMUM}:1 required by WCAG 1.4.3"
    )


# -- controls and boundaries -------------------------------------------

NON_TEXT_PAIRS = [
    # The boundary of a button, input or the canvas controls. This is the one
    # that was failing: the subtle --border is 1.6:1 and invisible on white.
    ("control boundary on the canvas", "--border-strong", "--bg"),
    ("control boundary on a panel", "--border-strong", "--bg-panel"),
    ("control boundary on a raised surface", "--border-strong", "--bg-raised"),
    ("focus indicator on the canvas", "--focus", "--bg"),
    ("focus indicator on a panel", "--focus", "--bg-panel"),
    # The bar marking an exited device, and the notice explaining it.
    ("warning boundary on a panel", "--warning", "--bg-panel"),
]


@pytest.mark.parametrize(("theme", "palette"), THEMES)
@pytest.mark.parametrize(("what", "fg", "bg"), NON_TEXT_PAIRS)
def test_interface_boundaries_meet_wcag_non_text_contrast(
    theme: str, palette: dict[str, str], what: str, fg: str, bg: str
) -> None:
    ratio = contrast_ratio(palette[fg], palette[bg])
    assert ratio >= NON_TEXT_MINIMUM, (
        f"{theme}: {what} — {palette[fg]} on {palette[bg]} is {ratio:.2f}:1, "
        f"below the {NON_TEXT_MINIMUM}:1 required by WCAG 1.4.11"
    )


def channel_distance(a: str, b: str) -> int:
    """The largest per-channel difference between two colours.

    Crude, and deliberately so. Contrast ratio measures *lightness*, and two
    colours can be identical in lightness while being obviously different
    colours — which is the whole reason the greyscale cue has to be carried by
    shape. It is also the reason a lightness test could not catch the reported
    defect: the device block was a blue tint on a blue-grey panel, 1.05:1 apart
    and visually the same surface. This measures whether they are the same
    *colour* at all.
    """
    left, right = a.lstrip("#"), b.lstrip("#")
    return max(
        abs(int(left[i : i + 2], 16) - int(right[i : i + 2], 16)) for i in (0, 2, 4)
    )


#: Below this the two surfaces read as one. The blue-on-blue-grey block that
#: prompted this scored 10 in light mode and 2 in dark.
SURFACE_DISTANCE_MINIMUM = 15


@pytest.mark.parametrize(("theme", "palette"), THEMES)
@pytest.mark.parametrize("block", ["--bg-panel-devices", "--bg-panel-lab"])
def test_a_block_does_not_vanish_into_the_panel_behind_it(
    theme: str, palette: dict[str, str], block: str
) -> None:
    distance = channel_distance(palette[block], palette["--bg-panel"])
    assert distance >= SURFACE_DISTANCE_MINIMUM, (
        f"{theme}: {block} is only {distance} from --bg-panel and reads as the "
        "same surface"
    )


def test_the_drifted_header_is_unmistakably_not_the_normal_one() -> None:
    """The point of the colour. The side-panel warning was being missed, so
    this one has to register without being looked for."""
    for theme, palette in THEMES:
        distance = channel_distance(palette["--bg-header-drift"], palette["--bg-panel"])
        assert distance >= 60, f"{theme}: the drifted header barely differs ({distance})"


def test_the_locked_header_is_neither_the_normal_one_nor_the_drifted_one() -> None:
    """Test step 3A.2: "it should be more bright, like red". Red and amber
    differ in hue more than this crude distance shows, so the bar is lower."""
    for theme, palette in THEMES:
        normal = channel_distance(palette["--bg-header-locked"], palette["--bg-panel"])
        assert normal >= 60, f"{theme}: the locked header barely differs ({normal})"
        drift = channel_distance(palette["--bg-header-locked"], palette["--bg-header-drift"])
        assert drift >= 40, f"{theme}: locked and drifted look alike ({drift})"


def test_the_device_and_laboratory_blocks_are_different_colours() -> None:
    for theme, palette in THEMES:
        distance = channel_distance(palette["--bg-panel-devices"], palette["--bg-panel-lab"])
        assert distance >= SURFACE_DISTANCE_MINIMUM, f"{theme}: the two blocks look alike"


def test_the_panel_accents_are_visible_on_their_own_surfaces() -> None:
    """WCAG 1.4.11: the edge marking each working area is a UI boundary."""
    for theme, palette in THEMES:
        for accent, surface in (
            ("--device", "--bg-panel-devices"),
            ("--warning", "--bg-panel-lab"),
        ):
            ratio = contrast_ratio(palette[accent], palette[surface])
            assert ratio >= NON_TEXT_MINIMUM, (
                f"{theme}: {accent} on {surface} is {ratio:.2f}:1"
            )


def test_the_two_panels_are_not_told_apart_by_colour_alone() -> None:
    """The reason .panel--lab uses a dashed edge rather than only a hue.

    Blue and amber are the safest pair for red-green deficiencies, but they sit
    at almost the same luminance, so to someone with no colour vision the two
    surfaces are identical. This asserts that they really are that close —
    which is what makes the differing border *style* load-bearing rather than
    decorative. If a future palette change separates them properly, this test
    fails and the styling can be simplified.
    """
    for theme, palette in THEMES:
        ratio = contrast_ratio(palette["--bg-panel-devices"], palette["--bg-panel-lab"])
        assert ratio < NON_TEXT_MINIMUM, (
            f"{theme}: the panel surfaces now differ by {ratio:.2f}:1 in greyscale — "
            "the dashed-versus-solid edge may no longer be needed"
        )


def test_the_strong_border_is_stronger_than_the_subtle_one() -> None:
    """Otherwise the two-tier distinction has quietly collapsed."""
    for theme, palette in THEMES:
        strong = contrast_ratio(palette["--border-strong"], palette["--bg-raised"])
        subtle = contrast_ratio(palette["--border"], palette["--bg-raised"])
        assert strong > subtle, f"{theme}: --border-strong is no stronger than --border"


# -- the maths itself ---------------------------------------------------


def test_contrast_ratio_against_known_values() -> None:
    assert contrast_ratio("#000000", "#ffffff") == pytest.approx(21.0, abs=0.01)
    assert contrast_ratio("#ffffff", "#ffffff") == pytest.approx(1.0, abs=0.01)
    # A widely cited reference point: #767676 is the darkest grey that still
    # reaches 4.5:1 on white.
    assert contrast_ratio("#767676", "#ffffff") == pytest.approx(4.54, abs=0.02)


def test_contrast_ratio_is_symmetric() -> None:
    assert contrast_ratio("#123456", "#abcdef") == contrast_ratio("#abcdef", "#123456")
