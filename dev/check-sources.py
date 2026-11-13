#!/usr/bin/env python3
"""Checks the Database's item sources (dev/make-source-data.py) and tests that script.

  python3 dev/check-sources.py     "sources OK"

1. Tests make-source-data.py's build() on a small made-up hvmhfz_re detail file.
2. Checks the data: every source in data/sources/index.json has its page file with the same id, group and item
   count, and every file is listed; every item a source page or an item's "where" names (and every material) is
   in data/items/index.json, so each /item.html?id= link resolves; every "where" names a listed source (each
   /source.html?id= link resolves) or a monster the monster index knows by id or by name; every item file with
   source keys is counted in the index (so the item page loads it), and every item a source page lists has the
   source in its "where" (linked both ways). Quests an item links that have no page are named (shown as text).
"""
import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def load_module():
    spec = importlib.util.spec_from_file_location("make_source_data", ROOT / "dev" / "make-source-data.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_build(mod):
    detail = {
        "taken_at": "2026-11-13T02:09:57Z",
        "sources": {"road-shop-4": {"name": "Hunting Road shop: Decorations", "group": "shop", "cur": "RdP", "about": "a"},
                    "combining": {"name": "Item combining", "group": "craft", "cur": "", "about": "b"},
                    "monster-104": {"name": "Abiorugu", "group": "monster", "cur": "", "about": ""}},
        "rows": [{"item": 1, "src": "road-shop-4", "qty": 1, "price": 35000, "gate": "GR1"},
                 {"item": 2, "src": "combining", "qty": 1, "mats": [[1, 1], [3, 2]], "cur": ""},
                 {"item": 2, "src": "monster-104", "monster": 104, "when": "G", "methods": ["carve"]},
                 {"item": 99, "src": "road-shop-4", "price": 1}],
        "quests": {"1": {"reward": [10, 11], "gather": [12], "unlisted_reward": 4}, "3": {"unlisted_gather": 2}},
    }
    index, pages, per_item = mod.build(detail, {1: "Gem", 2: "Potion", 3: "Herb"})
    problems = []

    def want(ok, what):
        if not ok:
            problems.append("make-source-data build: " + what)
    want(sorted(pages) == ["combining", "gathering", "quest-rewards", "road-shop-4"], "pages %s" % sorted(pages))
    want(index["skipped"] == 1, "the unknown item 99 is skipped")
    want([s[0] for s in index["sources"]] == ["road-shop-4", "combining", "gathering", "quest-rewards"],
         "sources in group order %s" % [s[0] for s in index["sources"]])
    want(index["taken"] == "2026-11-13", "taken date")
    want(per_item[1]["where"] == [["road-shop-4", {"qty": 1, "price": 35000, "gate": "GR1"}]], "item 1 where")
    want(per_item[1]["offered"] == [10, 11] and per_item[1]["gather"] == [12] and per_item[1]["unlisted"] == [4, 0],
         "item 1 quests")
    want(["monster", {"monster": 104, "when": "G", "methods": ["carve"], "name": "Abiorugu"}] in per_item[2]["where"],
         "monster rows go to the item with the monster's name")
    want(per_item[3] == {"unlisted": [0, 2]}, "item 3 only unlisted")
    want(pages["gathering"]["rows"] == [{"item": 1, "quests": 1}], "gathering page")
    return problems


def check_data():
    problems, notes = [], []
    items = {r[0]: r for r in json.loads((DATA / "items" / "index.json").read_text(encoding="utf-8"))["items"]}
    index = json.loads((DATA / "sources" / "index.json").read_text(encoding="utf-8"))
    groups = {g[0] for g in index["groups"]}
    listed = {s[0]: s for s in index["sources"]}
    files = {p.stem for p in (DATA / "sources").glob("*.json") if p.name != "index.json"}
    for extra in sorted(files - set(listed)):
        problems.append(f"data/sources/{extra}.json is not in index.json")
    by_source = {}
    for sid, s in listed.items():
        path = DATA / "sources" / f"{sid}.json"
        if not path.exists():
            problems.append(f"source {sid}: no data/sources/{sid}.json (/source.html?id={sid} would fail)")
            continue
        page = json.loads(path.read_text(encoding="utf-8"))
        if page["id"] != sid or page["group"] != s[2] or s[2] not in groups:
            problems.append(f"source {sid}: id or group differs from the index")
        mine = {r["item"] for r in page["rows"]}
        by_source[sid] = mine
        if len(mine) != s[4]:
            problems.append(f"source {sid}: index says {s[4]} items, the page has {len(mine)}")
        for r in page["rows"]:
            for i in [r["item"]] + [m[0] for m in r.get("mats", [])]:
                if i not in items:
                    problems.append(f"source {sid}: item {i} is not in data/items/index.json")
    monsters = json.loads((DATA / "monsters" / "index.json").read_text(encoding="utf-8"))
    monsters = monsters["monsters"] if isinstance(monsters, dict) else monsters
    monster_ids = {i for m in monsters for i in m.get("ids") or []}
    quests = {q[0] for q in json.loads((DATA / "search" / "quests.json").read_text(encoding="utf-8"))["quests"]}
    where_of, no_page, no_monster_page = {}, set(), set()
    for path in (DATA / "items").glob("*.json"):
        if path.name == "index.json":
            continue
        d = json.loads(path.read_text(encoding="utf-8"))
        has = any(k in d for k in ("where", "gather", "offered", "unlisted"))
        if has and d["id"] not in items:
            problems.append(f"item {d['id']}: has a file but no index row")
            continue
        if (d.get("where") or d.get("gather")) and not items[d["id"]][4]:
            problems.append(f"item {d['id']}: has sources but its index count is 0 (the page would not load them)")
        for sid, r in d.get("where") or []:
            if sid == "monster":
                if r.get("monster") not in monster_ids:
                    no_monster_page.add(r.get("name"))
                continue
            if sid not in listed:
                problems.append(f"item {d['id']}: source {sid} is not in data/sources/index.json")
            where_of.setdefault(sid, set()).add(d["id"])
            for m in r.get("mats", []):
                if m[0] not in items:
                    problems.append(f"item {d['id']}: material {m[0]} is not in data/items/index.json")
        if d.get("offered"):
            where_of.setdefault("quest-rewards", set()).add(d["id"])
        if d.get("gather"):
            where_of.setdefault("gathering", set()).add(d["id"])
        no_page |= {q for q in (d.get("gather") or []) + (d.get("offered") or []) if q not in quests}
    for sid, mine in by_source.items():
        if mine != where_of.get(sid, set()):
            problems.append(f"source {sid}: {len(mine ^ where_of.get(sid, set()))} items not linked both ways")
    if no_page:
        notes.append(f"{len(no_page)} quests without a quest page, shown as text: {sorted(no_page)[:10]}")
    if no_monster_page:
        notes.append(f"{len(no_monster_page)} monsters without a page, shown as text: {sorted(no_monster_page)[:8]}")
    n_items = sum(1 for p in (DATA / 'items').glob('*.json') if p.name != 'index.json')
    notes.append(f"{len(listed)} sources, {sum(len(v) for v in by_source.values())} source-item pairs, {n_items} item files")
    return problems, notes


def main():
    problems = test_build(load_module())
    more, notes = check_data()
    problems += more
    for n in notes:
        print(n)
    for p in problems[:50]:
        print("FAIL", p)
    if problems:
        print(f"{len(problems)} problem(s)")
        return 1
    print("sources OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
