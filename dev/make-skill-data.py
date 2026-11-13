#!/usr/bin/env python3
"""Builds the Skills database: every skill tree, what each level does, and everything that gives it.

Input: hvmhfz_re `data/skills_db.json` (`tools/items/skills_db.py build`: the client's skill activation table,
skill names and descriptions, the skill points of every armour piece, decoration and Road gem (Tower Deco), the
automatic skills of weapons and armour, the Road skills and the Tower sigils) and `data/skill_categories.tsv`
(each tree's section in the community "Armor Skill List", checked against the client by
`tools/items/skills_pdf_check.py`; hvmhfz_re docs/skills-db.md). This site's data/items/index.json (item names and
icons) and data/equipment/<slot>/names.json (which pieces have an equipment page).

Writes:
  - data/skills/index.json      {"_about", "categories", "trees": [[id, name, category, [[points, skill id, skill
                                name]], armour pieces players can get, all armour pieces, decorations, Road gems,
                                automatic]], "road": [[id, name, tab, levels, where, [level texts], restored]],
                                "sigils": [[item, name, family, group, effect]]}: the Skills list, the skill page's
                                names and the site search;
  - data/skills/<tree id>.json  {"id", "name", "category", "levels": [[points, skill id, name, description]],
                                "armour": [[slot, id, name, rarity, points, obtainable, page]], "decorations": [[item,
                                name, "d" decoration or "g" Road gem, slots, points, obtainable, icon]], "automatic":
                                [[slot, id, name, skill id, obtainable, page]]}: one skill's page;
  - data/skills/pieces/<slot>/<id // 1024>.json  {"p": {id: [[tree, points]]}, "a": {id: [skill id]}}: the
                                "Skills" line of the equipment page;
  - data/skills/items/<item // 1024>.json  {"d": {item: [[tree, points]]}, "s": {item: index in "sigils"}}: the
                                item page's "Skills" line.
Armour rows the client names "Dummy", "ダミー" or nothing are left out (placeholders, nobody can get them).

Usage: python3 dev/make-skill-data.py [--re /root/mhfz/hvmhfz_re]
Check: python3 dev/check-skills.py ("skills OK": tests this script and checks the files against the input).
"""
import csv
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RE_DIR = pathlib.Path("/root/mhfz/hvmhfz_re")
SLOTS = ("head", "chest", "arms", "waist", "legs", "melee", "ranged")
CATEGORIES = ("Health and Stamina", "Offensive", "Defensive", "Blademaster", "Gunner", "Hiden Skills",
              "Resistances", "Statuses", "Protection", "Items and Combination", "Map and Detection",
              "Gathering", "Rewards", "Other")
CHUNK = 1024
# A level at 16384 points can never be reached (armour gives at most a few hundred): the client's way to leave
# a level unused (Reflect+3, Encourage+2 repeated there). The page lists it as unreachable.
UNREACHABLE = 1000
DUMMY_NAMES = ("", "dummy", "ダミー")


def is_dummy(name):
    return name.strip().strip("－-").lower() in DUMMY_NAMES
ROAD_WHERE = {"both": "Hunting Road and Sky Corridor", "road": "Hunting Road only", "tower": "Sky Corridor only",
              "none": "not in the menu"}


def merged(pairs):
    """[[tree, points]] with a tree listed twice on one piece added up (arms 534 has tree 67 twice): the skill total
    adds every pair, so the piece gives the sum."""
    out = {}
    for tree, pts in pairs:
        out[tree] = out.get(tree, 0) + pts
    return [[t, p] for t, p in out.items() if p]


def read_categories(path):
    with open(path, encoding="utf-8") as f:
        rows = csv.DictReader((line for line in f if not line.startswith("#")), delimiter="\t")
        return {int(r["tree_id"]): r["category"] for r in rows}


def order(rows, points_at):
    """Most points first, then the ones players can get, then by name."""
    return sorted(rows, key=lambda r: (-abs(points_at(r)), -r["obtainable"], r["name"]))


