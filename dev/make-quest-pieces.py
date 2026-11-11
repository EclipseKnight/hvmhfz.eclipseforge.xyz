#!/usr/bin/env python3
"""Writes data/quests/pieces/<n>.json: what the quest page (quest.html, js/quest.js) shows of quests n*1000 .. n*1000+999,
so a visit loads one piece (under 1 MB, 190 KB gzipped) instead of data/quests.json and data/quest-details.json
(11.5 MB, 2.9 MB gzipped). The rewards and monster HP stay in data/quests/rewards/<n>.json (dev/make-monster-data.py).

Each piece: {"quests": {"<id>": {quest fields, "details": {detail fields}}}}, ids in order, for every quest of
data/quests.json in that range:
- quest fields (data/quests.json): id, name, nameJp, category, area, objective, objectiveJp, monsters, variants;
- details (data/quest-details.json, left out when the quest has none): the detail fields the page reads; "description"
  only when there is no "descriptionEn" (the page shows descriptionEn first, so the other text is never seen).
The two big files stay the source (the list page, share pages, item data and the checks read them); the pieces are a
copy of them, so run this after any change to either file (make-quest-monsters.py, fix-quest-objectives.py,
fix-quest-text-names.py):  python3 dev/make-quest-pieces.py
(--check: change nothing, exit 1 when data/quests/pieces/ is not what it would write; run by dev/check-catalog-monsters.js)
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
QUESTS = ROOT / "data" / "quests.json"
DETAILS = ROOT / "data" / "quest-details.json"
OUT = ROOT / "data" / "quests" / "pieces"

QUEST_FIELDS = ["id", "name", "nameJp", "category", "area", "objective", "objectiveJp", "monsters", "variants"]
DETAIL_FIELDS = ["objectiveEn", "objectiveJp", "subAEn", "subAJp", "subBEn", "subBJp", "clientEn", "client", "minutes",
                 "rewardMoney", "zenny", "requirementItemId", "requirementItemName", "requirementCount",
                 "descriptionEn", "description", "descriptionJp"]


def build():
    quests = json.loads(QUESTS.read_text(encoding="utf-8"))["quests"]
    details = json.loads(DETAILS.read_text(encoding="utf-8"))
    pieces = {}
    for quest in sorted(quests, key=lambda q: q["id"]):
        entry = {k: quest[k] for k in QUEST_FIELDS if k in quest}
        d = details.get(str(quest["id"]))
        if d is not None:
            keep = {k: d[k] for k in DETAIL_FIELDS if k in d}
            if "descriptionEn" in keep:
                keep.pop("description", None)
            entry["details"] = keep
        pieces.setdefault(quest["id"] // 1000, {})[str(quest["id"])] = entry
    return {"%d.json" % n: json.dumps({"quests": qs}, ensure_ascii=False, separators=(",", ":"))
            for n, qs in pieces.items()}


def main(args):
    want = build()
    have = {p.name: p for p in OUT.glob("*.json")} if OUT.is_dir() else {}
    stale = sorted(name for name, text in want.items()
                   if name not in have or have[name].read_text(encoding="utf-8") != text)
    extra = sorted(set(have) - set(want))
    if "--check" in args:
        if stale or extra:
            print("data/quests/pieces/: " + ", ".join(
                (["%d out of date or missing (%s)" % (len(stale), ", ".join(stale[:5]))] if stale else []) +
                (["%d left over (%s)" % (len(extra), ", ".join(extra[:5]))] if extra else [])) +
                "; run python3 dev/make-quest-pieces.py")
            return 1
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for name in stale:
        (OUT / name).write_text(want[name], encoding="utf-8")
    for name in extra:
        (OUT / name).unlink()
    size = sum(len(t.encode("utf-8")) for t in want.values())
    print("data/quests/pieces/: %d files, %d bytes; %d written, %d removed" % (len(want), size, len(stale), len(extra)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
