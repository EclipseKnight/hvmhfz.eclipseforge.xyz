#!/usr/bin/env python3
"""Builds the Set builder's data (set-builder.html, js/armor-calc.js): every armour piece with its defence,
resistances, slots, who can wear it and its skills; every decoration, Road gem, skill cuff and Tower sigil; the
weapons' automatic skills; and the skill rules (data/armor/rules.json).

Inputs (all read here, never copied; hvmhfz_re is private):
  - hvmhfz_re data/skills_db.json: armour names, rarity, skill points, obtainable; decorations (slots, points);
    automatic skills; Tower sigils (the same input as dev/make-skill-data.py, so the two pages agree).
  - dat/mhfdat.bin of the live client patch zip, decoded with hvmhfz_re build/unpack_cli: the armour records
    (0x48 bytes; head 0x50, chest 0x54, arms 0x58, waist 0x5c, legs 0x60; hvmhfz_re
    tools/items/unobtainable_details.py and docs/designs 2026-11-15-armor-set-builder.md section 1):
      +4 bits 0 male, 1 female, 2 blademaster, 3 gunner (medium: legs split into blademaster and gunner pieces,
         most heads and chests take both)
      +5 & 0xf rarity - 1, +6 max level, +0x12 u16 defence at level 1,
      +0x14..+0x18 s8 resistances fire, water, thunder, dragon, ice (medium),
      +0x1b slots, +0x1c slots at the top level (medium), +0x2a five (u8 tree, s8 points).
    The record's skills are checked against skills_db.json: a mismatch means the two come from different
    patches, and the script stops.
  - data/skills/index.json (this site): skill tree categories, for the fallback weapon rules.

Writes:
  - data/armor/<slot>.json for head, chest, arms, waist, legs: {"_about", "fields", "pieces": [[id, name, rarity,
    defence, slots, top-level slots, [fire, water, thunder, dragon, ice], flags, max level, [[tree, points]],
    [automatic skill ids], obtainable 1/0]]} (one file per slot, loaded when the slot is first opened);
  - data/armor/index.json: {"_about", "version", "source", "res", "flags", "decorations": [[item, name, kind "d"
    decoration / "g" Road gem (Tower Deco) / "c" skill cuff, slots, [[tree, points]], obtainable 1/0]], "sigils":
    [[item, name, effect]], "weaponAuto": {"melee"|"ranged": {id: [skill ids]}}, "skillNames": {skill id: name}};
  - data/armor/rules.json: the skill rules js/armor-rules.js reads (format in docs/armor-set-builder.md). Until
    hvmhfz_re lane A decodes them from the client, this is a FALLBACK marked "exact": false: active skill limit 10
    with nothing dropped, Hiden ("Tech") trees work only with their weapon, Blademaster and Gunner trees only with
    that kind of weapon (data/skill_categories.tsv), no Zenith skills, defence at level 1 for every level, the
    top-level slots only at the max level, 2 cuff slots, and the defence and resistance skills read from their names.
    TODO(lane A): when hvmhfz_re data/armor_builder.json exists, run with --rules <its rules file> to copy the
    decoded rules instead (same format; the script checks the required keys).

Usage: python3 dev/make-armor-data.py [--re /root/mhfz/hvmhfz_re] [--zip Frontier_Patch.zip --version 1.29]
                                      [--rules decoded-rules.json]
Check: NODE_PATH=/root/work/pw-tools/node_modules node dev/check-set-builder.js
"""
import argparse
import hashlib
import json
import pathlib
import re
import struct
import subprocess
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "armor"
DEFAULT_RE = "/root/mhfz/hvmhfz_re"
DEFAULT_ZIP = "/root/backups/client-patch/Frontier_Patch-bdedc291.zip"
DEFAULT_VERSION = "1.29"

ARMOUR = (("head", 0x50), ("chest", 0x54), ("arms", 0x58), ("waist", 0x5C), ("legs", 0x60))
RECORD = 0x48
RES = ("fire", "water", "thunder", "dragon", "ice")   # record order, +0x14..+0x18
FLAGS = {"male": 1, "female": 2, "blademaster": 4, "gunner": 8}
DECO_KIND = {"decoration": "d", "road-gem": "g"}
DUMMY_NAMES = ("", "dummy", "ダミー")
PIECE_FIELDS = ["id", "name", "rarity", "defence", "slots", "topSlots", "res", "flags", "maxLevel", "skills", "auto",
                "obtainable"]

# Weapon classes, the game's index (weapon record +3 / +4; dev/make-weapons-data.py SLUGS). Gunner: 1, 5, 10.
CLASSES = ("great-sword", "heavy-bowgun", "hammer", "lance", "sword-and-shield", "light-bowgun", "dual-swords",
           "long-sword", "hunting-horn", "gunlance", "bow", "tonfa", "switch-axe-f", "magnet-spike")
