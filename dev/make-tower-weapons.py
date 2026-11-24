#!/usr/bin/env python3
"""Writes data/tower-weapons.json, the data of the Tower weapons page (tower-weapons.html, js/tower-weapons.js).

The numbers are the game's own tables, read with the hvmhfz_re tools (private repo, run here, never copied):

  - dat/mhfdat.bin of a client patch zip, decoded with hvmhfz_re build/unpack_cli (as dev/make-weapons-data.py);
  - hvmhfz_re tools/items/tower_upgrades.py (part 135, docs/tower-upgrades.md): the 63 Tower weapons, their
    point budget (300 or 100), their sigil and decoration slots, the stat lines each class has ("Level GR
    Weapons" at the Tower smithy), and per level of each line what it adds and the points it uses (growth table
    mhfdat 0x93c) and what it costs (mhfdat 0x938). The model equals the client's code on all 13,822 levels
    (unicorn); this script checks its totals against hvmhfz_re data/tower_upgrades.tsv.
  - hvmhfz_re data/tower_gem_payout.tsv: the Courage / Glittering / Divine Gems a tower clear pays on average in
    the 1st and 2nd District (part 139, live since 13 Nov 2026).

And this site's own data: data/weapons/ (type, rarity, true attack, the shown-attack factor, sharpness bar,
elements), data/equipment/ (each weapon's Tower smithy recipe), data/items/ (names; the shop rows of every
material, which are the live server's) and data/sources/index.json (the shops' currencies).

  python3 dev/make-tower-weapons.py                       # the defaults below (patch v1.30)
  python3 dev/make-tower-weapons.py --zip Frontier_Patch.zip --version 1.31 --re /path/to/hvmhfz_re

Run it again when a client patch changes the Tower tables, or after dev/make-source-data.py (shop rows), then
node dev/check-tower-weapons.js.
"""
import argparse
import collections
import csv
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "tower-weapons.json"
DEFAULT_RE = "/root/mhfz/hvmhfz_re"
DEFAULT_ZIP = "/root/backups/client-patch/Frontier_Patch-68084e7e.zip"
DEFAULT_VERSION = "1.30"
# The shops whose rows the page prices a build in (data/sources ids; the Road shop's tabs are road-shop-N).
SHOPS = ("road-shop-", "gcp-item-shop")
GEMS = (11159, 11160, 11161)        # Courage gem, Glittering Gem, Divine Gem
# data/weapons fields copied into a weapon's "base"
BASE_FIELDS = ("attack", "shown", "affinity", "element", "elementValue", "status", "statusValue", "special",
               "recoil", "reload", "charge", "arcShot")


def decode(unpack, src, dst):
    with open(dst, "wb") as out:
        subprocess.run([str(unpack), str(src)], stdout=out, stderr=subprocess.DEVNULL, check=True)
    return pathlib.Path(dst).read_bytes()


