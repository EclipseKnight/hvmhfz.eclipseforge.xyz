#!/usr/bin/env python3
"""Build a 1200x630 preview image per page, so a Discord or X link shows that page, not one shared card.

    dev/make-og.py              every page card, every monster card and every weapon type card
    dev/make-og.py index play   only the page cards named (so the others are not rewritten)

Each image shares the brand: near-black background, gold frame, the logo, the page title in serif, a one
line subtitle, and the domain. Written to assets/og/<slug>.png; the page's own meta tags are updated by
dev/set-og.py. Monster cards (assets/og/monster/<slug>.png: the monster's icon, name, kind and weak
elements) and weapon type cards (assets/og/weapon/<type>.png) are the pictures of the share pages from
dev/make-share-pages.py; they are saved with 128 colours to keep them small.

Fonts: the DejaVu Condensed faces (Debian/Ubuntu package fonts-dejavu-extra, or /usr/share/fonts/TTF).
"""
import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "og"
LOGO = ROOT / "assets" / "brand" / "hunsterverse-static.png"

W, H = 1200, 630
BG = (21, 14, 9)
FRAME = (201, 162, 39)
INK = (245, 235, 214)
SOFT = (188, 168, 132)



def font_file(name):
    """The font from Arch's folder or Debian's, whichever this machine has."""
    for folder in ("/usr/share/fonts/TTF", "/usr/share/fonts/truetype/dejavu"):
        path = pathlib.Path(folder) / name
        if path.exists():
            return str(path)
    sys.exit(f"font {name} not found: install fonts-dejavu-extra")


SERIF_BOLD = font_file("DejaVuSerifCondensed-Bold.ttf")
SANS = font_file("DejaVuSansCondensed.ttf")

