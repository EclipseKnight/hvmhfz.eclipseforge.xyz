#!/usr/bin/env python3
"""Builds the Set builder's data (set-builder.html, js/armor-calc.js) from the armour data hvmhfz_re decoded from
the client (hvmhfz_re docs/armor-builder.md, part 199): every armour piece with what the calculator needs, every
decoration, Road gem (Tower Deco), skill cuff and Tower sigil, the weapons' Zenith skills and Tower flags, the
automatic skills, and the client's skill rules (data/armor/rules.json).

Inputs (all read here, never copied whole; hvmhfz_re is private, its game data may be published here):
  - hvmhfz_re data/armor_rules.json: the rules, the 213 activation rows in priority order, skill names, included
    skills, Zenith tables, defence and slot growth tables. Copied to data/armor/rules.json as it is.
  - hvmhfz_re data/armor_builder.json: armour pieces, decorations, weapons (class, Zenith skill, Tower flag,
    slots), the automatic skill table (the first row of a (type, id) wins).
  - hvmhfz_re data/armor_craft_rank.json (part 200, its docs/armor-builder.md "Rank needed to craft"): the rank at
    which the smithy offers each armour piece and weapon, and the HR bands. Same data_version as the others.
  - hvmhfz_re data/skills_db.json: only the list of weapon Tower sigils and their effect text (armour Tower sigils
    are Tower armour plate items and are left out, as the calculator leaves plates out).
  - dat/mhfdat.bin of the client patch zip, decoded with hvmhfz_re build/unpack_cli: only its SHA-256. The re
    files name the mhfdat.bin they come from (data_version, the first 12 hex digits); the script stops when that is
    not this patch's, so the page, the API's crafting data and the community-sets catalog all use one patch.
  - data/weapons/<type>.json (this site): a weapon's slots must equal the re file's; the script stops if not.

Writes:
  - data/armor/<slot>.json for head, chest, arms, waist, legs: {"_about", "fields", "pieces": [[id, name, rarity,
    defence (level 1), slots (level 1), maxSlots (record +0x1c), [fire, water, thunder, dragon, ice], flags (bit 0
    male, 1 female, 2 blademaster, 3 gunner), maxLevel, [[tree, points]], automatic skill id or 0, obtainable 1/0,
    defGrowth (defence growth row), slotGrowth (slot growth row), limitKind (bit 0 counts as a G-rank piece for the
    skill limit, 1 a Zenith piece, 2 a Tower piece), Zenith skill id or 0, craft]]} (one file per slot, loaded when
    the slot is first opened). Placeholder rows (no name, "dummy") are left out. craft = the rank the smithy needs
    (CRAFT_DOC below) or 0 when the smithy never offers the piece (event, transmog-only and unused pieces).
  - data/armor/weapon-craft.json: {"_about", "melee": {id: craft}, "ranged": {id: craft}} (weapons the smithy
    offers), loaded by the builder's weapon list.
  - data/armor/index.json: {"_about", "version", "source", "res", "flags", "classes", "gunnerClasses",
    "pieceFields", "decorations": [[item, name, kind "d" decoration / "g" Road gem (Tower Deco) / "c" skill cuff,
    slots, [[tree, points]] (the first four pairs: the only ones the game adds), obtainable 1/0, Zenith skill id,
    first tree, first points]], "sigils": [[item, name, effect, [[tree, points]], Zenith skill id, first tree, first
    points]], "weapons": {"melee"|"ranged": {id: [Zenith skill id, Tower 1/0]}} (only weapons with either),
    "weaponAuto": {"melee"|"ranged": {id: skill id}}, "skillNames": {skill id: name}, "rank": {"bands": [[HR cap,
    label]] (band 1-7 in order), "classes": [weapon class names of a GSR gate, the set format's class order]}};
  - data/armor/rules.json: hvmhfz_re data/armor_rules.json plus "_about", "version" and "source".

Usage: python3 dev/make-armor-data.py [--re /root/mhfz/hvmhfz_re] [--zip Frontier_Patch.zip --version 1.29]
Check: NODE_PATH=/root/work/pw-tools/node_modules node dev/check-set-builder.js
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "armor"
DEFAULT_RE = "/root/mhfz/hvmhfz_re"
DEFAULT_ZIP = "/root/backups/client-patch/Frontier_Patch-bdedc291.zip"
DEFAULT_VERSION = "1.29"
FORMAT_VERSION = 1   # hvmhfz_re docs/armor-builder.md "Data format"

SLOTS = ("head", "chest", "arms", "waist", "legs")
RES = ("fire", "water", "thunder", "dragon", "ice")   # record order, +0x14..+0x18
FLAGS = {"male": 1, "female": 2, "blademaster": 4, "gunner": 8}
DECO_KIND = {"decoration": "d", "road-gem": "g"}
DUMMY_NAMES = ("", "dummy", "ダミー")
PIECE_FIELDS = ["id", "name", "rarity", "defence", "slots", "maxSlots", "res", "flags", "maxLevel", "skills", "auto",
                "obtainable", "defGrowth", "slotGrowth", "limitKind", "zenith", "craft"]
LIMIT_KIND = (("g_piece", 1), ("z_piece", 2), ("tower_piece", 4))
# Automatic skill table types (hvmhfz_re: 0 legs, 2 head, 3 chest, 4 arms, 5 waist, 6 melee, 7 ranged)
AUTO_TYPE = {"legs": 0, "head": 2, "chest": 3, "arms": 4, "waist": 5, "melee": 6, "ranged": 7}

# The craft rank of a piece or weapon, from hvmhfz_re armor_craft_rank.json (piece_columns rank, value, band, how,
# gsr): [rank "hr" | "gr", value (HR cap row rank or GR), band (HR band 1-7; 7 for "gr"), how (first letter: r rank,
# m materials, o open, g gsr, u upgrade)] plus [GSR weapon class, GSR level] for a piece behind a GSR gate.
CRAFT_DOC = "[rank hr|gr, value, band 1-7, how r|m|o|g|u] (+ [GSR class, GSR level])"
CRAFT_FORMAT, CRAFT_VERSION = "hvmhfz craft rank", 1
CRAFT_HOW = {"rank": "r", "materials": "m", "open": "o", "gsr": "g", "upgrade": "u"}

# Weapon classes, the game's index (weapon record +3 / +4; dev/make-weapons-data.py SLUGS). Gunner: 1, 5, 10.
CLASSES = ("great-sword", "heavy-bowgun", "hammer", "lance", "sword-and-shield", "light-bowgun", "dual-swords",
           "long-sword", "hunting-horn", "gunlance", "bow", "tonfa", "switch-axe-f", "magnet-spike")
GUNNER = (1, 5, 10)
# skills_db.json sigil families: weapon Tower Sigils (天封印) go in a Tower weapon's sigil places; armour Tower
# Sigils (天刻印) are Tower armour plate items, which hvmhfz_re has not decoded (docs/armor-builder.md).
WEAPON_SIGIL = "weapon Tower Sigil"


def is_dummy(name):
    return name.strip().strip("－-").lower() in DUMMY_NAMES


def merged(pairs):
    """[[tree, points]], a tree listed twice added up (the game adds both), zero sums left out."""
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


def rows(doc, part, columns):
    cols = doc[columns]
    return [dict(zip(cols, r)) for r in doc[part]]


def automatic(builder):
    """{(type, id): skill}: the first row of a (type, id) wins, as in the game (0x10baf7f0)."""
    out = {}
    for typ, eid, skill in builder["automatic"]:
        out.setdefault((typ, eid), skill)
    return out


def craft_value(row, cols):
    """One craft rank row of armor_craft_rank.json -> the site's craft value (CRAFT_DOC), 0 when it has no stage."""
    c = dict(zip(cols, row))
    if c["rank"] is None:
        return 0
    if c["rank"] not in ("hr", "gr") or c["how"] not in CRAFT_HOW:
        sys.exit("armor_craft_rank.json: unknown rank %r or how %r (id %r)" % (c["rank"], c["how"], c["id"]))
    out = [c["rank"], c["value"], c["band"] if c["rank"] == "hr" else 7, CRAFT_HOW[c["how"]]]
    if c["gsr"]:
        out += list(c["gsr"])
    return out


