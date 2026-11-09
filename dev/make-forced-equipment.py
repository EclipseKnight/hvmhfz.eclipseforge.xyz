#!/usr/bin/env python3
"""Writes data/forced-equipment.json: the equipment a custom quest may force (the quest builder's "Forced
equipment" section; the API keeps a copy as src/main/resources/quest/forced-equipment.json and refuses anything
else).

Why a list: the game looks a forced piece up by its id in its equipment tables without a bounds check (hvmhfz_re
docs/quest-files.md, "Forced equipment"), and the tables hold placeholder rows. So only real pieces are offered.

Sources:
  - the FrontierDataTool dumps of the game's equipment tables (as dev/make-equipment-icons.py; their row order is
    the game's id order, checked row by row against the client's mhfdat.bin tables on 2026-11-09):
    a piece is offered when its name is not a placeholder (ダミー, ダミー(弓), 使用禁止, 欠番, empty), a weapon also
    when its class is known, an armour piece also when it is for blademasters, gunners or both;
  - decorations: the decoration ids Capcom's own quest files put in forced equipment (any number of directories of
    decompressed quest files), so only decorations the game is known to take there.

Output (one string per table, index = id, as data/equipment-icons.json):
  "head", "chest", "arms", "waist", "legs": "-" not offered, "a" any hunter, "b" blademaster only, "g" gunner only;
      id 0 ("no piece": the slot is forced empty, as in Capcom's arena quests) is "a".
  "melee", "ranged": "-" not offered, "w" offered; id 0 is not offered.
  "decorations": item ids.

Usage:
  python3 dev/make-forced-equipment.py <folder with Melee.csv, Ranged.csv, Armor.csv> <quest dir> [<quest dir>...]
  (on mhfz-dev: /root/mhfz/frontier_tools/ReFrontier-master/data_dumps, /root/work/api-quest-codec/quests,
  /root/work/re-mhfz/quests-live)
"""
import csv
import json
import os
import struct
import sys

PLACEHOLDERS = {"", "ダミー", "ダミー(弓)", "使用禁止", "欠番"}
CLASSES = {"大剣", "太刀", "片手剣", "双剣", "ハンマー", "狩猟笛", "ランス", "ガンランス", "穿龍棍",
           "スラッシュアックスＦ", "マグネットスパイク", "ライトボウガン", "ヘビィボウガン", "弓"}
SLOTS = [("頭", "head"), ("胴", "chest"), ("腕", "arms"), ("腰", "waist"), ("脚", "legs")]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "forced-equipment.json")


def rows(path):
    with open(path, encoding="shift_jis", errors="replace", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(reader)
        return [dict(zip(header, row)) for row in reader]


def weapons(path):
    out = []
    for i, row in enumerate(rows(path)):
        ok = i > 0 and row.get("name", "").strip() not in PLACEHOLDERS and row.get("classId", "").strip() in CLASSES
        out.append("w" if ok else "-")
    return "".join(out)


def armour(path):
    tables = {slug: [] for _, slug in SLOTS}
    for row in rows(path):
        slug = dict(SLOTS).get(row.get("equipClass", "").strip())
        if slug is None:
            raise SystemExit("unknown armour slot %r" % row.get("equipClass"))
        table = tables[slug]
        blade, gunner = row.get("isBladeEquip") == "True", row.get("isGunnerEquip") == "True"
        if not table:
            table.append("a")  # id 0: no piece
        elif row.get("name", "").strip() in PLACEHOLDERS or not (blade or gunner):
            table.append("-")
        else:
            table.append("a" if blade and gunner else "b" if blade else "g")
    return {slug: "".join(t) for slug, t in tables.items()}


def decorations(dirs):
    """Decoration ids in the active forced-equipment records of the quest files (body +0x5c, 6 x 8 bytes)."""
    found = set()
    for d in dirs:
        for name in sorted(os.listdir(d)):
            with open(os.path.join(d, name), "rb") as f:
                b = f.read()
            if len(b) < 0x200:
                continue
            body = struct.unpack_from("<I", b, 0)[0]
            if body + 0xc4 > len(b):
                continue
            for i in range(6):
                piece, w1, w2, w3 = struct.unpack_from("<4H", b, body + 0x5c + 8 * i)
                if w1 & 0x8000 and not piece & 0x4000:
                    found.update(w & 0x7fff for w in (w1, w2, w3) if w & 0x7fff)
    return sorted(found)


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    dumps, quests = argv[1], argv[2:]
    data = {"about": "The equipment a custom quest may force, by id (as data/equipment-icons.json): placeholder rows"
                     " left out; armour a = any hunter, b = blademaster, g = gunner; decorations = those Capcom's quest"
                     " files force. Written by dev/make-forced-equipment.py; the API keeps a copy."}
    data.update(armour(os.path.join(dumps, "Armor.csv")))
    data["melee"] = weapons(os.path.join(dumps, "Melee.csv"))
    data["ranged"] = weapons(os.path.join(dumps, "Ranged.csv"))
    data["decorations"] = decorations(quests)
    with open(OUT, "w", encoding="utf-8") as out:
        json.dump(data, out, ensure_ascii=False, separators=(",", ":"))
        out.write("\n")
    for key in ("head", "chest", "arms", "waist", "legs", "melee", "ranged"):
        s = data[key]
        print("%s: %d ids, %d offered" % (key, len(s), sum(1 for c in s if c != "-")))
    print("decorations: %d" % len(data["decorations"]))


if __name__ == "__main__":
    main(sys.argv)
