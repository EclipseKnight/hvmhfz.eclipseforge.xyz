#!/usr/bin/env python3
"""Checks what items are used for (dev/make-use-data.py) and tests that script.

  python3 dev/check-uses.py     "uses OK"

1. Tests make-use-data.py on a small made-up hvmhfz_re file: an item in a weapon upgrade, an armour transmog, a
   decoration and the gem mixer gets one row per use under the right group, with the other inputs ("with");
   a quest's deliver objective is a Quests row; the equipment entries keep every way to make a piece, the
   names file its first parent; the files are written and a second run removes what is gone.
2. Checks the data: data/uses/index.json lists every data/uses/<id>.json with its row count; every item a row
   names (made, with, gem mixer results) is in data/items/index.json; every piece a row names is in its slot's
   names.json, and has its entry in the chunk file; every material of the chunk files is in the item index and
   in the chunk's "items"; every "from" and every parent is a named piece; every quest row's quest has a page;
   with item info (data/uses/info, data/uses/status.json): every info entry is an item in its own chunk, every
   "use"/"trade" row has a known kind, the status lists name items, "no_use" is exactly the items with no uses
   file and no entry quest, "unreleased" items have no use, no source and an unused-slot status.
3. Tests the item info part of make-use-data.py: the item's own uses become "use"/"trade" rows, the facts go
   to their 512-id chunk without "uses", the status lists.
"""
import importlib.util
import json
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
fails = []


def check(ok, msg):
    if not ok:
        fails.append(msg)


