#!/usr/bin/env python3
"""Build a 1200x630 preview image per page, so a Discord or X link shows that page, not one shared card.

    dev/make-og.py

Each image shares the brand: near-black background, gold frame, the logo, the page title in serif, a one
line subtitle, and the domain. Written to assets/og/<slug>.png; the page's own meta tags are updated by
dev/set-og.py.
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "og"
LOGO = ROOT / "assets" / "brand" / "hunsterverse-static.png"

W, H = 1200, 630
BG = (21, 14, 9)
FRAME = (201, 162, 39)
INK = (245, 235, 214)
SOFT = (188, 168, 132)

SERIF = "/usr/share/fonts/TTF/DejaVuSerifCondensed.ttf"
SERIF_BOLD = "/usr/share/fonts/TTF/DejaVuSerifCondensed-Bold.ttf"
SANS = "/usr/share/fonts/TTF/DejaVuSansCondensed.ttf"

PAGES = {
    "index": ("Hunsterverse", "Monster Hunter Frontier Z, live"),
    "hunters": ("Hunters", "Profiles, playtime, weapons and Road placings"),
    "leaderboards": ("Leaderboards", "Monster slays, Road clears and weapon usage"),
    "worlds": ("Worlds", "Who is online, what they hunt, how many play"),
    "quests": ("Quest catalog", "Every quest on the server, searchable"),
    "quest": ("Quest", "Objective, area, monsters and rewards"),
    "monsters": ("Monster field guide", "Frontier monsters, hitzones and drops"),
    "guilds": ("Guilds", "Guild rosters, halls and applications"),
    "events": ("Events", "What is running on the server right now"),
    "road-vote": ("Hunting Road", "Vote for the next rotation"),
    "catalog": ("Item catalog", "Weapons, armour and items"),
    "set-builder": ("Set builder", "Plan an armour set and its skills"),
    "changelog": ("Changelog", "Every server and site update, dated"),
    "api": ("API", "Public endpoints and the private docs"),
    "guide-windows": ("Windows guide", "Install and play on Windows"),
    "guide-frontier": ("Frontier handbook", "Frontier Z from first hunt to Zenith, for this server"),
    "guide-frontier-basics": ("Getting started", "Ranks, styles, G Rank and Zenith"),
    "guide-frontier-equipment": ("Gear and skills", "Fourteen weapons, sigils, armour and Transcend"),
    "guide-frontier-activities": ("What there is to do", "Quests, festivals, Road, Caravan, Raviente"),
    "guide-frontier-reference": ("Reference", "House, items, monsters, gathering and tools"),
    "guide-roads": ("Roads in game", "Choosing a Road, and what the rest of the party sees"),
    "guide-linux": ("Linux guide", "Install and play on Linux"),
}


def fit(draw, text, font_path, size, max_width):
    """The largest size at or below `size` at which `text` fits `max_width`."""
    while size > 28:
        font = ImageFont.truetype(font_path, size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 4
    return ImageFont.truetype(font_path, 28)


def build(slug, title, subtitle):
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # soft vertical wash so the card is not a flat rectangle
    for y in range(H):
        shade = int(8 * (y / H))
        draw.line([(0, y), (W, y)], fill=(BG[0] + shade, BG[1] + shade, BG[2] + shade))

    draw.rectangle([28, 28, W - 28, H - 28], outline=FRAME, width=3)
    draw.rectangle([44, 44, W - 44, H - 44], outline=(70, 55, 28), width=1)

    if LOGO.exists():
        logo = Image.open(LOGO).convert("RGBA")
        logo.thumbnail((360, 160))
        img.paste(logo, (80, 70), logo)

    title_font = fit(draw, title, SERIF_BOLD, 96, W - 200)
    draw.text((80, 300), title, font=title_font, fill=INK)

    sub_font = ImageFont.truetype(SANS, 34)
    draw.text((80, 300 + title_font.size + 26), subtitle, font=sub_font, fill=SOFT)

    small = ImageFont.truetype(SANS, 24)
    draw.text((80, H - 96), "hvmhfz.eclipseforge.xyz", font=small, fill=SOFT)
    # right-aligned and measured, so the label never crosses the frame
    label = "MONSTER HUNTER FRONTIER Z"
    label_font = ImageFont.truetype(SANS, 22)
    label_w = draw.textlength(label, font=label_font)
    draw.text((W - 80 - label_w, H - 94), label, font=label_font, fill=(120, 98, 52))

    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / f"{slug}.png", optimize=True)
    return OUT / f"{slug}.png"


if __name__ == "__main__":
    for slug, (title, subtitle) in PAGES.items():
        path = build(slug, title, subtitle)
        print("wrote", path.relative_to(ROOT), path.stat().st_size)
