#!/usr/bin/env python3
"""Writes the weapon database and the damage calculator's data: data/weapons/*.json, plus the
reference cases dev/check-weapons.js tests the calculator's formula against (dev/weapons-cases.json).

Why static JSON: the weapons page (weapons.html, js/weapons.js) needs no API; the numbers are the
game's own data files, read with the hvmhfz_re tools (private repo, run here, never copied):

  - dat/mhfdat.bin and dat/mhfpac.bin from a client patch zip (weapons, sharpness bars and
    multipliers, the shown-attack factors, the per-class Charge Attack Up list, the client's English
    weapon and skill names). Decoded with hvmhfz_re build/unpack_cli.
  - dat/mhfsdt.bin from the game client (our patch does not ship it): the motion values per hit.
  - tools/weapons/weapons.py reads the weapons, moves.py the moves (and their crit roll, which the
    reference cases below use), styles.py the styles and the community move names (guesses by MV).

The formula and every constant: hvmhfz_re docs/weapons.md sections 4 (attack build-up), 5 (the hit,
crits) and 7.6 (skill names). Where that doc leaves a detail open, the choice is written next to the
constant in index.json ("notes") and on the page.

  python3 dev/make-weapons-data.py                       # the defaults below (patch v1.19)
  python3 dev/make-weapons-data.py --zip Frontier_Patch.zip --version 1.21 --re /path/to/hvmhfz_re

Run it again when a client patch changes dat/mhfdat.bin (weapons.md section 8: balance changes ship
there), then node dev/check-weapons.js.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "weapons"
CASES = ROOT / "dev" / "weapons-cases.json"
DEFAULT_RE = "/root/mhfz/hvmhfz_re"
DEFAULT_ZIP = "/root/backups/client-patch/Frontier_Patch-6d4023f6.zip"
DEFAULT_VERSION = "1.19"
DEFAULT_SDT = "/root/mhfz/frontier_tools/Monster Hunter Frontier Client/Monster Hunter Frontier Online/dat/mhfsdt.bin"

# Class index (melee +0x03 / ranged +0x04) -> page slug and name. Order = weapons.py CLASSES.
SLUGS = ("great-sword", "heavy-bowgun", "hammer", "lance", "sword-and-shield", "light-bowgun",
         "dual-swords", "long-sword", "hunting-horn", "gunlance", "bow", "tonfa", "switch-axe-f",
         "magnet-spike")
RANGED = (1, 5, 10)
BOWGUNS = (1, 5)
COLOURS = ("Red", "Orange", "Yellow", "Green", "Blue", "White", "Purple", "Sky")
# The panel's bar colours, DLL 0x11881f14 (ARGB), read from mhfo-hd.dll (docs/weapons.md section 3).
SHARP_RGB = ("#c50f3a", "#e85218", "#f3c832", "#5ed300", "#3068ee", "#f0f0f0", "#de7aff", "#86f4f4")
# Records the Fencing+2 x1.2 applies to (docs/weapons.md section 5 step 5, 0x111d91c0): Tonfa kind 100
# in any style; Long Sword kind 0 only in Storm and Extreme, and only in one weapon state.
FENCING = {"tonfa": {"kind": 100, "ids": [40, 42, 44, 46], "styles": "EHSX"},
           "long-sword": {"kind": 0, "ids": [158, 159, 160, 161, 162, 250, 251, 252, 253, 263, 264],
                          "styles": "SX"}}
# Weapon technique skill: the first id of each class's four (docs/weapons.md section 4); id + n is level 4 - n.
TECH_BASE = (0x139, 0x151, 0x141, 0x149, 0x131, 0x155, 0x135, 0x13D, 0x145, 0x14D, 0x159, 0x1D2, 0x1FA, 0x212)
SKILL_IDS = {"critEye": [0x23, 0x24, 0x25, 0x11C, 0x11D], "starvingWolf": 0xFC, "ceaseless": 0x208,
             "fencing": 0x170, "chargeUp": [0x1C7, 0x1C8], "adrenaline": 0xB4, "worry": 0xB5}
# Internal names the client keeps for unused records: "Dummy...", "<hex id>・<name>", "...使用禁止" (do not use).
HIDDEN_NAME = re.compile(r"^(Dummy|Nothing Equipped$)|^[0-9A-F]{3,4}[・･]|使用禁止")


def f32(x):
    return MOVES.f32(x)


def decode(unpack, src, dst):
    with open(dst, "wb") as out:
        subprocess.run([str(unpack), str(src)], stdout=out, stderr=subprocess.DEVNULL, check=True)
    return pathlib.Path(dst).read_bytes()


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def pac_text(pac, slot, index):
    """Entry `index` of an mhfpac string table (slot = u32 offset of a u32 pointer list), cp932."""
    import struct
    table = struct.unpack_from("<I", pac, slot)[0]
    start = struct.unpack_from("<I", pac, table + 4 * index)[0]
    return pac[start:pac.index(b"\0", start)].decode("cp932", "replace")


def listed(row):
    """A weapon the database lists: a name the game shows and a real attack."""
    return bool(row["name"]) and row["attack"] > 0 and not HIDDEN_NAME.search(row["name"])


def melee_rows(rows, fac):
    out = []
    for r in rows:
        if not listed(r):
            continue
        out.append([r["id"], r["name"], (r["rarity"] & 15) + 1, r["attack"], WEAPONS.shown_attack(r, fac),
                    r["affinity"], WEAPONS.element_name(r["element"]), r["element_value"],
                    WEAPONS.status_name(r["status"]), r["status_value"], r["slots"], r["sharpness"],
                    special_name(r), r["defense"]])
    return out


def special_name(r):
    """The special byte as weapons.py names it (GL shell, SAF phial); a horn's note set by number."""
    if r["class"] == 8:
        return "Notes %d" % r["special"]
    return WEAPONS.enrich([dict(r)], FACTORS)[0]["special_name"]


