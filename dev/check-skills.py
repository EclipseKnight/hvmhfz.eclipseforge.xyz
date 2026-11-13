#!/usr/bin/env python3
"""Checks the Skills database (dev/make-skill-data.py) and tests that script.

  python3 dev/check-skills.py [--re /root/mhfz/hvmhfz_re]     "skills OK"

1. Tests make-skill-data.py on a small made-up skills_db.json: a tree's levels keep the game's points and skill
   names, an armour piece, a decoration and a Road gem are listed under each tree they give points to (most
   points first, minus points last), a "Dummy" piece is left out, an automatic skill goes to the tree of its
   skill, the equipment and item chunk files say the same, a tree with no category row is "Other", and an
   unknown category is refused, a tree listed twice on one piece is added up.
2. Checks the data against the input (hvmhfz_re data/skills_db.json, when present): every tree and level is in
   data/skills/index.json and its tree file; every armour piece's, decoration's and Road gem's points appear once
   in the tree file of each tree and in its chunk file; every automatic skill row is on its tree's page and in
   its piece's chunk; equipment links point at pieces with an equipment page, item ids are in the item index;
   the Road skills and Tower sigils are all there.
"""
import importlib.util
import json
import pathlib
import sys
import tempfile

sys.dont_write_bytecode = True  # no dev/__pycache__ from loading make-skill-data.py

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
fails = []


def check(ok, msg):
    if not ok:
        fails.append(msg)


