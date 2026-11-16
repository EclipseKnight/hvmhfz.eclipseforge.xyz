#!/usr/bin/env python3
"""Builds what every item is used for, and the material list of every piece of equipment.

Input: hvmhfz_re `data/item_uses.json` (`tools/items/item_uses.py build`): every recipe of the client's tables
that takes items (smithy weapon and armour create / upgrade lists, transmog unlocks, decorations, skill cuffs,
item combining, the Combiner, the Tower smithy and its weapon upgrades, the Series Quests exchanges);
`item_info.json` beside it when there is one (hvmhfz_re `tools/items/item_info.py`: every item's description,
facts and the uses its own data shows: item pouch, ammo, coating, S.Crystal, cooking, decoration skills, Road
gems, Partnya jewels, sigils, and from live the Frontier Point trade-ins, the GCP sell list and gacha roll
costs); this site's data/quest-objectives.json (deliver objectives), data/search/quests.json (quest names),
data/items/index.json (item names and icons) and data/items/<id>.json (written before this by
dev/make-source-data.py: "where", "offered", "gather" = has a source, "quests" = needed to enter a quest).

Writes:
  - data/uses/<item id>.json   {"id", "rows": [...]} for every item with a use; rows, by group ("g"):
                               craft / deco / tower / exchange: {"g", "s" (system), "item" (made), "n" (count
                               made), "qty" (of this item), "with" [[item, qty]] (the other inputs), "price",
                               "cur", "note"}; gem mixer: {"g": "tower", "s": "gem-mixer", "any": how many gems
                               of any kind, "made": [[item, chance]]}; tower weapon upgrades: {"g": "tower",
                               "s": "tower-up", "eq": [slot, id], "stat", "levels", "qty"};
                               weapon / armour: [slot, id, qty, kind] (kind "c" made, "u" upgraded, "t"
                               transmog unlock); quest: {"g": "quest", "quest", "name", "qty", "obj" ("main",
                               "sub A", "sub B")}; what the item's own data says (item_info.json):
                               {"g": "use", "s": pouch | ammo | coating | crystal | cooking | deco | gem | jewel
                               | sigil} and {"g": "trade", "s": fp-trade ("qty", "fp") | gcp-sell ("qty", "gcp")
                               | gacha ("gacha" id, "name", "qty", "rolls")};
  - data/uses/index.json       {"_about", "items": {id: [uses, groups]}}: what the checks read;
  - data/uses/info/<id // 512>.json  {"items": {id: {"desc", "from" (game | site), "kind", "r", "stack",
                               "buy", "sell", "status", "slots"}}}: the item page's description and facts, for
                               every item of the index (only with item_info.json; skill points are
                               dev/make-skill-data.py's);
  - data/uses/status.json      {"_about", "no_use": [ids], "no_source": [ids], "unreleased": [ids]}: the Items
                               list's filters (no use = no row and no quest needs it; no source = no "where",
                               "offered" or "gather"; unreleased = an unused slot of the game's list with
                               neither);
  - data/equipment/<slot>/names.json  {"names": [[name, rarity, parent id or 0] or 0, ...] by id}: every piece a
                               recipe names, parent = the first piece it is upgraded from (the item page names
                               its rows, the equipment page draws the line and what it upgrades into);
  - data/equipment/<slot>/<id // 1024>.json  {"items": {id: [name, icon]}, "eq": {id: {"make": [[kind, from id
                               or 0, mats [[item, qty]], zenny or null, note]], "tower": [[stat, levels, mats]]}}}:
                               the equipment page's and the Weapons page's material lists.

Usage: python3 dev/make-use-data.py [--re /root/mhfz/hvmhfz_re/data/item_uses.json]
Check: python3 dev/check-uses.py ("uses OK": tests this script and checks every link of the files).
"""
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RE_USES = pathlib.Path("/root/mhfz/hvmhfz_re/data/item_uses.json")
WEAPON = ("melee", "ranged")
ARMOUR = ("head", "chest", "arms", "waist", "legs")
GROUP_OF = {"combining": "craft", "combiner": "craft", "deco": "deco", "cuff": "deco", "tower": "tower",
            "tower-gem": "tower", "gem-mixer": "tower", "tower-up": "tower", "series": "exchange"}
DELIVER = (2, 4098)     # data/objective-types.json: Deliver, Deliver Flag
OBJECTIVES = ("main", "sub A", "sub B")
CHUNK = 1024
INFO_CHUNK = 512
TRADE = ("fp-trade", "gcp-sell", "gacha")
INFO_KEYS = ("desc", "from", "kind", "r", "stack", "buy", "sell", "status", "slots")
SOURCE_KEYS = ("where", "offered", "gather")   # dev/make-source-data.py: the item has a source


