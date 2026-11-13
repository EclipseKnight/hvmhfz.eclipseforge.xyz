#!/usr/bin/env python3
"""Builds the Database's item sources: where every item comes from, and one page per source.

Input: hvmhfz_re `data/item_sources_detail.json` (`tools/items/item_sources.py build`, docs/item-sources.md section
14): every source of every item (shops, gacha, events and gifts, the Sky Corridor, crafting, exchanges) as
structured rows, and per item the quests players can start that reward it or let you gather it. Item names come
from this site's data/items/index.json (dev/make-item-data.py), so run that first.

Writes:
  - data/sources/index.json   {"_about", "taken", "groups": [[id, name, about]], "sources": [[id, name, group,
                              currency, items, about]]}: every source page, for sources.html, the item page and
                              the search;
  - data/sources/<id>.json    one source: {"id", "name", "group", "cur", "about", "rows": [{"item", "qty", "price",
                              "chance", "limit", "gate", "when", "note", "builtin", "cur", "mats": [[item, qty]],
                              "pieces": [[slot, id, name]], "quests"}]} (fields only where set);
  - data/items/<id>.json      adds "where": [[source id, row without item]] (monster drops in quests players can
                              start as ["monster", {"monster": game id, "name", "when": rank, "methods", "note"}]),
                              "gather" (quest ids players can start
                              that let you gather it), "offered" (the quests of "rewards" that players can start)
                              and "unlisted": [reward, gather] (quest files no list offers); makes the file for an
                              item that has only these, and counts them in data/items/index.json (the 5th field).
                              dev/make-item-data.py keeps these keys when it rewrites the item files.

Usage: python3 dev/make-source-data.py [--re /root/mhfz/hvmhfz_re/data/item_sources_detail.json]
Check: python3 dev/check-sources.py (every source page and item link resolves; tests this script too).
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RE_DETAIL = pathlib.Path("/root/mhfz/hvmhfz_re/data/item_sources_detail.json")
SOURCE_KEYS = ("where", "gather", "offered", "unlisted")

GROUPS = [
    ("shop", "Shops", "Bought for Road points (RdP), GCP, Frontier points or zenny."),
    ("gacha", "Gacha", "Gacha prizes; the chance is per draw of the gacha's prize list."),
    ("event", "Events and gifts", "Event campaigns, the Hunter Festival, Diva Defense, the weekly conquest, cups and gifts."),
    ("sky", "Sky Corridor", "The tower's treasure by district and its present box."),
    ("craft", "Crafting", "Made at the smithy, the Tower Felyne, the Combiner, the cuff workshop or by combining."),
    ("exchange", "Exchanges and other rewards", "Lotteries, guild treasure hunts, stamp cards, the Raviente claim and quest supplies."),
    ("quest", "Quests", "Quest rewards and gathering in quests players can start."),
]
QUEST_SOURCES = {
    "quest-rewards": ("Quest rewards", "Items in the reward groups of quests players can start (the quest lists, events, "
                      "cups and the Sky Corridor). Each item's page lists the quests and chances."),
    "gathering": ("Gathering in quests", "Items you can gather (gathering points, fishing, mining, bug catching) in quests "
                  "players can start. Each item's page lists the quests."),
}


def build(detail, names):
    """(index, pages, per_item) from the hvmhfz_re detail and this site's item names {id: name}. Rows of items the
    site does not know are left out (counted in index["skipped"])."""
    sources = detail["sources"]
    pages, per_item, skipped = {}, {}, 0
    for sid, s in sources.items():
        if s["group"] == "monster":
            continue  # the monster pages and the item page's "Dropped by" cover drops
        pages[sid] = {"id": sid, "name": s["name"], "group": s["group"], "cur": s.get("cur", ""),
                      "about": s.get("about", ""), "rows": []}
    for r in detail["rows"]:
        if r["item"] not in names:
            skipped += 1
            continue
        if sources[r["src"]]["group"] == "monster":
            # no page of its own: the item page links the monster's page (by its game id, "monster")
            row = {k: v for k, v in r.items() if k not in ("src", "item")}
            row["name"] = sources[r["src"]]["name"]
            per_item.setdefault(r["item"], {}).setdefault("where", []).append(["monster", row])
            continue
        page = pages.get(r["src"])
        if page is None:
            continue
        row = {k: v for k, v in r.items() if k != "src"}
        page["rows"].append(row)
        per_item.setdefault(r["item"], {}).setdefault("where", []).append(
            [r["src"], {k: v for k, v in row.items() if k != "item"}])
    for sid, (name, about) in QUEST_SOURCES.items():
        pages[sid] = {"id": sid, "name": name, "group": "quest", "cur": "", "about": about, "rows": []}
    for key, q in sorted(detail.get("quests", {}).items(), key=lambda kv: int(kv[0])):
        item = int(key)
        if item not in names:
            skipped += 1
            continue
        mine = per_item.setdefault(item, {})
        if q.get("reward"):
            mine["offered"] = q["reward"]
            pages["quest-rewards"]["rows"].append({"item": item, "quests": len(q["reward"])})
        if q.get("gather"):
            mine["gather"] = q["gather"]
            pages["gathering"]["rows"].append({"item": item, "quests": len(q["gather"])})
        if q.get("unlisted_reward") or q.get("unlisted_gather"):
            mine["unlisted"] = [q.get("unlisted_reward", 0), q.get("unlisted_gather", 0)]
    pages = {k: v for k, v in pages.items() if v["rows"]}
    order = {g[0]: i for i, g in enumerate(GROUPS)}
    listed = sorted(pages.values(), key=lambda p: (order[p["group"]], p["name"].lower()))
    index = {
        "_about": "Every item source on the Database's Sources pages, written by dev/make-source-data.py from hvmhfz_re "
                  "data/item_sources_detail.json. sources: [id, name, group, currency, items, about].",
        "taken": (detail.get("taken_at") or "")[:10],
        "groups": [list(g) for g in GROUPS if any(p["group"] == g[0] for p in listed)],
        "sources": [[p["id"], p["name"], p["group"], p["cur"], len({r["item"] for r in p["rows"]}), p["about"]]
                    for p in listed],
        "skipped": skipped,
    }
    return index, pages, per_item


def merge_items(items_dir, per_item, names):
    """Puts the source keys into data/items/<id>.json and the counts into index.json. An item file left with no
    drops, quests, rewards or source keys is deleted (dev/make-item-data.py writes none for such an item)."""
    index_path = items_dir / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    counts = {}
    for path in items_dir.glob("*.json"):
        if path.name == "index.json":
            continue
        d = json.loads(path.read_text(encoding="utf-8"))
        old = {k: d.pop(k) for k in SOURCE_KEYS if k in d}
        new = per_item.get(d["id"], {})
        d.update({k: new[k] for k in SOURCE_KEYS if k in new})
        if not (d["drops"] or d["quests"] or d["rewards"] or new):
            path.unlink()  # its last source is gone: no file, as dev/make-item-data.py would write it
            continue
        counts[d["id"]] = sum(len(d.get(k) or []) for k in ("drops", "quests", "rewards", "where", "gather"))
        if old != {k: new[k] for k in SOURCE_KEYS if k in new}:
            path.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for item, new in per_item.items():
        path = items_dir / f"{item}.json"
        if item in counts:
            continue
        d = {"id": item, "name": names[item], "drops": [], "quests": [], "rewards": []}
        d.update({k: new[k] for k in SOURCE_KEYS if k in new})
        counts[item] = len(d.get("where") or []) + len(d.get("gather") or [])
        path.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for row in index["items"]:
        row[4] = counts.get(row[0], 0)
    index_path.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write(index, pages, out_dir):
    out_dir.mkdir(exist_ok=True)
    for old in out_dir.glob("*.json"):
        old.unlink()
    for sid, page in pages.items():
        (out_dir / f"{sid}.json").write_text(json.dumps(page, ensure_ascii=False, separators=(",", ":")),
                                             encoding="utf-8")
    (out_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")),
                                        encoding="utf-8")


def main(argv):
    src = RE_DETAIL
    if "--re" in argv:
        src = pathlib.Path(argv[argv.index("--re") + 1])
    detail = json.loads(src.read_text(encoding="utf-8"))
    items = json.loads((DATA / "items" / "index.json").read_text(encoding="utf-8"))["items"]
    names = {r[0]: r[1] for r in items}
    index, pages, per_item = build(detail, names)
    write(index, pages, DATA / "sources")
    merge_items(DATA / "items", per_item, names)
    with_src = sum(1 for v in per_item.values() if v.get("where") or v.get("offered") or v.get("gather"))
    print(f"{len(pages)} sources, {sum(len(p['rows']) for p in pages.values())} rows, {len(per_item)} items with "
          f"source data ({with_src} with a source players can use), {index['skipped']} rows of items the site lacks")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