def craft_ranks(craft):
    """{(slot or weapon kind, id): craft value} from armor_craft_rank.json."""
    cols = craft["piece_columns"]
    out = {}
    for part in ("armour", "weapons"):
        for kind, rows in craft[part].items():
            for r in rows:
                out[(kind, r[0])] = craft_value(r, cols)
    return out


def build_pieces(builder, auto, craft):
    """{slot: [row]} in id order."""
    out = {}
    cols = builder["armour_columns"]
    for slot in SLOTS:
        pieces = []
        for raw in sorted(builder["armour"][slot], key=lambda r: r[0]):
            a = dict(zip(cols, raw))
            if is_dummy(a["name"]):
                continue
            limit_kind = sum(bit for key, bit in LIMIT_KIND if a[key])
            pieces.append([a["id"], a["name"], a["rarity"], a["defence"], a["slots"], a["max_slots"], a["resist"],
                           a["flags"] & 0x0F, max(1, a["max_level"]), merged(a["skills"]),
                           auto.get((AUTO_TYPE[slot], a["id"]), 0), 1 if a["obtainable"] else 0,
                           a["def_growth"], a["slot_growth"], limit_kind, a["zenith"], craft[(slot, a["id"])]])
        out[slot] = pieces
    return out


def check_weapons(builder):
    """The site's weapon lists and the re file must agree on class and slots: the calculator reads a Tower
    weapon's slots as its sigil places."""
    re_rows = {(kind, r[0]): r for kind, rs in builder["weapons"].items() for r in rs}
    types = json.loads((ROOT / "data/weapons/index.json").read_text(encoding="utf-8"))["types"]
    bad = []
    for t in types:
        data = json.loads((ROOT / "data/weapons" / (t["slug"] + ".json")).read_text(encoding="utf-8"))
        f = {name: i for i, name in enumerate(data["fields"])}
        kind = "melee" if data["kind"] == "melee" else "ranged"
        for w in data["weapons"]:
            r = re_rows.get((kind, w[f["id"]]))
            if not r or r[1] != t["class"] or r[4] != (w[f["slots"]] or 0):
                bad.append((kind, w[f["id"]]))
    if bad:
        sys.exit("data/weapons and hvmhfz_re armor_builder.json disagree on %d weapons (first %r): rebuild the "
                 "weapons data from the same patch" % (len(bad), bad[:3]))