GUNNER = (1, 5, 10)
# Hiden ("Tech") trees -> the weapon class they belong to, by the tree's name (data/skill_categories.tsv puts the
# 14 of them in "Hiden Skills"). Fallback rule: no effect with any other class.
TECH_PREFIX = {"GS": 0, "HBG": 1, "Hammer": 2, "Lance": 3, "SnS": 4, "LBG": 5, "DS": 6, "LS": 7, "HH": 8, "GL": 9,
               "Bow": 10, "Tonfa": 11, "AS F": 12, "MS": 13}
RES_SKILL = re.compile(r"^(Fire|Water|Thunder|Dragon|Ice|All) Res(?: Up)? ?([+-]\d+)$")
DEF_SKILL = re.compile(r"^Defense ?([+-]\d+)$")
RULE_KEYS = ("version", "exact", "source", "skillLimit", "overLimit", "weapon", "zenith", "levels", "cuffSlots",
             "bonuses")


def is_dummy(name):
    return name.strip().strip("－-").lower() in DUMMY_NAMES


def merged(pairs):
    """[[tree, points]], a tree listed twice on one piece added up (as dev/make-skill-data.py does)."""
    out = {}
    for tree, pts in pairs:
        out[tree] = out.get(tree, 0) + pts
    return [[t, p] for t, p in out.items() if p]


def decode_dat(re_root, zip_path):
    unpack = re_root / "build" / "unpack_cli"
    if not unpack.exists():
        sys.exit("build/unpack_cli is missing: run make build/unpack_cli in " + str(re_root))
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(zip_path) as z:
        enc = pathlib.Path(tmp) / "enc-mhfdat.bin"
        enc.write_bytes(z.read("Frontier_Patch/dat/mhfdat.bin"))
        dst = pathlib.Path(tmp) / "mhfdat.bin"
        with open(dst, "wb") as out:
            subprocess.run([str(unpack), str(enc)], stdout=out, stderr=subprocess.DEVNULL, check=True)
        return dst.read_bytes()


def record(dat, slot_offset, piece_id):
    """The numbers of one armour record (layout in the docstring)."""
    base = struct.unpack_from("<I", dat, slot_offset)[0]
    o = base + RECORD * piece_id
    return {
        "flags": dat[o + 4] & 0x0F, "rarity": (dat[o + 5] & 0x0F) + 1, "maxLevel": dat[o + 6],
        "defence": struct.unpack_from("<H", dat, o + 0x12)[0], "res": list(struct.unpack_from("5b", dat, o + 0x14)),
        "slots": dat[o + 0x1B], "topSlots": max(dat[o + 0x1B], dat[o + 0x1C]),
        "skills": merged([(dat[o + 0x2A + 2 * k], struct.unpack_from("b", dat, o + 0x2B + 2 * k)[0])
                          for k in range(5) if dat[o + 0x2A + 2 * k]]),
    }


def build_pieces(db, dat):
    """{slot: [row]} in id order; stops when a record's skills disagree with skills_db.json."""
    auto = {}
    for a in db["automatic"]:
        auto.setdefault((a["slot"], a["id"]), []).append(a["skill"])
    offsets = dict(ARMOUR)
    out = {slot: [] for slot, _ in ARMOUR}
    mismatch = []
    for a in sorted(db["armour"], key=lambda r: (r["slot"], r["id"])):
        if a["slot"] not in offsets or is_dummy(a["name"]):
            continue
        r = record(dat, offsets[a["slot"]], a["id"])
        skills = merged(a["skills"])
        if sorted(map(tuple, skills)) != sorted(map(tuple, r["skills"])):
            mismatch.append((a["slot"], a["id"], a["name"]))
        out[a["slot"]].append([a["id"], a["name"], r["rarity"], r["defence"], r["slots"], r["topSlots"], r["res"],
                               r["flags"], max(1, r["maxLevel"]), skills, auto.get((a["slot"], a["id"]), []),
                               1 if a["obtainable"] else 0])
    if mismatch:
        sys.exit("armour skills differ between mhfdat and skills_db.json (different patches?): %d, first %r"
                 % (len(mismatch), mismatch[:3]))
    return out


def build_index(db, version, source):
    decorations = []
    for d in sorted(db["decorations"], key=lambda r: r["item"]):
        kind = "c" if d["slots"] == 0 else DECO_KIND.get(d["kind"])
        if not kind or is_dummy(d["name"]):
            continue
        decorations.append([d["item"], d["name"], kind, d["slots"], merged(d["skills"]), 1 if d["obtainable"] else 0])
    weapon_auto = {"melee": {}, "ranged": {}}
    for a in db["automatic"]:
        if a["slot"] in weapon_auto:
            weapon_auto[a["slot"]].setdefault(str(a["id"]), []).append(a["skill"])
    return {
        "_about": "dev/make-armor-data.py: decorations, Road gems (Tower Decos), skill cuffs and Tower sigils for the "
                  "Set builder; armour pieces are in data/armor/<slot>.json. docs/armor-set-builder.md",
        "version": version, "source": source, "res": list(RES), "flags": FLAGS, "classes": list(CLASSES),
        "gunnerClasses": list(GUNNER), "pieceFields": PIECE_FIELDS,
        "decorations": decorations,
        "sigils": [[s["item"], s["name"], s["effect"]] for s in sorted(db["sigils"], key=lambda r: r["item"])],
        "weaponAuto": weapon_auto,
        "skillNames": {k: v["name"] for k, v in sorted(db["skills"].items(), key=lambda kv: int(kv[0]))},
    }