def deliveries(objectives, quest_names):
    """{item: [quest row]} from data/quest-objectives.json, quests with a page only."""
    out = {}
    for qid, q in sorted(objectives.get("quests", {}).items(), key=lambda kv: int(kv[0])):
        qid = int(qid)
        if qid not in quest_names:
            continue
        for k, o in enumerate(q.get("o", [])[:3]):
            if len(o) == 3 and o[0] in DELIVER and o[1]:
                out.setdefault(o[1], []).append({"g": "quest", "quest": qid, "name": quest_names[qid],
                                                 "qty": o[2] or 1, "obj": OBJECTIVES[k]})
    return out


def info_rows(info):
    """{item: [row]} from item_info.json's "uses": what the item's own data says it is used for."""
    out = {}
    for item, e in (info or {}).items():
        for u in e.get("uses", []):
            row = dict(u, g="trade" if u["s"] in TRADE else "use")
            out.setdefault(int(item), []).append(row)
    return out


def item_uses(uses, delivered=None, info=None):
    """{item: {"rows"}} from the hvmhfz_re file: every recipe once under each item it takes, then what the
    item's own data says (info, item_info.json "items")."""
    out = {}

    def add(item, row):
        out.setdefault(item, {"rows": []})["rows"].append(row)

    for r in uses["recipes"]:
        slot, tid = r["t"]
        s = r["sys"]
        if s == "gem-mixer":
            for i in r.get("any", []):
                add(i, {"g": "tower", "s": s, "any": r.get("min", 1), "made": [[tid, r.get("chance")]]})
            continue
        qty = {}
        for i, q in r["mats"]:
            qty[i] = qty.get(i, 0) + q
        for i, q in qty.items():
            if s == "tower-up":
                add(i, {"g": "tower", "s": s, "eq": [slot, tid], "stat": r["stat"], "levels": r["levels"], "qty": q})
            elif slot != "item":
                add(i, [slot, tid, q, "t" if s == "transmog" else ("u" if "from" in r else "c")])
            else:
                row = {"g": GROUP_OF.get(s, "craft"), "s": s, "item": tid, "qty": q}
                if r.get("n", 1) != 1:
                    row["n"] = r["n"]
                other = [[m, n] for m, n in qty.items() if m != i]
                if other:
                    row["with"] = other
                for k in ("price", "cur", "note"):
                    if k in r:
                        row[k] = r[k]
                add(i, row)
    for item, rows in (delivered or {}).items():
        for row in rows:
            add(item, row)
    for item, rows in info_rows(info).items():
        for row in rows:
            add(item, row)
    # merge the gem mixer's rows of one item into one
    for e in out.values():
        mix = [r for r in e["rows"] if isinstance(r, dict) and r.get("s") == "gem-mixer"]
        if len(mix) > 1:
            mix[0]["made"] = sorted(m for r in mix for m in r["made"])
            e["rows"] = [r for r in e["rows"] if not (isinstance(r, dict) and r.get("s") == "gem-mixer")] + [mix[0]]
    return out


def group_of(row):
    if isinstance(row, list):
        return "weapon" if row[0] in WEAPON else "armour"
    return row["g"]


def equipment(uses):
    """({slot: names list}, {slot: {id: entry}}) for every piece a recipe names (see the module doc)."""
    eqn = uses["equipment"]
    parent, pieces = {}, {slot: {} for slot in eqn}
    for r in uses["recipes"]:
        slot, tid = r["t"]
        if slot == "item":
            continue
        e = pieces[slot].setdefault(tid, {"make": []})
        if r["sys"] == "tower-up":
            e.setdefault("tower", []).append([r["stat"], r["levels"], r["mats"]])
            continue
        frm = r.get("from", 0)
        e["make"].append(["t" if r["sys"] == "transmog" else ("u" if frm else "c"), frm, r["mats"],
                          r.get("zenny"), r.get("note", "")])
        if frm:
            parent.setdefault((slot, tid), frm)
            pieces[slot].setdefault(frm, {"make": []})
    names = {}
    for slot, known in eqn.items():
        top = max(int(i) for i in known)
        names[slot] = [0] * (top + 1)
        for i, (name, rarity) in known.items():
            names[slot][int(i)] = [name, rarity, parent.get((slot, int(i)), 0)]
    return names, pieces


