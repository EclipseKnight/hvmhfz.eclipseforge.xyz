#!/usr/bin/env python3
"""Writes the two small name indexes the site search (js/search.js: the header search and the Database page's
search box) reads for quests and weapons, so a search never loads data/quests.json (3.2 MB) or every weapon type
file (1.4 MB):

- data/search/quests.json:  {"categories": [...], "monsters": [...], "quests": [[id, name, category, [monster, ...]]]}
  from data/quests.json; category and monsters are positions in the two lists (most used first). Opens
  /quest.html?id=<id>.
- data/search/weapons.json: {"types": [[slug, name], ...], "weapons": [[type, id, name, rarity]]} from the type files
  data/weapons/<slug>.json (the order of data/weapons/index.json); type is a position in "types". Opens
  /weapons.html?type=<slug>&w=<id>.

Run it after data/quests.json or the weapon data change (make-quest-monsters.py, make-weapons-data.py):
  python3 dev/make-search-index.py
  python3 dev/make-search-index.py --check   # change nothing; exit 1 when data/search/ is out of date
                                             # (run by dev/check-db-search.js)
"""
import collections
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "search"


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n"


def by_use(counter):
    return [name for name, _ in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))]


def quests():
    rows = json.loads((ROOT / "data" / "quests.json").read_text(encoding="utf-8"))["quests"]
    rows = sorted(rows, key=lambda q: q["id"])
    cats = by_use(collections.Counter(q.get("category") or "" for q in rows))
    mons = by_use(collections.Counter(m for q in rows for m in q.get("monsters") or []))
    ci, mi = {c: i for i, c in enumerate(cats)}, {m: i for i, m in enumerate(mons)}
    return dump({
        "_about": "Quest names for the site search, written by dev/make-search-index.py from data/quests.json: "
                  "[id, name, category, [monster, ...]], category and monsters as positions in the lists.",
        "categories": cats, "monsters": mons,
        "quests": [[q["id"], q.get("name") or "", ci[q.get("category") or ""],
                    [mi[m] for m in q.get("monsters") or []]] for q in rows]})


def weapons():
    index = json.loads((ROOT / "data" / "weapons" / "index.json").read_text(encoding="utf-8"))
    types, rows = [], []
    for t in index["types"]:
        path = ROOT / "data" / "weapons" / (t["slug"] + ".json")
        if not path.exists():
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        at = {name: doc["fields"].index(name) for name in ("id", "name", "rarity")}
        for w in doc["weapons"]:
            rows.append([len(types), w[at["id"]], w[at["name"]], w[at["rarity"]]])
        types.append([t["slug"], t["name"]])
    return dump({
        "_about": "Weapon names for the site search, written by dev/make-search-index.py from data/weapons/<type>.json: "
                  "[type, id, name, rarity], type as a position in types.",
        "types": types, "weapons": rows})


def main(args):
    want = {"quests.json": quests(), "weapons.json": weapons()}
    stale = [name for name, text in want.items()
             if not (OUT / name).exists() or (OUT / name).read_text(encoding="utf-8") != text]
    if "--check" in args:
        if stale:
            print("data/search/: %s out of date; run python3 dev/make-search-index.py" % ", ".join(stale))
            return 1
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for name in stale:
        (OUT / name).write_text(want[name], encoding="utf-8")
    for name, text in want.items():
        print("data/search/%s: %d bytes%s" % (name, len(text.encode("utf-8")), " (written)" if name in stale else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
