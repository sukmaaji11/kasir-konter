"""Ikon launcher dan gambar splash Kasir Konter.

Latar navy aplikasi (#1F3A5F) + logo ponsel putih dengan layar navy dan
tanda centang kuning, geometri sama dengan src/ui/BrandLogo.tsx (viewBox 64).

Pakai:
  python tools/icons/launcher_icon.py preview <out.png>
  python tools/icons/launcher_icon.py export android/app/src/main/res
"""
import os
import sys
from PIL import Image, ImageDraw

NAVY = "#1f3a5f"
NAVY_DARK = "#152a46"
WHITE = "#f4f7fb"
AMBER = "#f2b544"
SS = 4  # supersampling supaya tepi halus


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def draw_phone(img, scale, ox, oy):
    """Gambar logo (unit = viewBox 64 dari BrandLogo.tsx) mulai titik (ox, oy)."""
    d = ImageDraw.Draw(img)

    def p(x, y):
        return (ox + x * scale, oy + y * scale)

    def rect(x, y, w, h, r, fill):
        d.rounded_rectangle([p(x, y), p(x + w, y + h)], radius=r * scale, fill=fill)

    rect(20, 10, 24, 44, 5, WHITE)          # badan ponsel
    rect(23.5, 15, 17, 30, 2, NAVY)         # layar
    cx, cy = p(32, 49.5)                    # tombol bawah
    r = 2 * scale
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=NAVY)
    # Tanda centang (stroke 3.2, ujung membulat).
    points = [p(26.5, 30.5), p(30.5, 34.5), p(38, 26.5)]
    width = round(3.2 * scale)
    d.line(points, fill=AMBER, width=width, joint="curve")
    for x, y in (points[0], points[-1]):
        rr = width / 2
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=AMBER)


# Kotak isi logo: x 20..44, y 10..54 (24 x 44 unit).
LOGO_W, LOGO_H, LOGO_X, LOGO_Y = 24, 44, 20, 10


def foreground(size):
    """Lapisan depan ikon adaptif (kanvas 108dp, zona terlihat 72dp)."""
    u = size / 108
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # Tinggi ponsel = 58% dari 72dp yang terlihat.
    scale = (0.58 * 72 / LOGO_H) * u
    ox = 54 * u - (LOGO_X + LOGO_W / 2) * scale
    oy = 54 * u - (LOGO_Y + LOGO_H / 2) * scale
    draw_phone(img, scale, ox, oy)
    return img


def background(size):
    """Navy dengan gradasi halus ke navy gelap (atas kiri → bawah kanan)."""
    top, bottom = hex_rgb("#2c5487"), hex_rgb(NAVY_DARK)
    small = Image.new("RGB", (64, 64))
    for y in range(64):
        for x in range(64):
            t = min(1, max(0, (x + y) / 126 * 1.1 - 0.05))
            small.putpixel((x, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return small.resize((size, size), Image.BICUBIC).convert("RGBA")


def compose(size, mask="squircle"):
    big = size * SS
    img = background(big)
    img.alpha_composite(foreground(big))
    crop = round(big * 18 / 108)
    img = img.crop((crop, crop, big - crop, big - crop))
    side = img.size[0]
    m = Image.new("L", (side, side), 0)
    md = ImageDraw.Draw(m)
    if mask == "circle":
        md.ellipse([0, 0, side - 1, side - 1], fill=255)
    else:
        md.rounded_rectangle([0, 0, side - 1, side - 1], radius=side * 0.3, fill=255)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out.resize((size, size), Image.LANCZOS)


def splash(width, height):
    """Splash lama (Android ≤11 / cadangan): navy polos + logo di tengah."""
    img = Image.new("RGBA", (width * 2, height * 2), hex_rgb(NAVY) + (255,))
    short = min(width, height) * 2
    scale = short * 0.30 / LOGO_H
    ox = width - (LOGO_X + LOGO_W / 2) * scale
    oy = height - (LOGO_Y + LOGO_H / 2) * scale
    draw_phone(img, scale, ox, oy)
    return img.resize((width, height), Image.LANCZOS).convert("RGB")


def splash_icon(px_per_dp):
    """Ikon splash sistem Android 12+ (tanpa latar ikon): kanvas 288dp, logo kotak
    112dp di tengah (muat di lingkaran 192dp), sama ukuran & posisi dengan logo
    splash web."""
    size = round(288 * px_per_dp)
    big = size * SS
    u = big / 288
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    side = 112 * u
    x0 = (big - side) / 2
    # Cincin putih tipis (seperti box-shadow 0 0 0 2px di web) lalu kotak navy.
    ring = 2 * u
    d.rounded_rectangle([x0 - ring, x0 - ring, x0 + side + ring, x0 + side + ring], radius=30 * u + ring, fill=(255, 255, 255, 52))
    d.rounded_rectangle([x0, x0, x0 + side, x0 + side], radius=28 * u, fill=hex_rgb(NAVY) + (255,))
    draw_phone(img, side / 64, x0, x0)
    return img.resize((size, size), Image.LANCZOS)


def preview(out):
    sheet = Image.new("RGBA", (760, 440), "#2b3a4a")
    ImageDraw.Draw(sheet).rectangle([0, 220, 760, 440], fill="#dfe6ea")
    for y in (40, 260):
        sheet.alpha_composite(compose(140), (60, y))
        sheet.alpha_composite(compose(140, "circle"), (240, y))
        sheet.alpha_composite(compose(64), (420, y + 38))
        sheet.alpha_composite(compose(48, "circle"), (520, y + 46))
    sheet.alpha_composite(splash(120, 200).convert("RGBA"), (620, 120))
    sheet.save(out)


DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
# Ukuran splash bawaan Capacitor per kepadatan (potret).
SPLASH_PORT = {"mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280), "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920)}


def export(res):
    for name, f in DENSITIES.items():
        os.makedirs(os.path.join(res, f"drawable-{name}"), exist_ok=True)
        folder = os.path.join(res, f"mipmap-{name}")
        side = round(108 * f)
        big = side * SS
        background(big).resize((side, side), Image.LANCZOS).save(os.path.join(folder, "ic_launcher_background.png"))
        foreground(big).resize((side, side), Image.LANCZOS).save(os.path.join(folder, "ic_launcher_foreground.png"))
        compose(round(48 * f), "squircle").save(os.path.join(folder, "ic_launcher.png"))
        compose(round(48 * f), "circle").save(os.path.join(folder, "ic_launcher_round.png"))
        w, h = SPLASH_PORT[name]
        splash(w, h).save(os.path.join(res, f"drawable-port-{name}", "splash.png"))
        splash(h, w).save(os.path.join(res, f"drawable-land-{name}", "splash.png"))
        splash_icon(f).save(os.path.join(res, f"drawable-{name}", "splash_icon.png"))
    splash(480, 480).save(os.path.join(res, "drawable", "splash.png"))


if __name__ == "__main__":
    if sys.argv[1] == "preview":
        preview(sys.argv[2])
    else:
        export(sys.argv[2])