def load_module():
    spec = importlib.util.spec_from_file_location("make_use_data", ROOT / "dev" / "make-use-data.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_script(m):
    uses = {"equipment": {"melee": {"1": ["Bone Blade", 1], "2": ["Bone Blade+", 2]}, "head": {"7": ["Rath Helm", 3]}},
            "recipes": [
                {"sys": "smithy", "t": ["melee", 1], "mats": [[10, 2]], "note": "list 0x38"},
                {"sys": "smithy", "t": ["melee", 2], "from": 1, "mats": [[10, 3], [11, 1]], "zenny": 900},
                {"sys": "transmog", "t": ["head", 7], "mats": [[10, 8]], "note": "list 0xab8"},
                {"sys": "deco", "t": ["item", 20], "mats": [[10, 1], [12, 3]], "note": "list 0x44"},
                {"sys": "gem-mixer", "t": ["item", 30], "any": [10, 31], "mats": [], "min": 10, "chance": 2.5},
                {"sys": "gem-mixer", "t": ["item", 31], "any": [10, 31], "mats": [], "min": 10, "chance": 1.5},
                {"sys": "tower-up", "t": ["melee", 2], "stat": "Attack", "levels": 100, "mats": [[10, 500]]}]}
    objectives = {"quests": {"5": {"o": [[2, 10, 4], [0, 0, 0], [4098, 12, 1]]}, "6": {"o": [[2, 10, 1]]}}}
    per = m.item_uses(uses, m.deliveries(objectives, {5: "Deliver it"}))
    rows = per[10]["rows"]
    check(["melee", 1, 2, "c"] in rows and ["melee", 2, 3, "u"] in rows and ["head", 7, 8, "t"] in rows,
          "test: weapon and transmog rows of item 10: %r" % rows)
    deco = [r for r in rows if isinstance(r, dict) and r.get("s") == "deco"]
    check(deco == [{"g": "deco", "s": "deco", "item": 20, "qty": 1, "with": [[12, 3]], "note": "list 0x44"}],
          "test: decoration row: %r" % deco)
    mix = [r for r in rows if isinstance(r, dict) and r.get("s") == "gem-mixer"]
    check(len(mix) == 1 and mix[0]["made"] == [[30, 2.5], [31, 1.5]], "test: one gem mixer row: %r" % mix)
    tower = [r for r in rows if isinstance(r, dict) and r.get("s") == "tower-up"]
    check(tower == [{"g": "tower", "s": "tower-up", "eq": ["melee", 2], "stat": "Attack", "levels": 100, "qty": 500}],
          "test: tower upgrade row: %r" % tower)
    quest = [r for r in rows if isinstance(r, dict) and r.get("g") == "quest"]
    check(quest == [{"g": "quest", "quest": 5, "name": "Deliver it", "qty": 4, "obj": "main"}],
          "test: deliver row, quests without a page left out: %r" % quest)
    check(per[12]["rows"][-1]["obj"] == "sub B", "test: Deliver Flag on sub B")
    names, pieces = m.equipment(uses)
    check(names["melee"] == [0, ["Bone Blade", 1, 0], ["Bone Blade+", 2, 1]], "test: names: %r" % names["melee"])
    check(pieces["melee"][2]["make"] == [["u", 1, [[10, 3], [11, 1]], 900, ""]] and
          pieces["melee"][2]["tower"] == [["Attack", 100, [[10, 500]]]], "test: entry: %r" % pieces["melee"][2])
    index = {10: [10, "Ten", "item-1-0"], 11: [11, "Eleven", ""]}
    with tempfile.TemporaryDirectory() as d:
        out = pathlib.Path(d)
        m.write(per, names, pieces, index, out)
        check((out / "uses" / "10.json").exists() and (out / "equipment" / "melee" / "0.json").exists(),
              "test: files written")
        chunk = json.loads((out / "equipment" / "melee" / "0.json").read_text())
        check(chunk["items"]["10"] == ["Ten", "item-1-0"] and chunk["items"]["11"] == ["Eleven", ""],
              "test: chunk item names: %r" % chunk["items"])
        m.write({12: per[12]}, names, pieces, index, out)
        check(not (out / "uses" / "10.json").exists(), "test: a second run removes the old files")


def test_info(m):
    uses = {"equipment": {}, "recipes": [{"sys": "deco", "t": ["item", 20], "mats": [[10, 1]], "note": "list 0x44"}]}
    info = {"10": {"desc": "Ten.", "from": "game", "kind": "material", "r": 1, "sell": 5, "flags": 1,
                   "uses": [{"s": "pouch"}, {"s": "fp-trade", "qty": 1, "fp": 3}]},
            "11": {"kind": "material", "r": 1, "sell": 7},
            "12": {"kind": "placeholder", "r": 1, "status": "placeholder"},
            "600": {"desc": "Six hundred.", "kind": "coin", "r": 2}}
    per = m.item_uses(uses, {}, info)
    check(per[10]["rows"][1:] == [{"g": "use", "s": "pouch"}, {"g": "trade", "s": "fp-trade", "qty": 1, "fp": 3}],
          "test info: own uses as rows: %r" % per[10]["rows"])
    index = {i: [i, "Item %d" % i, ""] for i in (0, 10, 11, 12, 20, 600)}
    details = {11: {"where": [["shop", 1]]}, 20: {"quests": [{"id": 5}]}}
    st = m.item_status(index, per, details, info)
    check(st["no_use"] == [11, 12, 600] and st["no_source"] == [10, 12, 20, 600] and st["unreleased"] == [12],
          "test info: status %r" % st)
    chunks = m.info_chunks(info, index)
    check(sorted(chunks) == [0, 1] and chunks[0]["items"]["10"] == {"desc": "Ten.", "from": "game", "kind": "material",
                                                                     "r": 1, "sell": 5}
          and "600" in chunks[1]["items"], "test info: chunks %r" % chunks)


USE_KINDS = {"use": {"pouch", "ammo", "coating", "crystal", "cooking", "deco", "gem", "jewel", "sigil"},
             "trade": {"fp-trade", "gcp-sell", "gacha"}}


def check_info(items, index):
    info_dir, st_path = DATA / "uses" / "info", DATA / "uses" / "status.json"
    if not info_dir.exists() and not st_path.exists():
        return 0
    known = 0
    for p in info_dir.glob("*.json"):
        for sid in json.loads(p.read_text())["items"]:
            check(int(sid) in items and int(sid) // 512 == int(p.stem), "uses/info/%s.json: %s misplaced" % (p.stem, sid))
            known += 1
    st = json.loads(st_path.read_text())
    for k in ("no_use", "no_source", "unreleased"):
        check(all(i in items for i in st[k]), "status %s names an unknown item" % k)
    needs = set()
    for p in (DATA / "items").glob("*.json"):
        if p.stem.isdigit() and json.loads(p.read_text()).get("quests"):
            needs.add(int(p.stem))
    want = sorted(i for i in items if i and str(i) not in index and i not in needs)
    check(st["no_use"] == want, "status no_use: %d listed, %d items have no use" % (len(st["no_use"]), len(want)))
    check(set(st["unreleased"]) <= set(st["no_use"]) & set(st["no_source"]), "status: unreleased items with a use or source")
    return known


def check_data():
    items = {r[0] for r in json.loads((DATA / "items" / "index.json").read_text())["items"]}
    quests = {q[0] for q in json.loads((DATA / "search" / "quests.json").read_text())["quests"]}
    index = json.loads((DATA / "uses" / "index.json").read_text())["items"]
    files = {p.stem for p in (DATA / "uses").glob("*.json")} - {"index", "status"}
    check(files == set(index), "uses index and files differ: %d listed, %d files" % (len(index), len(files)))
    names, chunks = {}, {}
    for slot_dir in (DATA / "equipment").iterdir():
        names[slot_dir.name] = json.loads((slot_dir / "names.json").read_text())["names"]
        for p in slot_dir.glob("*.json"):
            if p.stem != "names":
                chunks[(slot_dir.name, int(p.stem))] = json.loads(p.read_text())

    def named(slot, i):
        return slot in names and 0 < i < len(names[slot]) and bool(names[slot][i])

    rows = 0
    for stem in sorted(files, key=int):
        d = json.loads((DATA / "uses" / (stem + ".json")).read_text())
        check(d["id"] == int(stem) and int(stem) in items, "uses/%s.json: id not an item" % stem)
        check(index[stem][0] == len(d["rows"]), "uses/%s.json: index count %d, rows %d" % (stem, index[stem][0], len(d["rows"])))
        rows += len(d["rows"])
        for r in d["rows"]:
            if isinstance(r, list):
                check(named(r[0], r[1]), "uses/%s.json: piece %s %s has no name" % (stem, r[0], r[1]))
                check(str(r[1]) in chunks.get((r[0], r[1] // 1024), {}).get("eq", {}),
                      "uses/%s.json: piece %s %s has no materials entry" % (stem, r[0], r[1]))
                continue
            if r.get("eq"):
                check(named(*r["eq"]), "uses/%s.json: tower weapon %r has no name" % (stem, r["eq"]))
            if r.get("g") == "quest":
                check(r["quest"] in quests, "uses/%s.json: quest %s has no page" % (stem, r["quest"]))
            if r.get("g") in USE_KINDS:
                check(r.get("s") in USE_KINDS[r["g"]], "uses/%s.json: unknown %s kind %r" % (stem, r["g"], r.get("s")))
            for i in [r.get("item")] + [w[0] for w in r.get("with", [])] + [x[0] for x in r.get("made", [])]:
                check(i is None or i in items, "uses/%s.json: item %s is not in the item index" % (stem, i))
    for (slot, c), body in chunks.items():
        for sid, e in body["eq"].items():
            check(named(slot, int(sid)) and int(sid) // 1024 == c, "%s/%d.json: piece %s misplaced or unnamed" % (slot, c, sid))
            for mk in e["make"]:
                check(not mk[1] or named(slot, mk[1]), "%s/%d.json: %s from %s unnamed" % (slot, c, sid, mk[1]))
            for i, _q in [x for mk in e["make"] for x in mk[2]] + [x for t in e.get("tower", []) for x in t[2]]:
                check(i in items and str(i) in body["items"], "%s/%d.json: material %s unknown" % (slot, c, i))
    for slot, ns in names.items():
        for i, n in enumerate(ns):
            check(not n or not n[2] or named(slot, n[2]), "%s names: %d's parent %s unnamed" % (slot, i, n and n[2]))
    return len(index), rows, check_info(items, index)


def main():
    m = load_module()
    test_script(m)
    test_info(m)
    n, rows, described = check_data()
    for f in fails[:40]:
        print("FAIL " + f)
    if fails:
        print("%d problems" % len(fails))
        return 1
    print("uses OK (%d items, %d rows, %d items with facts)" % (n, rows, described))
    return 0


if __name__ == "__main__":
    sys.exit(main())
