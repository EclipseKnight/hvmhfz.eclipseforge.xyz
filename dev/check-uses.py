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
   in the chunk's "items"; every "from" and every parent is a named piece; every quest row's quest has a page.
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


def check_data():
    items = {r[0] for r in json.loads((DATA / "items" / "index.json").read_text())["items"]}
    quests = {q[0] for q in json.loads((DATA / "search" / "quests.json").read_text())["quests"]}
    index = json.loads((DATA / "uses" / "index.json").read_text())["items"]
    files = {p.stem for p in (DATA / "uses").glob("*.json")} - {"index"}
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
    return len(index), rows


def main():
    test_script(load_module())
    n, rows = check_data()
    for f in fails[:40]:
        print("FAIL " + f)
    if fails:
        print("%d problems" % len(fails))
        return 1
    print("uses OK (%d items, %d rows)" % (n, rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