def ranged_rows(rows, fac, cls, charge):
    out = []
    for r in rows:
        if not listed(r) or r["class"] != cls:
            continue
        base = [r["id"], r["name"], (r["rarity"] & 15) + 1, r["attack"], WEAPONS.shown_attack(r, fac),
                r["affinity"], r["slots"], r["defense"]]
        if cls == 10:   # bows: element at +0x21, value at +0x22 (weapons.py, a guess matched by names)
            base += [WEAPONS.element_name(r.get("element", 0)), r.get("element_value", 0)]
            levels = charge.get(r["charge_row"], [])
            base += [" / ".join(levels), WEAPONS.ARC_SHOTS[r["arc_shot"]] if r["arc_shot"] < 4 else ""]
        else:
            base += [r["recoil"], r["reload"]]
        out.append(base)
    return out


def move_rows(rows, short):
    out = []
    for r in rows:
        if short not in r["weapons"]:
            continue
        m = {"set": r["set"], "kind": r["kind"], "id": r["id"], "mv": r["chain_mv"], "chain": r["chain"],
             "styles": r.get("styles", {}).get(short, ""), "how": r["weapons"][short]}
        if r["repeats"]:
            m["repeats"] = True
        name = r.get("names", {}).get(short)
        if name:
            m["name"] = name   # community name matched by MV: always a guess (the page says so)
        for key, src in (("element", "element"), ("elementValue", "elem_value"), ("status", "status_kind"),
                         ("ko", "stun")):
            if r[src]:
                m[key] = r[src]
        out.append(m)
    return out


def tech_levels(pac, cls):
    """Weapon technique skills of a class, level 1 (lowest) to 4, with the client's names."""
    names = [pac_text(pac, 0xA1C, TECH_BASE[cls] + n) for n in range(4)]   # id + n = level 4 - n
    return [{"level": 4 - n, "name": names[n]} for n in (3, 2, 1, 0)]


# ---- the reference the calculator must match (docs/weapons.md sections 4 and 5) -------------------
# The crit itself is hvmhfz_re moves.melee_crit / crit_factor (emu-checked against the client); the
# rest follows the doc's formula with the client's single-precision floats. js/weapons-calc.js is the
# same formula in JavaScript; dev/check-weapons.js compares the two on CASES below.

def ref_attack(c):
    """Section 4: weapon + flat, then the multipliers; the build-up stores a u16 (player +0x7aa), so the
    total is whole. Rounding between steps is not mapped: truncated after each multiplier (a choice)."""
    total = c["attack"] + c["flat"]
    for mult in (c["attackMult"], c["techMult"], c["demonMult"]):
        total = int(f32(total * f32(mult)))
    if c["spirit"]:
        total = total * 99 // 80
    return min(total, 3000)


