"""
generate_icon.py — creates the Apple touch icon for DBus Donostia.

Produces a 180x180 PNG with:
  - Blue (#1a73e8) rounded-rectangle background
  - 🚌 emoji centred in the upper portion (via pilmoji / twemoji)
  - White bold "D" centred below the emoji

Output: backend/static/icons/apple-touch-icon.png
Run:    python3 generate_icon.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pilmoji import Pilmoji

# ── constants ─────────────────────────────────────────────────────────────────
SIZE       = 180
BG         = (26, 115, 232)   # --brand: #1a73e8  (matches style.css)
WHITE      = (255, 255, 255)
RADIUS     = 36               # rounded-rect corner radius
EMOJI      = "🚌"
EMOJI_PX   = 120              # desired emoji height in the final icon
D_PT       = 32               # font size for the "D" label

SF_ROUNDED = "/System/Library/Fonts/SFNSRounded.ttf"
FALLBACK   = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

OUT = Path(__file__).parent / "backend" / "static" / "icons" / "apple-touch-icon.png"


def _load_font(pt: int) -> ImageFont.FreeTypeFont:
    for path in (SF_ROUNDED, FALLBACK):
        try:
            return ImageFont.truetype(path, pt)
        except OSError:
            pass
    return ImageFont.load_default()


def render_emoji_cropped(emoji: str, target_height: int) -> Image.Image:
    """Render emoji at a large pt, crop to actual pixels, resize to target_height."""
    pt = 300
    canvas = Image.new("RGBA", (600, 600), (0, 0, 0, 0))
    font = _load_font(pt)
    with Pilmoji(canvas) as pj:
        pj.text((50, 0), emoji, font=font)

    arr = np.array(canvas)
    alpha = arr[:, :, 3] > 10
    if not alpha.any():
        raise RuntimeError("pilmoji rendered no visible pixels")

    rows, cols = np.where(alpha)
    y0, y1 = rows.min(), rows.max() + 1
    x0, x1 = cols.min(), cols.max() + 1
    cropped = canvas.crop((x0, y0, x1, y1))

    # scale to target_height preserving aspect ratio
    w, h = cropped.size
    new_w = round(w * target_height / h)
    return cropped.resize((new_w, target_height), Image.LANCZOS)


# ── main canvas ───────────────────────────────────────────────────────────────
img  = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=BG)

# ── emoji ─────────────────────────────────────────────────────────────────────
emoji_img = render_emoji_cropped(EMOJI, EMOJI_PX)
ew, eh = emoji_img.size

PADDING_TOP = 10
ex = (SIZE - ew) // 2
ey = PADDING_TOP
img.paste(emoji_img, (ex, ey), emoji_img)

# ── "D" label ─────────────────────────────────────────────────────────────────
d_font = _load_font(D_PT)
draw2 = ImageDraw.Draw(img)
db = draw2.textbbox((0, 0), "D", font=d_font)
dx = (SIZE - (db[2] - db[0])) // 2 - db[0]
dy = ey + eh + 6
draw2.text((dx, dy), "D", fill=WHITE, font=d_font)

# ── save ──────────────────────────────────────────────────────────────────────
OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, "PNG")
print(f"Saved {OUT}  ({SIZE}x{SIZE})")
