#!/usr/bin/env python3
"""Writes data/equipment-icons.json: what icon each piece of equipment gets on the site.

In the game an equipment icon is a sprite for its type (a weapon class, or an armour slot) tinted with
its rarity colour. The save (and the API's /details) only gives a piece's kind, slot and id, so this
file holds, per id, the weapon class and the rarity; js/game-icons.js turns them into the icon.

Source: the FrontierDataTool dumps of the game's equipment tables (mhfdat.bin, "as of Z Zenith"),
tab-separated in Shift-JIS, one row per id in id order:

  Melee.csv   columns name, modelId, modelIdData, rarity, classId, ...   (row 0 is id 0)
  Ranged.csv  columns name, modelId, modelIdData, rarity, maxSlotsMaybe, classId, ...
  Armor.csv   columns equipClass, name, ..., rarity (13th), ...; the five slots one after the other
              (head, chest, arms, waist, legs), each starting again at id 0

Checked on 2026-11-09 against the server's equipment_* tables: same counts (head 14,595 rows for 14,594
named ids plus id 0, legs 13,515 / 13,514, ranged 4,224 / 4,223) and the same pieces at ids 1, 3, 10,
1000, 4096, 8192 and 12288 (e.g. melee 1 Iron Sword, 4096 Perle Himmel; ranged 1000 Scale Mortar;
head 1000 PV Glasses SP Red).

Output (compact, one string per table, index = id):
  "classes": weapon class slugs, the file names of assets/weapons/<slug>.png
  "melee", "ranged": two characters per id: the class's index in "classes" and the rarity, both base 36
  "head", "chest", "arms", "waist", "legs": one character per id: the rarity, base 36
  rarity is the game's stored value, 0-11 (shown in game as RARE 1-12); "-" = unknown.

Usage:
  python3 dev/make-equipment-icons.py <folder with Melee.csv, Ranged.csv, Armor.csv> [out.json]
  (on mhfz-dev: /root/mhfz/frontier_tools/ReFrontier-master/data_dumps)
"""
import csv
import json
import os
import sys

# The dumps' Japanese class names, to the weapon sprites in assets/weapons/.
CLASSES = {
    "大剣": "great-sword",
    "太刀": "long-sword",
    "片手剣": "sword-and-shield",
    "双剣": "dual-blades",
    "ハンマー": "hammer",
    "狩猟笛": "hunting-horn",
    "ランス": "lance",
    "ガンランス": "gunlance",
    "穿龍棍": "tonfa",
    "スラッシュアックスＦ": "switch-axe",
    "マグネットスパイク": "magnet-spike",
    "ライトボウガン": "light-bowgun",
    "ヘビィボウガン": "heavy-bowgun",
    "弓": "bow",
}
SLOTS = [("頭", "head"), ("胴", "chest"), ("腕", "arms"), ("腰", "waist"), ("脚", "legs")]
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"


def rows(path):
    with open(path, encoding="shift_jis", errors="replace", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(reader)
        for row in reader:
            yield dict(zip(header, row))


def digit(value):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return "-"
    return DIGITS[n] if 0 <= n < len(DIGITS) else "-"


def weapons(path, order):
    out = []
    for row in rows(path):
        slug = CLASSES.get(row.get("classId", "").strip())
        out.append((DIGITS[order.index(slug)] if slug else "-") + digit(row.get("rarity")))
    return "".join(out)


def armour(path):
    tables = {slug: [] for _, slug in SLOTS}
    names = dict(SLOTS)
    for row in rows(path):
        slug = names.get(row.get("equipClass", "").strip())
        if slug is None:
            sys.exit("Armor.csv: unknown equipClass %r" % row.get("equipClass"))
        tables[slug].append(digit(row.get("rarity")))
    return {slug: "".join(values) for slug, values in tables.items()}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    folder = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "data", "equipment-icons.json")
    order = list(dict.fromkeys(CLASSES.values()))
    data = {
        "about": "Weapon class and rarity per equipment id, from the game's equipment tables (Z Zenith); "
                 "written by dev/make-equipment-icons.py, read by js/game-icons.js.",
        "classes": order,
        "melee": weapons(os.path.join(folder, "Melee.csv"), order),
        "ranged": weapons(os.path.join(folder, "Ranged.csv"), order),
    }
    data.update(armour(os.path.join(folder, "Armor.csv")))
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print("wrote %s: melee %d, ranged %d, %s" % (out, len(data["melee"]) // 2, len(data["ranged"]) // 2,
          ", ".join("%s %d" % (slug, len(data[slug])) for _, slug in SLOTS)))


if __name__ == "__main__":
    main()