def ref_hit(c, mv, bonus):
    """One hit: (raw no crit, raw crit, raw negative crit, element, crit allowed)."""
    a = f32(ref_attack(c) * f32(0.01))
    mv = mv + bonus
    if c["fencingHit"]:
        mv = int(f32(mv * f32(1.2)))
    sharp = c["sharp"]
    crit_mv = int(f32(mv * MOVES.crit_factor(c["starvingWolf"], f32(CEASELESS[c["ceaseless"]])))) \
        if c["ceaseless"] else MOVES.melee_crit(mv, 100, 0, sharp, c["starvingWolf"])[0]
    neg_mv = MOVES.melee_crit(mv, -100, 0, sharp)[0]

    def raw(m):
        x = f32(f32(f32(m * f32(c["zone"] / 100)) * f32(SHARP[sharp][0])) * a)
        return max(1, int(x))
    elem = 0
    if c["elementValue"] and c["elementZone"]:
        e = f32(f32(c["elementZone"] / 100) * c["elementValue"])
        e = f32(e * f32(SHARP[sharp][1]))
        elem = int(f32(e * f32(c["elementSkill"] / 100)))
    return raw(mv), raw(crit_mv), raw(neg_mv), elem, sharp >= 3


def ref_case(c):
    total = {"nonCrit": 0, "crit": 0, "negCrit": 0, "expected": 0.0}
    aff = max(-100, min(100, c["affinity"]))
    for mv, bonus in zip(c["mv"], c["bonus"]):
        r, rc, rn, e, can = ref_hit(c, mv, bonus)
        p = aff / 100 if can and aff > 0 else 0.0
        q = -aff / 100 if can and aff < 0 else 0.0
        total["nonCrit"] += r + e
        total["crit"] += (rc if can else r) + e
        total["negCrit"] += (rn if can else r) + e
        total["expected"] += (r + e) * (1 - p - q) + (rc + e) * p + (rn + e) * q
    total["attackTotal"] = ref_attack(c)
    total["expected"] = round(total["expected"], 6)
    return total


def make_cases(moves_rows, bonus_by):
    """At least 20 single moves across weapon types, sharpness levels, affinities and skills."""
    by = {(r["kind"], r["id"]): r for r in moves_rows if r["set"] != "k6v5"}
    plan = [  # (class, kind, id, attack, sharp, zone, affinity, extra)
        (0, 0, 165, 1000, 5, 45, 30, {}), (0, 0, 166, 1000, 6, 45, 30, {"chargeUp": 1}),
        (0, 0, 167, 1200, 7, 70, 100, {"chargeUp": 2, "starvingWolf": True}),
        (0, 0, 168, 1200, 2, 70, 100, {}), (0, 0, 261, 900, 3, 30, -40, {}),
        (7, 0, 158, 800, 5, 60, 50, {"fencingHit": True}), (7, 0, 250, 800, 6, 55, 0, {"spirit": True}),
        (7, 0, 74, 700, 4, 40, 20, {"techMult": 1.2}),
        (11, 100, 40, 600, 6, 50, 40, {"fencingHit": True}), (11, 100, 1, 600, 1, 50, 40, {}),
        (2, 0, 34, 1100, 5, 65, 10, {"attackMult": 1.5}), (2, 0, 11, 1100, 0, 65, 10, {}),
        (3, 0, 231, 500, 6, 50, 60, {"ceaseless": 3}), (3, 0, 229, 500, 4, 50, -100, {}),
        (4, 0, 222, 400, 7, 35, 70, {"techMult": 1.3, "elementValue": 30, "elementZone": 25}),
        (4, 0, 23, 400, 3, 35, 70, {"ceaseless": 1, "starvingWolf": True}),
        (6, 0, 1, 450, 5, 40, 25, {"demonMult": 1.2, "elementValue": 45, "elementZone": 30,
                                   "elementSkill": 120}),
        (9, 0, 169, 520, 4, 45, 15, {"attackMult": 0.7}), (9, 0, 70, 520, 5, 45, 0, {"flat": 25}),
        (8, 0, 94, 1050, 6, 55, 35, {"elementValue": 20, "elementZone": 15}),
        (12, 106, 1, 1150, 5, 50, 20, {}), (13, 120, 1, 1200, 6, 50, 45, {"techMult": 1.03}),
        (13, 121, 8, 1200, 7, 80, 100, {"starvingWolf": True}), (0, 0, 113, 1500, 7, 100, 100, {"flat": 300}),
    ]
    cases = []
    for cls, kind, rid, attack, sharp, zone, aff, extra in plan:
        rec = by[(kind, rid)]
        short = MOVES.CLASSES[cls]
        c = {"type": SLUGS[cls], "kind": kind, "id": rid, "mv": rec["chain_mv"],
             "bonus": [0] * len(rec["chain"]), "attack": attack, "flat": 0, "attackMult": 1.0,
             "techMult": 1.0, "demonMult": 1.0, "spirit": False, "sharp": sharp, "zone": zone,
             "elementValue": 0, "elementZone": 0, "elementSkill": 100, "affinity": aff,
             "starvingWolf": False, "ceaseless": 0, "fencingHit": False}
        level = extra.pop("chargeUp", 0)
        if level:   # mhfdat slot 0x984: byte 0 with Charge Attack Up+1, byte 1 with +2
            c["bonus"] = [bonus_by.get((short, kind, h), (0, 0))[level - 1] for h in rec["chain"]]
            c["chargeUp"] = level
        c.update(extra)
        c["expect"] = ref_case(c)
        cases.append(c)
    return cases


