#!/usr/bin/env python3
"""Builds the item data the item page and the catalog read.

Sources (all in this repo except the optional server names):
  - data/item-ids.json      the game's item id (decimal) -> name, from the overlay database (16,701 items;
                            the names the monster drop tables use);
  - data/item-icons.json    item id -> the game's icon key (/assets/icons/1x/<key>.png; README "Game icons");
  - data/monsters/*.json    drops: every row carries the item's id as 4 hex digits ("hex": "19EB");
  - data/quest-details.json + data/quests.json   quests that need an item to enter (requirementItemId);
  - the server's item table (GET /api/public/catalog/items, about 12k rows), whose ids are the same numbers
    byte-swapped ("EB19" is 0x19EB = 6635) and whose English names often differ ("Rainbow Wyvern Tears" for
    Wyvern Prisma Tear). Those names become `aka`, so a search by either name finds the item.

Writes:
  - data/items/index.json   {"items": [[id, name, icon, aka, sources], ...]} sorted by id; icon/aka "" when none,
                            sources = how many drop rows and quests mention it;
  - data/items/<id>.json    one file per item with sources: {"id", "name", "drops": [...], "quests": [...]},
                            drops as {"slug", "monster", "rank", "method", "qty", "pct"}, quests as
                            {"id", "name", "count"}.

Usage: python3 dev/make-item-data.py            fetches the server names (about 125 requests, throttled)
       python3 dev/make-item-data.py --offline  keeps the `aka` names already in data/items/index.json
"""
import json
import pathlib
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "items"
API = "https://api.hvmhfz.eclipseforge.xyz/api/public/catalog/items"


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

    quest_names = {q["id"]: q["name"] for q in load("quests.json")["quests"]}
    quests = {}
    for qid, d in load("quest-details.json").items():
        iid = d.get("requirementItemId")
        if iid and int(qid) in quest_names:
            quests.setdefault(int(iid), []).append(
                {"id": int(qid), "name": quest_names[int(qid)], "count": d.get("requirementCount") or 1})

    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.json"):
        if old.name != "index.json":
            old.unlink()
    rows = []
    for iid in sorted(names):
        d = sorted(drops.get(iid, []), key=lambda x: (x["monster"], x["rank"], x["method"]))
        q = sorted(quests.get(iid, []), key=lambda x: x["id"])
        rows.append([iid, names[iid], icons.get(iid, ""), aka.get(iid, ""), len(d) + len(q)])
        if d or q:
            (OUT / f"{iid}.json").write_text(json.dumps(
                {"id": iid, "name": names[iid], "drops": d, "quests": q},
                ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "index.json").write_text(json.dumps({"items": rows}, ensure_ascii=False, separators=(",", ":")),
                                    encoding="utf-8")
    with_src = sum(1 for r in rows if r[4])
    print(f"{len(rows)} items, {with_src} with sources, {len(aka)} with a server name, "
          f"{sum(len(v) for v in drops.values())} drop rows, {sum(len(v) for v in quests.values())} quest needs")


if __name__ == "__main__":
    main()