PAGES = {
    "index": ("Hunsterverse", "Monster Hunter Frontier Z, live"),
    "hunters": ("Hunters", "Profiles, playtime, weapons and Road placings"),
    "leaderboards": ("Leaderboards", "Monster slays, Road clears and weapon usage"),
    "worlds": ("Worlds", "Who is online, what they hunt, how many play"),
    "quests": ("Quest catalog", "Every quest on the server, searchable"),
    "quest": ("Quest", "Objective, area, monsters and rewards"),
    "item": ("Item", "Which monsters drop it and which quests need it"),
    "quest-editor": ("Quest editor", "Edit a copy of a quest and test it in game"),
    "monsters": ("Monster field guide", "Frontier monsters, hitzones and drops"),
    "guilds": ("Guilds", "Guild rosters, halls and applications"),
    "events": ("Events", "What is running on the server right now"),
    "road-vote": ("Hunting Road", "Vote for the next rotation"),
    "catalog": ("Item catalog", "Weapons, armour and items"),
    "set-builder": ("Set builder", "Plan an armour set and its skills"),
    "changelog": ("Changelog", "Every server and site update, dated"),
    "api": ("API", "Public endpoints and the private docs"),
    "guide-frontier": ("Frontier handbook", "Frontier Z from first hunt to Zenith, for this server"),
    "guide-frontier-basics": ("Getting started", "Ranks, styles, G Rank and Zenith"),
    "guide-frontier-equipment": ("Gear and skills", "Fourteen weapons, sigils, armour and Transcend"),
    "guide-frontier-activities": ("What there is to do", "Quests, festivals, Road, Caravan, Raviente"),
    "guide-frontier-reference": ("Reference", "House, items, monsters, gathering and tools"),
    "guide-roads": ("Roads in game", "Choosing a Road, and what the rest of the party sees"),
    "play": ("Start playing", "Install, make an account and log in: Windows, Linux, Steam Deck"),
    "weapons": ("Weapon database", "Every weapon, its motion values and a damage calculator"),
    "balance": ("Balance changes", "What the server changed in weapons and moves, and why"),
    "tournaments": ("Tournaments", "Speedrun Cup standings and the VS Bracket"),
    "sky-corridor": ("Sky Corridor", "Duremudira progress, Tower boards and guild missions"),
    "road-data": ("Hunting Road data", "Every Road the server has run, floor by floor"),
    "road-history": ("Past Road winners", "The Roads players voted in, with their authors"),
    "road": ("Road builder", "Build a Hunting Road for the next rotation"),
    "report": ("Report a problem", "Bugs and feature requests for the server"),
    "guide-frontier-armour": ("Armour and skills", "Crafting, armour families, decorations and skills"),
    "guide-frontier-events": ("Regular events", "Festival, Diva Defense, the Caravan and Raviente"),
    "guide-frontier-g-rank-start": ("Starting G Rank", "Style Ranks and your first G Rank steps"),
    "guide-frontier-g-rank": ("G Rank", "Quests, weapons, sigils, armour and Pugi cuffs"),
    "guide-frontier-guild": ("Guild and Guild Hall", "Joining a guild and what its hall offers"),
    "guide-frontier-house": ("House and companions", "Farms, the Airou Plaza and AI companions"),
    "guide-frontier-hunsterverse": ("Hunsterverse vs official", "Courses, gacha and events compared"),
    "guide-frontier-hunter-rank": ("Hunter Rank and Style Rank", "From HR1 to HR7, and what changes at HR5"),
    "guide-frontier-hunters-road": ("Hunter's Road", "The branching huntathon: runs, rewards, skills"),
    "guide-frontier-item-box": ("Equipment and item boxes", "Gear, storage, loadouts and sorting"),
    "guide-frontier-items": ("Items and materials", "Where materials come from, and every combination"),
    "guide-frontier-menus": ("Menus and town NPCs", "In-game menus, chat, Guild Card and every NPC"),
    "guide-frontier-monsters": ("Monsters", "The monster list, status effects and special rules"),
    "guide-frontier-quests-food": ("Quests and food", "Finding quests, quest cards, food buffs and bentos"),
    "guide-frontier-tools": ("Tools and references", "Set builders, sigils, area maps and tables"),
    "guide-frontier-transcend": ("Transcend", "The timed buff you charge during quests"),
    "guide-frontier-weapons": ("Weapons and sigils", "The 14 weapon types, families and sigils"),
    "guide-frontier-zenith": ("Zenith", "GR200 and up: Zenith monsters, armour and weapons"),
}

ELEMENTS = ("fire", "water", "thunder", "ice", "dragon")


