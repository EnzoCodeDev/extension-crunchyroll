"""Genera los iconos de la extensión (requiere Pillow). Uso: python tools/make_icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)


def icon(size: int) -> Image.Image:
    s = size * 4  # dibujar grande y reducir para suavizar bordes
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s // 4.5, fill=(244, 117, 33, 255))
    # Bocadillo blanco
    m = s * 0.16
    d.rounded_rectangle((m, m, s - m, s * 0.70), radius=s // 7, fill=(255, 255, 255, 255))
    d.polygon([(s * 0.30, s * 0.66), (s * 0.30, s * 0.86), (s * 0.48, s * 0.68)], fill=(255, 255, 255, 255))
    try:
        font = ImageFont.truetype("arialbd.ttf", int(s * 0.30))
    except OSError:
        font = ImageFont.load_default()
    d.text((s / 2, s * 0.43), "EN", font=font, fill=(244, 117, 33, 255), anchor="mm")
    return img.resize((size, size), Image.LANCZOS)


for n in (16, 32, 48, 128):
    icon(n).save(OUT / f"icon-{n}.png")
print("iconos en", OUT)