def load(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def read_tsv(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def site_weapons():
    """{(kind, id): (type slug, row dict)} from data/weapons/<type>.json."""
    index = load(DATA / "weapons" / "index.json")
    out = {}
    for t in index["types"]:
        f = load(DATA / "weapons" / (t["slug"] + ".json"))
        kind = "melee" if t["kind"] == "melee" else "ranged"
        for row in f["weapons"]:
            out[(kind, row[0])] = (t["slug"], dict(zip(f["fields"], row)), f.get("bars", {}))
    return index, out


def recipe(kind, wid):
    """The Tower smithy's recipe (create list 0x940) from data/equipment/<slot>/<id // 1024>.json."""
    eq = load(DATA / "equipment" / kind / ("%d.json" % (wid // 1024)))["eq"].get(str(wid), {})
    for row in eq.get("make", []):
        if row[0] == "c" and "0x940" in (row[4] or ""):
            return row[2]
    raise SystemExit("no Tower smithy recipe for %s %d in data/equipment" % (kind, wid))


def shop_rows(item, currencies):
    """[[source id, currency, price, qty, gate]] of the shops in SHOPS for one item, from data/items/<id>.json.
    A server row hides the shop's built-in row of the same item (hvmhfz_re docs/tower-upgrades.md 4), so the
    built-in rows are kept only for a shop with no server row for the item."""
    try:
        where = load(DATA / "items" / ("%d.json" % item)).get("where") or []
    except FileNotFoundError:
        return []
    rows = [(s, r) for s, r in where if s.startswith(SHOPS) and r.get("price")]
    server = {s for s, r in rows if not r.get("builtin")}
    out = []
    for s, r in rows:
        if r.get("builtin") and s in server:
            continue
        out.append([s, currencies.get(s, ""), r["price"], r.get("qty", 1), r.get("gate", "")])
    return out


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--re", default=DEFAULT_RE, help="hvmhfz_re checkout (tools/items, build/unpack_cli, data/)")
    ap.add_argument("--zip", default=DEFAULT_ZIP, help="client patch zip (Frontier_Patch/dat/mhfdat.bin)")
    ap.add_argument("--version", default=DEFAULT_VERSION, help="that patch's public version (data/patch-versions.json)")
    args = ap.parse_args(argv)
    re_root = pathlib.Path(args.re)
    unpack = re_root / "build" / "unpack_cli"
    if not unpack.exists():
        sys.exit("build/unpack_cli is missing: run make build/unpack_cli in " + args.re)
    sys.path.insert(0, str(re_root / "tools" / "items"))
    sys.dont_write_bytecode = True
    import tower_upgrades as TU

    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(args.zip) as z:
        (pathlib.Path(tmp) / "enc-mhfdat.bin").write_bytes(z.read("Frontier_Patch/dat/mhfdat.bin"))
        dat = decode(unpack, pathlib.Path(tmp) / "enc-mhfdat.bin", pathlib.Path(tmp) / "mhfdat.bin")

    index, weapons = site_weapons()
    types = {t["slug"]: t for t in index["types"]}
    names = {r[0]: r[1] for r in load(DATA / "items" / "index.json")["items"]}
    currencies = {r[0]: r[3] for r in load(DATA / "sources" / "index.json")["sources"]}
    cost_rows = TU.cost_rows(dat)
    expect = {(r["kind"], int(r["id"]), r["stat"]): r for r in read_tsv(re_root / "data" / "tower_upgrades.tsv")}
    problems = []
    items = set(GEMS) | {TU.AFFINITY_SIGIL, *TU.STATUS_SIGIL.values(), *range(TU.ELEMENT_SIGIL, TU.ELEMENT_SIGIL + 5)}
    status_names = {7: "Poison", 5: "Paralysis", 6: "Sleep"}

    out_weapons = []
    for w in TU.tower_weapons(dat):
        slug, row, bars = weapons[(w["kind"], w["id"])]
        lines = []
        for stat in w["lines"]:
            name = TU.STAT_NAMES[stat]
            variants = (7, 5, 6) if stat == 4 else (None,)
            line = {"stat": name}
            if stat in (2, 3, 4):
                line["sigil"] = {2: "affinity", 3: "element", 4: "status"}[stat]
            for v in variants:
                levels = TU.stat_levels(dat, w, stat, cost_rows, v or 7)
                gains, points = [g for _l, g, _p, _m in levels], [p for _l, _g, p, _m in levels]
                if v is None:
                    line["gain"], line["points"] = gains, points
                else:
                    line.setdefault("status", {})[status_names[v]] = {"gain": gains, "points": points}
            # cost per level: the rows of mhfdat 0x938, [lo, hi, [[item, qty]]], for the levels the line has
            # (Status: its longest column; the columns share the cost rows)
            rows = sorted(cost_rows.get((w["kind"], w["id"], stat), []))
            n = max(len(TU.stat_levels(dat, w, stat, cost_rows, v or 7)) for v in variants)
            line["cost"] = [[lo, min(hi, n - 1), [list(m) for m in mats]] for lo, hi, mats in rows if lo < n]
            covered = sorted(l for lo, hi, _m in line["cost"] for l in range(lo, hi + 1))
            if covered != list(range(n)):
                problems.append("%s %s: cost rows do not cover levels 0-%d once" % (w["name"], name, n - 1))
            for _lo, _hi, mats in line["cost"]:
                items.update(m[0] for m in mats)
            # the totals must equal hvmhfz_re's table (Status: the Poison column, as the table)
            e = expect.get((w["kind"], w["id"], name))
            g0 = line["gain"] if v is None else line["status"]["Poison"]["gain"]
            p0 = line["points"] if v is None else line["status"]["Poison"]["points"]
            mats = collections.Counter()
            for lo, hi, ms in line["cost"]:
                for item, q in ms:
                    mats[names.get(item, str(item))] += q * max(0, min(hi, len(g0) - 1) - lo + 1)
            got = (len(g0), sum(p0), sum(g0), "; ".join("%s x%d" % kv for kv in mats.items()))
            if e is None or got[:3] != (int(e["max_level"]), int(e["points_to_max"]), int(e["total_gain"])) \
                    or sorted(got[3].split("; ")) != sorted(e["materials"].split("; ")):
                problems.append("%s %s: %r, hvmhfz_re table %r" % (w["name"], name, got, e and (
                    e["max_level"], e["points_to_max"], e["total_gain"], e["materials"])))
            lines.append(line)
        craft = recipe(w["kind"], w["id"])
        items.update(m[0] for m in craft)
        out_weapons.append({
            "id": w["id"], "kind": w["kind"], "type": slug, "name": w["name"], "rarity": row["rarity"],
            # the weapon's own values before any level, as the Weapons page has them
            "base": {k: v for k, v in row.items() if k in BASE_FIELDS and v not in ("", None)},
            "sharpness": bars.get(str(row["sharpness"])) if "sharpness" in row else None,
            "sigils": w["slots"], "decos": max(0, 3 - w["slots"]), "budget": w["cap"],
            "craft": craft, "lines": lines})
    if len(out_weapons) != 63:
        problems.append("%d Tower weapons, expected 63" % len(out_weapons))
    if problems:
        sys.exit("the tables disagree with hvmhfz_re:\n  " + "\n  ".join(problems))

    sky = {}
    for r in read_tsv(re_root / "data" / "tower_gem_payout.tsv"):
        if r["main_table"] == "4005" and r["district"] not in sky:
            sky[r["district"]] = [float(r["courage_after"]), float(r["glittering_after"]), float(r["divine_after"])]

    order = [t["slug"] for t in index["types"]]
    out_weapons.sort(key=lambda w: (order.index(w["type"]), w["budget"] != 300, w["id"]))
    re_head = subprocess.run(["git", "-C", str(re_root), "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True).stdout.strip()
    doc = {
        "_about": "Tower weapons and their upgrades at the Tower smithy (\"Level GR Weapons\"), written by "
                  "dev/make-tower-weapons.py. Per weapon: its line per stat; gain[i] and points[i] are what level "
                  "i + 1 adds and uses (attack, element and status in the game's raw units; attack is shown x the "
                  "type's displayFactor / 100), cost rows [first level, last level, [[item, qty]]] (0-based) "
                  "pay for each level in that range. Status has a column per status sigil; a Shelling Level gain "
                  "of 3 is one step along shells (the Gunlance shell names). budget = the most "
                  "points a weapon takes. shops: the live shop rows of each material [source, currency, price, "
                  "qty, rank gate]. skyGems: Courage, Glittering and Divine Gems a tower clear pays on average "
                  "per District (hvmhfz_re data/tower_gem_payout.tsv).",
        "source": {"patch": "v" + args.version, "zip": pathlib.Path(args.zip).name,
                   "mhfdatSha256": hashlib.sha256(dat).hexdigest(),
                   "tools": "hvmhfz_re %s tools/items/tower_upgrades.py" % re_head,
                   "script": "dev/make-tower-weapons.py"},
        "types": [{"slug": t["slug"], "name": t["name"], "short": t["short"], "displayFactor": t["displayFactor"]}
                  for t in index["types"] if any(w["type"] == t["slug"] for w in out_weapons)],
        "colourRgb": index["colourRgb"],
        "shells": index["codes"]["shell"],
        "sigils": {"affinity": TU.AFFINITY_SIGIL, "element": list(range(TU.ELEMENT_SIGIL, TU.ELEMENT_SIGIL + 5)),
                   "status": {status_names[k]: v for k, v in sorted(TU.STATUS_SIGIL.items())}},
        "gems": list(GEMS),
        "skyGems": sky,
        "items": {str(i): names.get(i, "") for i in sorted(items)},
        "shops": {str(i): rows for i in sorted(items) if (rows := shop_rows(i, currencies))},
        "weapons": out_weapons,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("wrote %s: %d weapons, %d items, %d KB" % (OUT.relative_to(ROOT), len(out_weapons), len(items),
                                                      OUT.stat().st_size // 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