def fit(draw, text, font_path, size, max_width):
    """The largest size at or below `size` at which `text` fits `max_width`."""
    while size > 28:
        font = ImageFont.truetype(font_path, size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 4
    return ImageFont.truetype(font_path, 28)


def build(slug, title, subtitle, icon=None, extra=None, out=None, small=False):
    """One card. icon: a picture shown large on the right (a monster); extra: a second, smaller line;
    out: the file (default assets/og/<slug>.png); small: save with 128 colours."""
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

    text_w = W - 200
    if icon is not None:
        # a gold-framed square on the right, the icon scaled up into it
        box = 330
        x0, y0 = W - 80 - box, 150
        draw.rectangle([x0 - 4, y0 - 4, x0 + box + 4, y0 + box + 4], outline=(70, 55, 28), width=2)
        pic = icon.convert("RGBA")
        scale = min((box - 20) / pic.width, (box - 20) / pic.height)
        pic = pic.resize((max(1, int(pic.width * scale)), max(1, int(pic.height * scale))), Image.LANCZOS)
        img.paste(pic, (x0 + (box - pic.width) // 2, y0 + (box - pic.height) // 2), pic)
        text_w = x0 - 40 - 80

    title_font = fit(draw, title, SERIF_BOLD, 96, text_w)
    draw.text((80, 300), title, font=title_font, fill=INK)

    sub_font = fit(draw, subtitle, SANS, 34, text_w)
    draw.text((80, 300 + title_font.size + 26), subtitle, font=sub_font, fill=SOFT)
    if extra:
        extra_font = fit(draw, extra, SANS, 30, text_w)
        draw.text((80, 300 + title_font.size + 26 + sub_font.size + 18), extra, font=extra_font, fill=SOFT)

    small = ImageFont.truetype(SANS, 24)
    draw.text((80, H - 96), "hvmhfz.eclipseforge.xyz", font=small, fill=SOFT)
    # right-aligned and measured, so the label never crosses the frame
    label = "MONSTER HUNTER FRONTIER Z"
    label_font = ImageFont.truetype(SANS, 22)
    label_w = draw.textlength(label, font=label_font)
    draw.text((W - 80 - label_w, H - 94), label, font=label_font, fill=(120, 98, 52))

    path = out or OUT / f"{slug}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    if small:
        img = img.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    img.save(path, optimize=True)
    return path


def weak_elements(detail):
    """The one or two elements that hit the monster hardest on average over its parts (normal hitzones),
    or [] when it has no hitzones or nothing stands out (all elements under 10)."""
    zones = detail.get("hitzones") or []
    if not zones:
        return []
    avg = {e: sum((z.get(e) or 0) for z in zones) / len(zones) for e in ELEMENTS}
    best = sorted(ELEMENTS, key=lambda e: -avg[e])
    if avg[best[0]] < 10:
        return []
    return [e.capitalize() for e in best[:2] if avg[e] >= max(10, avg[best[0]] * 0.75)]


def monster_summary(entry):
    """(subtitle, extra line) for a monster's card and share page, from data/monsters/<slug>.json."""
    detail = json.loads((ROOT / "data" / "monsters" / f"{entry['slug']}.json").read_text())
    kind = entry.get("category") or detail.get("category") or "Monster"
    weak = weak_elements(detail)
    subtitle = kind + (" · weak to " + " and ".join(weak) if weak else "")
    hps = [lv.get("hp") for lv in detail.get("levels") or [] if lv.get("hp")]
    forms = [v for v in entry.get("variants") or []]
    extra = []
    if hps:
        extra.append(f"HP {min(hps):,} to {max(hps):,}" if min(hps) != max(hps) else f"HP {hps[0]:,}")
    if forms:
        extra.append("forms: " + ", ".join(forms))
    return subtitle, " · ".join(extra), detail


def monster_icon(entry):
    """The monster's picture: its render when it has one (bigger), else its icon; None when neither exists."""
    for name in (entry.get("render"), entry.get("icon")):
        path = ROOT / "assets" / "monsters" / "icons" / name if name else None
        if path and path.exists():
            return Image.open(path)
    return None


def build_monsters():
    for entry in json.loads((ROOT / "data" / "monsters" / "index.json").read_text()):
        subtitle, extra, _ = monster_summary(entry)
        yield build(entry["slug"], entry["name"], subtitle, icon=monster_icon(entry), extra=extra,
                    out=OUT / "monster" / f"{entry['slug']}.png", small=True)


def build_weapon_types():
    index = json.loads((ROOT / "data" / "weapons" / "index.json").read_text())
    for kind in index.get("types") or []:
        yield build(kind["slug"], kind["name"], f"{kind['weapons']:,} weapons: attack, sharpness, slots, element",
                    extra="Motion values per style and a damage calculator",
                    out=OUT / "weapon" / f"{kind['slug']}.png", small=True)


if __name__ == "__main__":
    wanted = sys.argv[1:]
    for slug, (title, subtitle) in PAGES.items():
        if wanted and slug not in wanted:
            continue
        path = build(slug, title, subtitle)
        print("wrote", path.relative_to(ROOT), path.stat().st_size)
    if not wanted:
        total = 0
        for path in list(build_monsters()) + list(build_weapon_types()):
            total += path.stat().st_size
        print("wrote the monster and weapon type cards,", total // 1024, "KB")