def load_module():
    spec = importlib.util.spec_from_file_location("make_skill_data", ROOT / "dev" / "make-skill-data.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_script(m):
    db = {
        "trees": [{"id": 5, "name": "Paralysis", "levels": [[-10, 3], [10, 1], [20, 2]]},
                  {"id": 7, "name": "Issen", "levels": [[10, 9]]}],
        "skills": {"1": {"name": "Para Halved", "desc": "Halves paralysis."}, "2": {"name": "Negate Para", "desc": ""},
                   "3": {"name": "Para Doubled", "desc": "no description in the client"},
                   "9": {"name": "Issen+1", "desc": "Crit up."}},
        "armour": [{"slot": "head", "id": 3, "name": "Rath Helm", "rarity": 4, "skills": [[5, 1], [5, 3]], "obtainable": True},
                   {"slot": "legs", "id": 2050, "name": "Bad Greaves", "rarity": 2, "skills": [[5, -3], [7, 2]],
                    "obtainable": False},
                   {"slot": "chest", "id": 9, "name": "Dummy", "rarity": 1, "skills": [[5, 9]], "obtainable": False}],
        "decorations": [{"item": 100, "name": "Para Jewel", "kind": "decoration", "slots": 1, "skills": [[5, 2]],
                         "obtainable": True},
                        {"item": 1500, "name": "Para Gem", "kind": "road-gem", "slots": 1, "skills": [[5, 10]],
                         "obtainable": False}],
        "automatic": [{"slot": "melee", "id": 12, "name": "Origin Blade", "skill": 9, "obtainable": True}],
        "road_skills": [{"id": 1, "name": "Attack", "tab": "martial", "max_level": 2, "mode": "both",
                         "text": "Increases Attack Power", "levels": [], "restored": False}],
        "sigils": [{"item": 1501, "name": "[GS] Rotation", "family": "f", "group": "move", "effect": "GS effect"}],
    }
    pages = {s: set() for s in m.SLOTS}
    pages["head"].add(3)
    index, trees, pieces, items = m.build(db, {7: "Offensive"}, [[100, "Para Jewel", "icon-1", "", 1]], pages)
    para, issen = trees[5], trees[7]
    check(para["category"] == "Other" and issen["category"] == "Offensive", "test: categories")
    check(para["levels"][0][:3] == [-10, 3, "Para Doubled"], "test: levels %r" % para["levels"])
    check([r[2] for r in para["armour"]] == ["Rath Helm", "Bad Greaves"], "test: armour order / dummy %r" % para["armour"])
    check(para["armour"][0][5:] == [1, 1] and para["armour"][1][5:] == [0, 0], "test: obtainable / page flags")
    check([r[1] for r in para["decorations"]] == ["Para Jewel", "Para Gem"] and para["decorations"][1][2] == "g",
          "test: decorations %r" % para["decorations"])
    check(para["decorations"][0][6] == "icon-1", "test: decoration icon")
    check(issen["automatic"] == [["melee", 12, "Origin Blade", 9, 1, 0]], "test: automatic %r" % issen["automatic"])
    check(pieces["legs"][2]["p"]["2050"] == [[5, -3], [7, 2]], "test: piece chunk")
    check(pieces["head"][0]["p"]["3"] == [[5, 4]] and para["armour"][0][4] == 4, "test: a tree twice on a piece adds up")
    check(pieces["melee"][0]["a"]["12"] == [9], "test: automatic chunk")
    check(items[0]["d"]["100"] == [[5, 2]] and items[1]["d"]["1500"] == [[5, 10]] and items[1]["s"]["1501"] == 0,
          "test: item chunks %r" % items)
    row = [t for t in index["trees"] if t[0] == 5][0]
    check(row[4:] == [1, 2, 1, 1, 0], "test: index counts %r" % row)
    check(index["road"][0][4] == "Hunting Road and Sky Corridor", "test: road where")
    try:
        m.build(db, {5: "Nonsense"}, [], pages)
        check(False, "test: an unknown category was accepted")
    except ValueError:
        pass
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp)
        m.write(index, trees, pieces, items, out)
        check((out / "skills" / "5.json").exists() and (out / "skills" / "pieces" / "legs" / "2.json").exists()
              and (out / "skills" / "items" / "1.json").exists(), "test: files written")


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def check_data(m, re_dir):
    index = load(DATA / "skills" / "index.json")
    item_ids = {r[0] for r in load(DATA / "items" / "index.json")["items"]}
    pages = {s: {i for i, n in enumerate(load(DATA / "equipment" / s / "names.json")["names"]) if n} for s in m.SLOTS}
    trees = {t[0]: load(DATA / "skills" / ("%d.json" % t[0])) for t in index["trees"]}
    for tid, t in trees.items():
        for r in t["armour"] + t["automatic"]:
            page = r[6] if len(r) == 7 else r[5]
            check(bool(page) == (r[1] in pages[r[0]]), "tree %d: %s %d page flag" % (tid, r[0], r[1]))
        for r in t["decorations"]:
            check(r[0] in item_ids, "tree %d: decoration %d not in the item index" % (tid, r[0]))
    src = re_dir / "data" / "skills_db.json"
    if not src.exists():
        print("note: %s missing, only the site files were checked" % src)
        return len(trees)
    db = load(src)
    check(sorted(trees) == sorted(t["id"] for t in db["trees"]), "trees differ from skills_db.json")
    for t in db["trees"]:
        page = trees.get(t["id"])
        check(page and [l[:2] for l in page["levels"]] == t["levels"], "tree %d: levels differ" % t["id"])
    chunk_cache = {}

    def chunk(kind, slot, i):
        key = (kind, slot, i // m.CHUNK)
        if key not in chunk_cache:
            path = DATA / "skills" / kind / (slot or "") / ("%d.json" % (i // m.CHUNK))
            chunk_cache[key] = load(path) if path.exists() else {}
        return chunk_cache[key]

    listed = {}
    for tid, t in trees.items():
        for r in t["armour"]:
            listed[(tid, r[0], r[1])] = listed.get((tid, r[0], r[1]), 0) + 1
    for a in db["armour"]:
        if m.is_dummy(a["name"]):
            continue
        check(chunk("pieces", a["slot"], a["id"]).get("p", {}).get(str(a["id"])) == m.merged(a["skills"]),
              "%s %d: chunk points differ" % (a["slot"], a["id"]))
        for tree, _pts in m.merged(a["skills"]):
            check(listed.get((tree, a["slot"], a["id"])) == 1, "%s %d: not once on tree %d" % (a["slot"], a["id"], tree))
    decos = {(tid, r[0]): r[4] for tid, t in trees.items() for r in t["decorations"]}
    for d in db["decorations"]:
        check(chunk("items", None, d["item"]).get("d", {}).get(str(d["item"])) == m.merged(d["skills"]),
              "item %d: chunk points differ" % d["item"])
        for tree, pts in m.merged(d["skills"]):
            check(decos.get((tree, d["item"])) == pts, "item %d: tree %d points" % (d["item"], tree))
    autos = {(r[0], r[1], r[3]) for t in trees.values() for r in t["automatic"]}
    for a in db["automatic"]:
        check((a["slot"], a["id"], a["skill"]) in autos, "automatic %s %d not listed" % (a["slot"], a["id"]))
        check(a["skill"] in chunk("pieces", a["slot"], a["id"]).get("a", {}).get(str(a["id"]), []),
              "automatic %s %d not in its chunk" % (a["slot"], a["id"]))
    check(len(index["road"]) == len(db["road_skills"]) and len(index["sigils"]) == len(db["sigils"]),
          "Road skills or sigils missing")
    return len(trees)


def main(argv):
    re_dir = pathlib.Path(argv[2]) if len(argv) == 3 and argv[1] == "--re" else load_module().RE_DIR
    m = load_module()
    test_script(m)
    n = check_data(m, re_dir)
    for f in fails[:40]:
        print("FAIL " + f)
    if fails:
        print("%d problems" % len(fails))
        return 1
    print("skills OK (%d trees)" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