def main(argv):
    global WEAPONS, MOVES, SHARP, CEASELESS, FACTORS
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--re", default=DEFAULT_RE, help="hvmhfz_re checkout (tools/weapons, build/unpack_cli)")
    ap.add_argument("--zip", default=DEFAULT_ZIP, help="client patch zip (Frontier_Patch/dat/mhfdat.bin, mhfpac.bin)")
    ap.add_argument("--version", default=DEFAULT_VERSION, help="that patch's public version (data/patch-versions.json)")
    ap.add_argument("--sdt", default=DEFAULT_SDT, help="the client's dat/mhfsdt.bin (motion values)")
    args = ap.parse_args(argv)
    re_root = pathlib.Path(args.re)
    unpack = re_root / "build" / "unpack_cli"
    if not unpack.exists():
        sys.exit("build/unpack_cli is missing: run make build/unpack_cli in " + args.re)
    sys.path.insert(0, str(re_root / "tools" / "weapons"))
    import moves as MOVES_MOD
    import weapons as WEAPONS_MOD
    WEAPONS, MOVES = WEAPONS_MOD, MOVES_MOD

    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(args.zip) as z:
        for name in ("mhfdat.bin", "mhfpac.bin"):
            (pathlib.Path(tmp) / ("enc-" + name)).write_bytes(z.read("Frontier_Patch/dat/" + name))
        dat = decode(unpack, pathlib.Path(tmp) / "enc-mhfdat.bin", pathlib.Path(tmp) / "mhfdat.bin")
        pac = decode(unpack, pathlib.Path(tmp) / "enc-mhfpac.bin", pathlib.Path(tmp) / "mhfpac.bin")
        sdt = decode(unpack, args.sdt, pathlib.Path(tmp) / "mhfsdt.bin")

    FACTORS = WEAPONS.factors(dat)
    SHARP = [tuple(r[2:5]) for r in WEAPONS.sharp_mult(dat)]
    CEASELESS = [0.0, 0.10, 0.15, 0.20]   # docs/weapons.md section 5 (mhfdat slot 0xb94 floats)
    melee, ranged = WEAPONS.melee(dat), WEAPONS.ranged(dat)
    bars = {}
    for cls, row, ends in WEAPONS.sharpness(dat):
        bars.setdefault(cls, {})[row] = ends
    charge = {r[0]: list(r[5:9]) for r in WEAPONS.bow_charge(dat)}
    moves_rows = MOVES.moves(sdt, dat)
    MOVES.community_names(moves_rows)
    bonus_list = MOVES.mv_bonus(dat)[0]
    bonus_by = {(MOVES.CLASSES[c], kind, rid): b[:2] for c, kind, rid, b in bonus_list}

    re_head = subprocess.run(["git", "-C", str(re_root), "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True).stdout.strip()
    source = {"patch": "v" + args.version, "zip": pathlib.Path(args.zip).name, "zipSha256": sha(args.zip),
              "mhfdatSha256": hashlib.sha256(dat).hexdigest(), "mhfsdtSha256": sha(args.sdt),
              "mhfsdt": "the game client's dat/mhfsdt.bin (not in our patch)",
              "tools": "hvmhfz_re %s tools/weapons (weapons.py, moves.py, styles.py)" % re_head,
              "script": "dev/make-weapons-data.py"}
    OUT.mkdir(parents=True, exist_ok=True)
    types = []
    for cls, slug in enumerate(SLUGS):
        short = MOVES.CLASSES[cls]
        doc = {"type": slug, "name": WEAPONS.CLASSES[cls], "class": cls, "source": source}
        if cls in RANGED:
            doc["kind"] = "bow" if cls == 10 else "bowgun"
            doc["fields"] = ["id", "name", "rarity", "attack", "shown", "affinity", "slots", "defense"] + (
                ["element", "elementValue", "charge", "arcShot"] if cls == 10 else ["recoil", "reload"])
            doc["weapons"] = ranged_rows(ranged, FACTORS, cls, charge)
        else:
            doc["kind"] = "melee"
            doc["fields"] = ["id", "name", "rarity", "attack", "shown", "affinity", "element", "elementValue",
                             "status", "statusValue", "slots", "sharpness", "special", "defense"]
            doc["weapons"] = [w for w in melee_rows([r for r in melee if r["class"] == cls], FACTORS)]
            used = sorted({w[11] for w in doc["weapons"]})
            doc["bars"] = {str(row): bars[cls][row] for row in used}
            doc["tech"] = tech_levels(pac, cls)
        doc["moves"] = move_rows(moves_rows, short)
        doc["mvBonus"] = {"%d:%d" % (kind, rid): list(b) for (w, kind, rid), b in bonus_by.items() if w == short}
        if slug in FENCING:
            doc["fencing"] = FENCING[slug]
        (OUT / (slug + ".json")).write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                                            encoding="utf-8")
        types.append({"slug": slug, "name": WEAPONS.CLASSES[cls], "short": WEAPONS.SHORT[cls], "class": cls,
                      "kind": doc["kind"], "displayFactor": FACTORS[cls], "weapons": len(doc["weapons"]),
                      "moves": len(doc["moves"])})

    skills = {key: ([pac_text(pac, 0xA1C, i) for i in ids] if isinstance(ids, list) else pac_text(pac, 0xA1C, ids))
              for key, ids in SKILL_IDS.items()}
    index = {
        "_about": "Weapon database and damage calculator data, written by dev/make-weapons-data.py from the "
                  "game's own files (see source). Formula: hvmhfz_re docs/weapons.md sections 4 and 5.",
        "source": source,
        "types": types,
        "colours": list(COLOURS), "colourRgb": list(SHARP_RGB),
        "sharpMult": [list(s) for s in SHARP],   # per level: raw, element (raw2), bounce test (mhfdat slot 0x658)
        "constants": {
            "critBase": MOVES.CRIT_BASE, "critStarvingWolf": MOVES.CRIT_UP, "critNegative": MOVES.CRIT_NEG,
            "ceaseless": CEASELESS, "critEye": [10, 20, 30, 40, 50], "affinityCap": 100, "attackCap": 3000,
            "tech": {"1": 0.8, "2": 1.0, "3": 1.1, "4": 1.2, "snsLevel3": 1.2, "snsLevel4": 1.3, "msLevel4": 1.03},
            "adrenaline": 1.5, "worry": 0.7, "demon": [1.0, 1.05, 1.1, 1.15, 1.2], "spiritNum": 99,
            "spiritDen": 80, "fencing": 1.2, "minCritSharpness": 3,
        },
        "skills": skills,
        "notes": [
            "Rarity is the record's low 4 bits + 1 (the game's RARE number; the +1 is a guess).",
            "Critical Eye +1..+5 add 10..50 affinity (the client's skill descriptions).",
            "Rounding inside the attack build-up is not mapped; the calculator truncates after each multiplier.",
            "The hit's T factor (docs/weapons.md section 5) is taken as 1.0: which hit class a move has is open.",
            "Fencing+2's x1.2 is applied after the crit, as the hit caller does per hit; their order is not mapped.",
        ],
    }
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    cases = make_cases(moves_rows, bonus_by)
    CASES.write_text(json.dumps({"_about": "Reference cases for dev/check-weapons.js, written by "
                                 "dev/make-weapons-data.py with hvmhfz_re tools/weapons/moves.py "
                                 "(record MVs, melee_crit, crit_factor).", "source": source, "cases": cases},
                                indent=1) + "\n", encoding="utf-8")
    print("weapons: %s; %d cases -> %s" % (", ".join("%s %d" % (t["short"], t["weapons"]) for t in types),
                                           len(cases), CASES.relative_to(ROOT)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