def chunks(pieces, item_index):
    """{chunk: {"items", "eq"}} of one slot."""
    out = {}
    for i, e in sorted(pieces.items()):
        c = out.setdefault(i // CHUNK, {"items": {}, "eq": {}})
        c["eq"][str(i)] = e
        mats = [m for row in e["make"] for m in row[2]] + [m for row in e.get("tower", []) for m in row[2]]
        for item, _q in mats:
            row = item_index.get(item)
            c["items"][str(item)] = [row[1], row[2]] if row else ["Item %d" % item, ""]
    return out


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
                    encoding="utf-8")


def item_status(item_index, per_item, details, info):
    """{"no_use", "no_source", "unreleased"} id lists (see the module doc); details = {id: item file}."""
    no_use, no_source, unreleased = [], [], []
    for item in sorted(item_index):
        if not item:
            continue
        d = details.get(item) or {}
        used = item in per_item or bool(d.get("quests"))
        sourced = any(d.get(k) for k in SOURCE_KEYS)
        if not used:
            no_use.append(item)
        if not sourced:
            no_source.append(item)
        if not used and not sourced and (info or {}).get(str(item), {}).get("status"):
            unreleased.append(item)
    return {"_about": "Items list filters (dev/make-use-data.py): items with no known use, no source on this "
                      "server, and unused slots of the game's item list with neither.",
            "no_use": no_use, "no_source": no_source, "unreleased": unreleased}


def info_chunks(info, item_index):
    """{chunk: {"items": {id: facts}}} for every item of the index that item_info.json knows."""
    out = {}
    for item in sorted(item_index):
        e = (info or {}).get(str(item))
        if e:
            out.setdefault(item // INFO_CHUNK, {"items": {}})["items"][str(item)] = {
                k: e[k] for k in INFO_KEYS if k in e}
    return out


def write(per_item, names, pieces, item_index, out=DATA, info=None, status=None):
    uses_dir, eq_dir = out / "uses", out / "equipment"
    for d in (uses_dir, eq_dir):
        if d.exists():
            shutil.rmtree(d)
    uses_dir.mkdir(parents=True)
    index = {}
    for item, e in sorted(per_item.items()):
        groups = sorted({group_of(r) for r in e["rows"]})
        index[str(item)] = [len(e["rows"]), groups]
        dump(uses_dir / ("%d.json" % item), {"id": item, "rows": e["rows"]})
    dump(uses_dir / "index.json", {"_about": "Items with a use (dev/make-use-data.py): id -> [uses, groups].",
                                   "items": index})
    if info:
        (uses_dir / "info").mkdir()
        for c, body in info_chunks(info, item_index).items():
            dump(uses_dir / "info" / ("%d.json" % c), body)
    if status:
        dump(uses_dir / "status.json", status)
    for slot, by_id in pieces.items():
        (eq_dir / slot).mkdir(parents=True)
        dump(eq_dir / slot / "names.json", {"names": names[slot]})
        for c, body in chunks(by_id, item_index).items():
            dump(eq_dir / slot / ("%d.json" % c), body)
    return index


def main(argv):
    src = RE_USES
    if len(argv) == 3 and argv[1] == "--re":
        src = pathlib.Path(argv[2])
    elif len(argv) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    uses = json.loads(src.read_text(encoding="utf-8"))
    info_path = src.parent / "item_info.json"
    info = json.loads(info_path.read_text(encoding="utf-8"))["items"] if info_path.exists() else None
    load = lambda p: json.loads((DATA / p).read_text(encoding="utf-8"))
    item_index = {r[0]: r for r in load("items/index.json")["items"]}
    quest_names = {q[0]: q[1] for q in load("search/quests.json")["quests"]}
    per_item = item_uses(uses, deliveries(load("quest-objectives.json"), quest_names), info)
    per_item = {i: e for i, e in per_item.items() if i in item_index and i}
    details = {}
    for p in (DATA / "items").glob("*.json"):
        if p.stem.isdigit():
            details[int(p.stem)] = json.loads(p.read_text(encoding="utf-8"))
    status = item_status(item_index, per_item, details, info) if info else None
    names, pieces = equipment(uses)
    index = write(per_item, names, pieces, item_index, info=info, status=status)
    rows = sum(v[0] for v in index.values())
    print("uses: %d items, %d rows; equipment: %s" % (
        len(index), rows, ", ".join("%s %d" % (s, len(p)) for s, p in sorted(pieces.items()))))
    if status:
        print("info: %d items described; no known use %d, no source %d, unreleased %d" % (
            sum(1 for i in item_index if (info.get(str(i)) or {}).get("desc")), len(status["no_use"]),
            len(status["no_source"]), len(status["unreleased"])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
