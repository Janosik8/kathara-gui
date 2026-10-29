"""Convert the device icons in ``icons/`` to the PNGs the canvas draws (UX-08, F46).

The source files are CMYK JPEGs on an opaque white ground, which a dark theme
shows as a white box around every device. JPEG has no transparency, so they
are converted once, here, and the PNGs are committed beside the code that
imports them.

The background is removed by flood fill from the image border, not by making
every white pixel transparent: the arrows on the router and switch and the
screen on the PC are white too, and must stay. Near-white pixels on the edge
of the filled region get partial alpha, so the icon has no white fringe.

Run:  uv run --with pillow python scripts/icons_to_png.py
"""

from __future__ import annotations

from collections import Counter, deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "icons"
TARGET = ROOT / "frontend" / "src" / "canvas" / "icons"
KINDS = ("router", "switch", "pc", "server")

#: Whiteness (min of R, G, B) at or above which a border-connected pixel is background.
BACKGROUND = 235
#: Below this it is fully opaque; between the two, alpha ramps for a soft edge.
EDGE = 150


def transparent(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGB").convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()

    def whiteness(x: int, y: int) -> int:
        r, g, b, _ = pixels[x, y]
        return min(r, g, b)

    seen = set()
    queue = deque(
        (x, y)
        for x in range(width)
        for y in range(height)
        if (x in (0, width - 1) or y in (0, height - 1)) and whiteness(x, y) >= BACKGROUND
    )
    seen.update(queue)
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in seen:
                seen.add((nx, ny))
                if whiteness(nx, ny) >= BACKGROUND:
                    queue.append((nx, ny))
                else:
                    # The icon's own edge, reached from outside: soften it.
                    w = whiteness(nx, ny)
                    if w > EDGE:
                        r, g, b, _ = pixels[nx, ny]
                        alpha = round(255 * (BACKGROUND - w) / (BACKGROUND - EDGE))
                        pixels[nx, ny] = (r, g, b, alpha)

    for x, y in seen:
        if whiteness(x, y) >= BACKGROUND:
            pixels[x, y] = (255, 255, 255, 0)
    return rgba


def dominant(image: Image.Image) -> str:
    """The body colour: the mean of the commonest opaque, non-white bucket.

    Buckets of 8 group JPEG noise; the mean, not the bucket's corner, is what
    the contrast check in tests/test_contrast.py is given.
    """
    pixels = image.load()
    width, height = image.size
    opaque = [
        (r, g, b)
        for r, g, b, a in (pixels[x, y] for x in range(width) for y in range(height))
        if a == 255 and min(r, g, b) < 200
    ]
    bucket, _ = Counter((r // 8, g // 8, b // 8) for r, g, b in opaque).most_common(1)[0]
    members = [p for p in opaque if (p[0] // 8, p[1] // 8, p[2] // 8) == bucket]
    r, g, b = (round(sum(c) / len(members)) for c in zip(*members, strict=True))
    return f"#{r:02x}{g:02x}{b:02x}"


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for kind in KINDS:
        source = Image.open(SOURCE / f"{kind}.jpg")
        result = transparent(source)
        result.save(TARGET / f"{kind}.png", optimize=True)
        print(f"{kind}: {source.mode} {source.size} -> RGBA, dominant {dominant(result)}")


if __name__ == "__main__":
    main()