def build_index(builder, db, auto, version, source, rules, craft_doc):
    decorations = []
    by_item = {}
    for d in rows(builder, "decorations", "decoration_columns"):
        by_item[d["item"]] = d
        kind = "c" if d["slots"] == 0 else DECO_KIND.get(d["kind"])
        if not kind or is_dummy(d["name"]):
            continue
        decorations.append([d["item"], d["name"], kind, d["slots"], merged(d["skills"]), 1 if d["obtainable"] else 0,
                            d["zenith"], d["first_tree"], d["first_points"]])
    decorations.sort(key=lambda r: r[0])
    sigils = []
    for s in sorted(db["sigils"], key=lambda r: r["item"]):
        if WEAPON_SIGIL not in s["family"]:
            continue    # armour Tower Sigils are Tower armour plate items: left out until plates are decoded
        d = by_item.get(s["item"])
        if not d:
            sys.exit("Tower sigil %d (%s) is not in armor_builder.json" % (s["item"], s["name"]))
        sigils.append([s["item"], s["name"], s["effect"], merged(d["skills"]), d["zenith"], d["first_tree"],
                       d["first_points"]])
    weapons = {"melee": {}, "ranged": {}}
    weapon_auto = {"melee": {}, "ranged": {}}
    for kind, rs in builder["weapons"].items():
        for wid, _cls, zenith, tower, _slots in rs:
            if zenith or tower:
                weapons[kind][str(wid)] = [zenith, tower]
            skill = auto.get((AUTO_TYPE[kind], wid))
            if skill:
                weapon_auto[kind][str(wid)] = skill
    return {
        "_about": "dev/make-armor-data.py: decorations, Road gems (Tower Decos), skill cuffs, Tower sigils, weapon "
                  "Zenith skills, Tower flags and automatic skills for the Set builder; armour pieces are in "
                  "data/armor/<slot>.json. docs/armor-set-builder.md",
        "version": version, "source": source, "res": list(RES), "flags": FLAGS, "classes": list(CLASSES),
        "gunnerClasses": list(GUNNER), "pieceFields": PIECE_FIELDS,
        "decorations": decorations, "sigils": sigils, "weapons": weapons, "weaponAuto": weapon_auto,
        "skillNames": {k: v["name"] for k, v in sorted(rules["skills"].items(), key=lambda kv: int(kv[0]))},
        "rank": {"bands": craft_doc["hr_bands"], "classes": craft_doc["weapon_classes"]},
    }


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--re", default=DEFAULT_RE, help="hvmhfz_re checkout (data/armor_*.json, build/unpack_cli)")
    ap.add_argument("--zip", default=DEFAULT_ZIP, help="client patch zip (Frontier_Patch/dat/mhfdat.bin)")
    ap.add_argument("--version", default=DEFAULT_VERSION, help="that patch's public version (data/patch-versions.json)")
    args = ap.parse_args(argv)
    re_root = pathlib.Path(args.re)

    def load(name):
        return json.loads((re_root / "data" / name).read_text(encoding="utf-8"))

    rules, builder, db = load("armor_rules.json"), load("armor_builder.json"), load("skills_db.json")
    craft_doc = load("armor_craft_rank.json")
    dat = decode_dat(re_root, args.zip)
    sha = hashlib.sha256(dat).hexdigest()
    if craft_doc.get("format") != CRAFT_FORMAT or craft_doc.get("format_version") != CRAFT_VERSION:
        sys.exit("armor_craft_rank.json is %r version %r, this script reads %r version %d"
                 % (craft_doc.get("format"), craft_doc.get("format_version"), CRAFT_FORMAT, CRAFT_VERSION))
    for name, doc in (("armor_rules.json", rules), ("armor_builder.json", builder), ("armor_craft_rank.json", craft_doc)):
        if name != "armor_craft_rank.json" and doc.get("format_version") != FORMAT_VERSION:
            sys.exit("%s is format_version %r, this script reads %d" % (name, doc.get("format_version"), FORMAT_VERSION))
        if doc.get("data_version") != sha[:12]:
            sys.exit("%s comes from mhfdat.bin %s, the patch zip's is %s: rebuild hvmhfz_re's armour data from this "
                     "patch (its docs/armor-builder.md)" % (name, doc.get("data_version"), sha[:12]))
    check_weapons(builder)

    version = "v" + args.version
    re_head = subprocess.run(["git", "-C", str(re_root), "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True).stdout.strip()
    source = {"patch": version, "zip": pathlib.Path(args.zip).name, "mhfdatSha256": sha,
              "armorData": "hvmhfz_re " + re_head + " data/armor_builder.json, data/armor_rules.json, "
                           "data/armor_craft_rank.json",
              "script": "dev/make-armor-data.py"}

    auto = automatic(builder)
    craft = craft_ranks(craft_doc)
    missing = [(slot, r[0]) for slot in SLOTS for r in builder["armour"][slot] if (slot, r[0]) not in craft]
    if missing:
        sys.exit("armor_craft_rank.json has no row for %d armour pieces (first %r)" % (len(missing), missing[:3]))
    pieces = build_pieces(builder, auto, craft)
    for slot, rs in pieces.items():
        write(OUT / (slot + ".json"), {"_about": "dev/make-armor-data.py: every %s armour piece; fields below, "
                                                 "res in the order of index.json res" % slot,
                                       "fields": PIECE_FIELDS, "pieces": rs})
    write(OUT / "index.json", build_index(builder, db, auto, version, source, rules, craft_doc))
    write(OUT / "weapon-craft.json", {
        "_about": "dev/make-armor-data.py: the rank the smithy needs per weapon id (hvmhfz_re data/armor_craft_rank.json); "
                  "value " + CRAFT_DOC + "; weapons the smithy never offers are left out. docs/armor-set-builder.md",
        "version": version,
        "melee": {str(k[1]): v for k, v in sorted(craft.items()) if k[0] == "melee" and v},
        "ranged": {str(k[1]): v for k, v in sorted(craft.items()) if k[0] == "ranged" and v}})
    site_rules = {"_about": "The client's skill rules for js/armor-rules.js: hvmhfz_re data/armor_rules.json as it "
                            "is (format: its docs/armor-builder.md \"Data format\"), written by dev/make-armor-data.py.",
                  "version": version, "source": source}
    site_rules.update({k: v for k, v in rules.items() if k != "_about"})
    write(OUT / "rules.json", site_rules)
    print("armour: " + ", ".join("%s %d" % (s, len(r)) for s, r in pieces.items())
          + "; data " + sha[:12] + " (" + version + ")")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