def build(db, categories, item_index, pages):
    """(index, {tree id: page}, {slot: {chunk: {"p", "a"}}}, items) from skills_db.json."""
    skills = {int(k): v for k, v in db["skills"].items()}
    items = {r[0]: r for r in item_index}
    per_tree = {}
    for t in db["trees"]:
        cat = categories.get(t["id"], "Other")
        if cat not in CATEGORIES:
            raise ValueError("tree %d: unknown category %r" % (t["id"], cat))
        per_tree[t["id"]] = {"id": t["id"], "name": t["name"], "category": cat,
                             "levels": [[p, s, skills[s]["name"], skills[s]["desc"]] for p, s in t["levels"]],
                             "armour": [], "decorations": [], "automatic": []}
    skill_tree = {s: t["id"] for t in db["trees"] for _, s in t["levels"]}

    pieces = {s: {} for s in SLOTS}

    def piece(slot, eid):
        chunk = pieces[slot].setdefault(eid // CHUNK, {"p": {}, "a": {}})
        return chunk

    for a in order([a for a in db["armour"] if not is_dummy(a["name"])], lambda r: max(abs(p) for _, p in r["skills"])):
        for tree, pts in merged(a["skills"]):
            if tree in per_tree:
                per_tree[tree]["armour"].append([a["slot"], a["id"], a["name"], a["rarity"], pts,
                                                 int(a["obtainable"]), int(a["id"] in pages[a["slot"]])])
        piece(a["slot"], a["id"])["p"][str(a["id"])] = [[t, p] for t, p in merged(a["skills"]) if t in per_tree]
    for t in per_tree.values():
        t["armour"].sort(key=lambda r: (-r[4] if r[4] > 0 else 1000 - r[4], -r[5], -r[3], r[2]))

    deco_lines = {}
    for d in db["decorations"]:
        icon = items[d["item"]][2] if d["item"] in items else ""
        for tree, pts in merged(d["skills"]):
            if tree in per_tree:
                per_tree[tree]["decorations"].append([d["item"], d["name"], "g" if d["kind"] == "road-gem" else "d",
                                                      d["slots"], pts, int(d["obtainable"]), icon])
        deco_lines[str(d["item"])] = [[t, p] for t, p in merged(d["skills"]) if t in per_tree]
    for t in per_tree.values():
        t["decorations"].sort(key=lambda r: (r[2], -r[5], -r[4] if r[4] > 0 else 1000 - r[4], r[1]))

    for a in db["automatic"]:
        tree = skill_tree.get(a["skill"])
        if tree is None:
            raise ValueError("automatic skill %d is in no tree" % a["skill"])
        per_tree[tree]["automatic"].append([a["slot"], a["id"], a["name"], a["skill"], int(a["obtainable"]),
                                            int(a["id"] in pages[a["slot"]])])
        piece(a["slot"], a["id"])["a"].setdefault(str(a["id"]), []).append(a["skill"])
    for t in per_tree.values():
        t["automatic"].sort(key=lambda r: (SLOTS.index(r[0]), -r[4], r[2]))

    sigil_rows = [[s["item"], s["name"], s["family"], s["group"], s["effect"]] for s in db["sigils"]]
    index = {
        "_about": "dev/make-skill-data.py from hvmhfz_re data/skills_db.json (the client's tables) and "
                  "data/skill_categories.tsv; see hvmhfz_re docs/skills-db.md",
        "categories": list(CATEGORIES),
        "trees": [[t["id"], t["name"], t["category"], [[l[0], l[1], l[2]] for l in t["levels"]],
                   sum(1 for r in t["armour"] if r[5]), len(t["armour"]),
                   sum(1 for r in t["decorations"] if r[2] == "d"), sum(1 for r in t["decorations"] if r[2] == "g"),
                   len(t["automatic"])] for t in sorted(per_tree.values(), key=lambda t: t["name"].lower())],
        "road": [[r["id"], r["name"], r["tab"], r["max_level"], ROAD_WHERE.get(r["mode"], r["mode"]),
                  r["levels"] or ([r["text"]] if r["text"] else []), int(r["restored"])] for r in db["road_skills"]],
        "sigils": sigil_rows,
    }
    item_lines = {}
    for item, lines in deco_lines.items():
        item_lines.setdefault(int(item) // CHUNK, {"d": {}, "s": {}})["d"][item] = lines
    for i, s in enumerate(sigil_rows):
        item_lines.setdefault(s[0] // CHUNK, {"d": {}, "s": {}})["s"][str(s[0])] = i
    return index, per_tree, pieces, item_lines


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
                    encoding="utf-8")


def write(index, per_tree, pieces, item_lines, out=DATA):
    target = out / "skills"
    if target.exists():
        shutil.rmtree(target)
    dump(target / "index.json", index)
    for tid, t in per_tree.items():
        dump(target / ("%d.json" % tid), t)
    for slot, chunks in pieces.items():
        for c, data in chunks.items():
            dump(target / "pieces" / slot / ("%d.json" % c), data)
    for c, data in item_lines.items():
        dump(target / "items" / ("%d.json" % c), data)


def load_inputs(re_dir, out=DATA):
    db = json.loads((re_dir / "data" / "skills_db.json").read_text(encoding="utf-8"))
    categories = read_categories(re_dir / "data" / "skill_categories.tsv")
    item_index = json.loads((out / "items" / "index.json").read_text(encoding="utf-8"))["items"]
    pages = {}
    for slot in SLOTS:
        names = json.loads((out / "equipment" / slot / "names.json").read_text(encoding="utf-8"))["names"]
        pages[slot] = {i for i, n in enumerate(names) if n}
    return db, categories, item_index, pages


def main(argv):
    re_dir = RE_DIR
    if len(argv) == 3 and argv[1] == "--re":
        re_dir = pathlib.Path(argv[2])
    elif len(argv) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    index, per_tree, pieces, item_lines = build(*load_inputs(re_dir))
    write(index, per_tree, pieces, item_lines)
    print("skills: %d trees, %d armour lines, %d decoration lines, %d automatic, %d Road skills, %d sigils" % (
        len(per_tree), sum(len(t["armour"]) for t in per_tree.values()),
        sum(len(t["decorations"]) for t in per_tree.values()), sum(len(t["automatic"]) for t in per_tree.values()),
        len(index["road"]), len(index["sigils"])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
