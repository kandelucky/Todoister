# -*- coding: utf-8 -*-
"""Build the Todoister window/taskbar icon from the Todoist-style SVG.

Takes assets/icon.svg (the rounded-square checkmark logo), recolors the brand
fill to GREEN, renders it at high resolution, applies a rounded-square alpha mask
(so the corners are transparent), and writes a multi-size .ico plus a .png.

Re-run after changing GREEN to recolor."""
import os
from io import BytesIO
from PIL import Image, ImageDraw
from svglib.svglib import svg2rlg
from reportlab.graphics import renderPM

GREEN = "#637760"          # brand fill — change this to recolor the icon
SRC_RED = "#e44232"        # original Todoist red in the source SVG
RENDER = 1024              # high-res render before downscaling

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
SVG_PATH = os.path.join(ASSETS, "icon.svg")


def main():
    raw = open(SVG_PATH, encoding="utf-8").read()
    green_svg = raw.replace(SRC_RED, GREEN).replace(SRC_RED.upper(), GREEN)
    tmp = os.path.join(ASSETS, "_icon_green.svg")
    open(tmp, "w", encoding="utf-8").write(green_svg)

    drawing = svg2rlg(tmp)
    scale = RENDER / drawing.width
    drawing.width *= scale
    drawing.height *= scale
    drawing.scale(scale, scale)
    png_bytes = renderPM.drawToString(drawing, fmt="PNG")
    img = Image.open(BytesIO(png_bytes)).convert("RGBA")
    if img.size != (RENDER, RENDER):
        img = img.resize((RENDER, RENDER), Image.LANCZOS)

    # Rounded-square alpha mask matching the logo's outer shape (viewBox 0..512,
    # rect 6..506, corner radius ~62 → scaled to RENDER).
    k = RENDER / 512.0
    mask = Image.new("L", (RENDER, RENDER), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [6 * k, 6 * k, 506 * k, 506 * k], radius=62 * k, fill=255
    )
    img.putalpha(mask)

    os.remove(tmp)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [img.resize((s, s), Image.LANCZOS) for s in sizes]
    frames[-1].save(os.path.join(ASSETS, "icon.ico"), format="ICO", sizes=[(s, s) for s in sizes])
    frames[-1].save(os.path.join(ASSETS, "icon.png"), format="PNG")
    print("wrote icon.ico + icon.png in", ASSETS)


if __name__ == "__main__":
    main()
