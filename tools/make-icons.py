# Render app icons from Apollo's TimeSnap sprite (falls back to a plain mark).
#   python3 tools/make-icons.py
from PIL import Image, ImageDraw
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "icons"); os.makedirs(OUT, exist_ok=True)
BG = (11, 14, 20)
spr = os.path.join(ROOT, "assets", "sprites", "timesnap-idle@2x.png")
hero = Image.open(spr).convert("RGBA") if os.path.exists(spr) else None
def icon(size, pad, rounded):
    im = Image.new("RGBA", (size, size), BG + (255,))
    d = ImageDraw.Draw(im)
    inner = int(size * (1 - 2 * pad)); o = (size - inner) // 2
    # checker floor tile backdrop
    t = max(2, inner // 8)
    for y in range(8):
        for x in range(8):
            c = (36, 52, 84) if (x + y) % 2 else (30, 43, 70)
            d.rectangle([o + x * t, o + y * t, o + x * t + t - 1, o + y * t + t - 1], fill=c)
    d.rectangle([o, o, o + 8 * t - 1, o + 8 * t - 1], outline=(108, 196, 255), width=max(1, size // 64))
    if hero:
        k = max(1, (8 * t) // hero.height)
        h = hero.resize((hero.width * k, hero.height * k), Image.NEAREST)
        im.alpha_composite(h, (o + (8 * t - h.width) // 2, o + (8 * t - h.height) // 2 + t // 3))
    if rounded:
        m = Image.new("L", (size, size), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 5, fill=255)
        bg = Image.new("RGBA", (size, size), (0, 0, 0, 0)); bg.paste(im, (0, 0), m); im = bg
    return im
icon(192, 0.04, False).save(os.path.join(OUT, "icon-192.png"))
icon(512, 0.04, False).save(os.path.join(OUT, "icon-512.png"))
icon(512, 0.16, False).save(os.path.join(OUT, "icon-maskable-512.png"))
icon(180, 0.06, False).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))
fav = icon(64, 0.0, True); fav.save(os.path.join(ROOT, "public", "favicon.png"))
print("icons written")
