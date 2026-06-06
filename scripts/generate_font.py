#!/usr/bin/env python3
"""
generate_font.py — rasterise elektron-font.otf → ui_font.mjs

Renders each printable ASCII character (0x20–0x7E) from the Elektron OTF
at a given point size using Pillow, then emits the bitmap data in the format
expected by ui_font.mjs.

Glyph format: [advance, yOff, w, h, ...rowBytes]
  advance   horizontal advance in pixels
  yOff      vertical offset from cap-height baseline (negative = above)
  w, h      bounding box of ink pixels (tight, blank rows trimmed)
  rowBytes  one integer per row; bit 0 = leftmost pixel

Usage:
  pip install pillow
  python3 scripts/generate_font.py           # writes ui_font.mjs
  python3 scripts/generate_font.py --size 9  # different point size
"""

import argparse
import os
from PIL import Image, ImageFont, ImageDraw

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MOVY_DIR   = os.path.dirname(SCRIPT_DIR)
FONT_PATH  = os.path.join(MOVY_DIR, "elektron-font.otf")
OUT_PATH   = os.path.join(MOVY_DIR, "ui_font.mjs")

CANVAS = 32  # render canvas size (must be larger than any glyph)


def rasterise(font_size: int) -> tuple[list, int]:
    """Returns (glyphs, cap_top) where cap_top is the PIL bbox.top for 'A'."""
    font = ImageFont.truetype(FONT_PATH, font_size)

    # Determine cap baseline: top of 'A' ink in the PIL coordinate system
    cap_bbox = font.getbbox("A")
    cap_top  = cap_bbox[1]

    glyphs = []
    for cp in range(0x20, 0x7F):
        ch   = chr(cp)
        bbox = font.getbbox(ch)
        adv  = int(font.getlength(ch) + 0.5)

        if bbox is None or bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
            glyphs.append([adv, 0, 0, 0])
            continue

        left, top, right, bottom = bbox
        w = right - left

        img  = Image.new("L", (CANVAS, CANVAS), 0)
        ImageDraw.Draw(img).text((0, 0), ch, font=font, fill=255)

        # Collect rows, then trim leading/trailing blank rows
        rows_raw = []
        for row in range(top, bottom):
            bits = 0
            for col in range(left, right):
                if img.getpixel((col, row)) > 127:
                    bits |= 1 << (col - left)
            rows_raw.append(bits)

        lo = 0
        while lo < len(rows_raw) and rows_raw[lo] == 0:
            lo += 1
        hi = len(rows_raw)
        while hi > lo and rows_raw[hi - 1] == 0:
            hi -= 1

        if lo >= hi:
            glyphs.append([adv, 0, 0, 0])
            continue

        rows = rows_raw[lo:hi]
        yoff = (top + lo) - cap_top
        h    = hi - lo
        glyphs.append([adv, yoff, w, h] + rows)

    return glyphs, cap_top


def emit(glyphs: list, font_size: int) -> str:
    chars = [chr(c) for c in range(0x20, 0x7F)]

    # Infer FONT_HEIGHT: height of 'A' (index 0x41 - 0x20 = 33)
    a_glyph = glyphs[0x41 - 0x20]
    font_height = a_glyph[3]  # h field

    lines = [
        f"// Elektron pixel font — rasterised from elektron-font.otf at {font_size}pt",
        "// Glyph format: [advance, yOff, w, h, ...rowBytes]  bit0=leftmost pixel",
        "",
        f"export const FONT_HEIGHT = {font_height};  // nominal cap height in pixels",
        "",
        "const G = [",
    ]
    for ch, g in zip(chars, glyphs):
        row_str = ", ".join(str(v) for v in g)
        lines.append(f"  [{row_str}],// {repr(ch)}")
    lines.append("];")
    lines.append("")
    lines.append(f"""export function fontWidth(str) {{
  let w = 0;
  for (let i = 0; i < str.length; i++) {{
    const cp = str.charCodeAt(i);
    if (cp < 0x20 || cp > 0x7E) {{ w += {font_height}; continue; }}
    w += G[cp - 0x20][0];
  }}
  return w;
}}

export function fontPrint(x, y, str, color) {{
  let cx = x;
  for (let i = 0; i < str.length; i++) {{
    const cp = str.charCodeAt(i);
    if (cp < 0x20 || cp > 0x7E) {{ cx += {font_height}; continue; }}
    const g = G[cp - 0x20];
    const adv = g[0], yOff = g[1], w = g[2], h = g[3];
    for (let row = 0; row < h; row++) {{
      const bits = g[4 + row];
      let col = 0;
      while (col < w) {{
        if (bits & (1 << col)) {{
          const s = col;
          while (col < w && (bits & (1 << col))) col++;
          fill_rect(cx + s, y + yOff + row, col - s, 1, color);
        }} else {{ col++; }}
      }}
    }}
    cx += adv;
  }}
}}""")

    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--size", type=int, default=8,
                        help="Point size to rasterise at (default: 8)")
    parser.add_argument("--out", default=OUT_PATH,
                        help=f"Output path (default: {OUT_PATH})")
    args = parser.parse_args()

    glyphs, cap_top = rasterise(args.size)
    content = emit(glyphs, args.size)

    with open(args.out, "w") as f:
        f.write(content)

    a = glyphs[0x41 - 0x20]
    print(f"Written {len(content)} bytes to {args.out}")
    print(f"  size={args.size}pt  cap_top={cap_top}  'A': {a[2]}×{a[3]}px  FONT_HEIGHT={a[3]}")


if __name__ == "__main__":
    main()