def fallback_rules(skill_index, version):
    """The rules until lane A decodes them (each part says what it stands in for)."""
    tech, blade, gunner = {}, [], []
    for tree in skill_index["trees"]:
        tid, name, category = tree[0], tree[1], tree[2]
        if category == "Hiden Skills":
            prefix = name[:-len(" Tech")] if name.endswith(" Tech") else None
            if prefix not in TECH_PREFIX:
                sys.exit("Hiden tree without a known weapon: %r" % name)
            tech[str(tid)] = [TECH_PREFIX[prefix]]
        elif category == "Blademaster":
            blade.append(tid)
        elif category == "Gunner":
            gunner.append(tid)
    bonuses = {}
    for tree in skill_index["trees"]:
        for _pts, skill, sname in tree[3]:
            m = RES_SKILL.match(sname)
            if m:
                n = int(m.group(2))
                res = [n if m.group(1) in ("All", r.capitalize()) else 0 for r in RES]
                bonuses[str(skill)] = {"res": res}
            m = DEF_SKILL.match(sname)
            if m:
                bonuses[str(skill)] = {"defence": int(m.group(1))}
    return {
        "_about": "Skill rules for js/armor-rules.js; format in docs/armor-set-builder.md.",
        "version": version,
        "exact": False,
        "source": "fallback from dev/make-armor-data.py; TODO(lane A): replace with the rules decoded from the "
                  "client (hvmhfz_re data/armor_builder.json) with --rules",
        "skillLimit": {"base": 10, "exact": False,
                       "note": "The game's limit and what raises it (G-rank pieces, Zenith Skill Slots Up, cuffs) "
                               "are not decoded yet."},
        "overLimit": {"known": False,
                      "note": "Which skills the game drops over the limit is not decoded yet; none are dropped here."},
        "weapon": {"exact": False, "treeClasses": tech, "blademasterTrees": sorted(blade),
                   "gunnerTrees": sorted(gunner), "gunnerClasses": list(GUNNER),
                   "note": "From the skill list's categories (Blademaster, Gunner, Hiden), not from the game's code."},
        "zenith": {"known": False, "skills": [],
                   "note": "Zenith skills are not decoded yet and are not counted."},
        "levels": {"exact": False, "defencePerLevel": None, "topSlotsAt": "max",
                   "note": "Defence growth by armour level is not decoded yet: defence is the level 1 value. The "
                           "top-level slots are counted only at the piece's max level."},
        "cuffSlots": 2,
        "bonuses": {"exact": False, "skills": bonuses,
                    "note": "Defence and resistance skills, read from their names (Defense+20, Fire Res+10)."},
    }


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--re", default=DEFAULT_RE, help="hvmhfz_re checkout (data/skills_db.json, build/unpack_cli)")
    ap.add_argument("--zip", default=DEFAULT_ZIP, help="client patch zip (Frontier_Patch/dat/mhfdat.bin)")
    ap.add_argument("--version", default=DEFAULT_VERSION, help="that patch's public version (data/patch-versions.json)")
    ap.add_argument("--rules", help="decoded rules JSON (lane A) to use instead of the fallback")
    args = ap.parse_args(argv)
    re_root = pathlib.Path(args.re)
    db = json.loads((re_root / "data" / "skills_db.json").read_text(encoding="utf-8"))
    dat = decode_dat(re_root, args.zip)
    version = "v" + args.version
    re_head = subprocess.run(["git", "-C", str(re_root), "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True).stdout.strip()
    source = {"patch": version, "zip": pathlib.Path(args.zip).name,
              "mhfdatSha256": hashlib.sha256(dat).hexdigest(), "skillsDb": "hvmhfz_re " + re_head,
              "script": "dev/make-armor-data.py"}

    pieces = build_pieces(db, dat)
    for slot, rows in pieces.items():
        write(OUT / (slot + ".json"), {"_about": "dev/make-armor-data.py: every %s armour piece; fields below, "
                                                 "res in the order of index.json res" % slot,
                                       "fields": PIECE_FIELDS, "pieces": rows})
    write(OUT / "index.json", build_index(db, version, source))

    if args.rules:
        rules = json.loads(pathlib.Path(args.rules).read_text(encoding="utf-8"))
        missing = [k for k in RULE_KEYS if k not in rules]
        if missing:
            sys.exit("rules file lacks " + ", ".join(missing) + " (format: docs/armor-set-builder.md)")
    else:
        rules = fallback_rules(json.loads((ROOT / "data" / "skills" / "index.json").read_text(encoding="utf-8")),
                               version)
    write(OUT / "rules.json", rules)
    print("armour: " + ", ".join("%s %d" % (s, len(r)) for s, r in pieces.items())
          + "; rules: " + ("decoded" if rules.get("exact") else "fallback"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
