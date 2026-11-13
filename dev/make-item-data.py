#!/usr/bin/env python3
"""Builds the item data the item page and the catalog read.

Sources (all in this repo except the optional server names):
  - data/item-ids.json      the game's item id (decimal) -> name, from the overlay database (16,701 items;
                            the names the monster drop tables use);
  - data/item-icons.json    item id -> the game's icon key (/assets/icons/1x/<key>.png; README "Game icons");
  - data/monsters/*.json    drops: every row carries the item's id as 4 hex digits ("hex": "19EB");
  - data/monsters/game/<id>.json   the game's own drop tables (dev/make-monster-data.py); used only for a
                            monster the community drop tables above don't list for that item;
  - data/quest-details.json + data/quests.json   quests that need an item to enter (requirementItemId);
  - data/quests/rewards/<n>.json   the quest files' reward groups (dev/make-monster-data.py): quests that
                            reward the item, per group ("every clear", "main target", ...);
  - the server's item table (GET /api/public/catalog/items, about 12k rows), whose ids are the same numbers
    byte-swapped ("EB19" is 0x19EB = 6635) and whose English names often differ ("Rainbow Wyvern Tears" for
    Wyvern Prisma Tear). Those names become `aka`, so a search by either name finds the item.

Writes:
  - data/items/index.json   {"items": [[id, name, icon, aka, sources], ...]} sorted by id; icon/aka "" when none,
                            sources = how many drop rows, quest needs, quest rewards, other sources ("where") and
                            gathering quests mention it;
  - data/items/<id>.json    one file per item with sources: {"id", "name", "drops": [...], "quests": [...],
                            "rewards": [...]}, drops as {"slug", "monster", "rank", "method", "qty", "pct"}
                            (plus "game": true for a row from the game's drop tables; "slug" null when the
                            monster has no page), quests as {"id", "name", "count"}, rewards as
                            [quest id, quest name, rank, when, qty, pct] sorted by chance, best first: one row per
                            quest and reward group, pct the chance summed over the group's lines for this item
                            and qty a number or "min-max" when those lines give different amounts. The keys
                            "where", "gather", "offered" and "unlisted" come from dev/make-source-data.py and are
                            kept as they are (run that after this when the sources change).

Usage: python3 dev/make-item-data.py            fetches the server names (about 125 requests, throttled)
       python3 dev/make-item-data.py --offline  keeps the `aka` names already in data/items/index.json
"""
import json
import pathlib
import re
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "items"
API = "https://api.hvmhfz.eclipseforge.xyz/api/public/catalog/items"
SOURCE_KEYS = ("where", "gather", "offered", "unlisted")  # written by dev/make-source-data.py


def load(path):
    return json.loads((DATA / path).read_text(encoding="utf-8"))


def server_names():
    """{decimal id: server name} from the API's item table (ids are byte-swapped hex)."""
    names, page = {}, 0
    while True:
        with urllib.request.urlopen(f"{API}?q=&page={page}&size=100", timeout=30) as r:
            data = json.load(r)
        for it in data["items"]:
            raw = it.get("id") or ""
            if len(raw) == 4:
                names[int(raw[2:4] + raw[0:2], 16)] = (it.get("name") or "").strip()
        page += 1
        if page * data["size"] >= data["total"]:
            return names
        time.sleep(0.6)  # the public API allows 120 requests a minute


