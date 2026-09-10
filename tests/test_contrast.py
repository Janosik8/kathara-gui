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