def main():
    offline = "--offline" in sys.argv
    names = {int(k): v.strip() for k, v in load("item-ids.json").items()}
    icons = {int(k): v for k, v in load("item-icons.json").items()}

    if offline:
        old = json.loads((OUT / "index.json").read_text(encoding="utf-8"))["items"]
        aka = {row[0]: row[3] for row in old if row[3]}
    else:
        aka = {}
        for iid, sname in server_names().items():
            if iid in names and sname and sname.lower() != names[iid].lower():
                aka[iid] = sname

    drops = {}
    index = load("monsters/index.json")
    monsters = index["monsters"] if isinstance(index, dict) else index
    for m in monsters:
        path = DATA / "monsters" / (m["slug"] + ".json")
        if not path.exists():
            continue
        detail = json.loads(path.read_text(encoding="utf-8"))
        for section in (detail.get("drops") or {}).get("sections") or []:
            for row in section.get("drops") or []:
                for it in row.get("items") or []:
                    hexid = it.get("hex")
                    if not hexid:
                        continue
                    iid = int(hexid, 16)
                    drops.setdefault(iid, []).append({
                        "slug": m["slug"], "monster": detail.get("name") or m.get("name"),
                        "rank": row.get("rank") or "", "method": section.get("method") or "",
                        "qty": it.get("qty") or 1, "pct": it.get("pct")})

    # The game's own drop tables, for a monster the community tables don't list for this item. `listed` is
    # taken before the loop, so every game table that has the item is kept (one row per rank and method).
    listed = {(iid, row["slug"]) for iid, rows in drops.items() for row in rows}
    for path in sorted((DATA / "monsters" / "game").glob("*.json"), key=lambda p: p.stem):
        if path.name == "index.json":
            continue
        game = json.loads(path.read_text(encoding="utf-8"))
        who = game.get("slug") or game.get("name")
        if not game.get("slug") and re.fullmatch(r"Mon\d+", game.get("name") or "Mon0"):
            continue  # no page and only the game's placeholder name: nothing a reader could use
        for table in game.get("drops") or []:
            for section in table.get("sections") or []:
                for it in section.get("items") or []:
                    iid = it[0]
                    if not iid or (iid, who) in listed:
                        continue
                    drops.setdefault(iid, []).append({
                        "slug": game.get("slug"), "monster": game.get("name") or "Monster " + str(game["id"]),
                        "rank": table.get("rank") or "", "method": section.get("method") or "",
                        "qty": it[3] if len(it) > 3 else 1, "pct": it[2], "game": True})
    quest_names = {q["id"]: q["name"] for q in load("quests.json")["quests"]}
    quests = {}
    for qid, d in load("quest-details.json").items():
        iid = d.get("requirementItemId")
        if iid and int(qid) in quest_names:
            quests.setdefault(int(iid), []).append(
                {"id": int(qid), "name": quest_names[int(qid)], "count": d.get("requirementCount") or 1})

    rewards = {}
    for path in sorted((DATA / "quests" / "rewards").glob("*.json"), key=lambda p: int(p.stem)):
        shard = json.loads(path.read_text(encoding="utf-8"))
        for qid, q in shard["quests"].items():
            if int(qid) not in quest_names:  # no quest page to link to
                continue
            for group in q.get("rewards") or []:
                lines = {}
                for iid, qty, pct in group.get("items") or []:
                    if iid:
                        lines.setdefault(iid, []).append((qty, pct or 0))
                for iid, got in lines.items():
                    low, high = min(g[0] for g in got), max(g[0] for g in got)
                    rewards.setdefault(iid, []).append([
                        int(qid), quest_names[int(qid)], q.get("rank") or "", group.get("when") or "",
                        low if low == high else f"{low}-{high}", round(sum(g[1] for g in got), 2)])

    OUT.mkdir(exist_ok=True)
    kept = {}  # dev/make-source-data.py's keys (where to get it), kept as they are
    for old in OUT.glob("*.json"):
        if old.name != "index.json":
            prev = json.loads(old.read_text(encoding="utf-8"))
            keep = {k: prev[k] for k in SOURCE_KEYS if k in prev}
            if keep:
                kept[prev["id"]] = keep
            old.unlink()
    rows = []
    for iid in sorted(names):
        d = sorted(drops.get(iid, []), key=lambda x: (x["monster"], x["rank"], x["method"]))
        q = sorted(quests.get(iid, []), key=lambda x: x["id"])
        r = sorted(rewards.get(iid, []), key=lambda x: (-x[5], x[0], x[3]))
        keep = kept.get(iid, {})
        rows.append([iid, names[iid], icons.get(iid, ""), aka.get(iid, ""),
                     len(d) + len(q) + len(r) + len(keep.get("where", [])) + len(keep.get("gather", []))])
        if d or q or r or keep:
            (OUT / f"{iid}.json").write_text(json.dumps(
                dict({"id": iid, "name": names[iid], "drops": d, "quests": q, "rewards": r}, **keep),
                ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "index.json").write_text(json.dumps({"items": rows}, ensure_ascii=False, separators=(",", ":")),
                                    encoding="utf-8")
    with_src = sum(1 for r in rows if r[4])
    print(f"{len(rows)} items, {with_src} with sources, {len(aka)} with a server name, "
          f"{sum(len(v) for v in drops.values())} drop rows, {sum(len(v) for v in quests.values())} quest needs, "
          f"{sum(len(v) for v in rewards.values())} quest rewards")


if __name__ == "__main__":
    main()
