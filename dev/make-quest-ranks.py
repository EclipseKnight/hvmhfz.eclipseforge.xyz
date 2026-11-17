#!/usr/bin/env python3
"""Writes each quest's rank and form into data/quests.json ("rank", "rankNeed", "form"), read from its quest file.

Why: the quest catalog guessed ranks from words in the English category, so most quests were "Unranked", no HR
bands existed and the Rank filter found nothing (owner, 2026-11-17). The quest file says it. Fields used
(hvmhfz_re docs/quest-files.md "Main quest body", docs/quest-classes.md, docs/quest-form-names-deploy.md):
  header+0x5c   quest class (= body+0x0a in every file): 0 Low Rank, 1 High Rank, 2 Practice, 3 HR 100+ (Gou),
                4/5/6 Greetings LR/HR/G, 7 G Rank, 8 Hunting Road / Sky Corridor, 9 Zenith
  header+0x48   monster level (class 9: 64-67 = Zenith tier 1-4)
  body+0x04     quest level: class 7 the G★ level 1-8 (161 of 161 quests of the client's G★1-7 lists,
                hvmhfz_re data/gstar_lists.tsv), class 9 the Zenith ★ 1-4
  body+0x2c     condition note (109-113, 118 on class 2/3 = Hardcore)
  body+0x4e     rank needed, 1..999: the HR (or, in G Rank and Zenith quests, the GR) a hunter needs
  body+0x91, +0x92, +0xb6..+0xb8   monster variant codes (16 = Zenith, 9 = Supremacy; see form_of)
  header+0x18   large monsters (Musou monsters: ids 155, 163, 167, 172, 174)

What the site shows:
  rank      the band to filter by: "HR1".."HR7" (the HR band a hunter must have reached: the client's own rule,
            hr_gates.py band_of: the first cap 1, 30, 50, 99, 299, 998, 999 at or above the HR needed; this puts
            every Key and Urgent Quest of data/quest-gates.json in its own band), "G★1".."G★8" for G Rank,
            "Zenith★1".."Zenith★4" for Zenith quests (class 9), or what the file says the quest is when it has no rank: "Practice" (class 2),
            "Greetings" (4-6), "Hunting Road" (8)
  rankNeed  the file's own requirement as a short text: "HR 41", "GR 1"; absent when it is 0
  form      "Zenith", "Supremacy", "Hardcore" or "Musou" when the file says so; absent otherwise

Run (read only on the server; the folder is only read):
  ssh hunsterverse 'python3 - extract ~/frontier/frontier_live/Erupe/bin/quests' < dev/make-quest-ranks.py > ranks.jsonl
  python3 dev/make-quest-ranks.py build ranks.jsonl   (writes data/quest-ranks.json, the per-quest facts)
  python3 dev/make-quest-ranks.py apply               (puts them into data/quests.json; --check: change nothing)
  python3 dev/make-quest-pieces.py && python3 dev/make-search-index.py
`apply` only adds or replaces the three fields, so it can be rerun after any other rebuild of data/quests.json.
"""
import json
import os
import pathlib
import re
import struct
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FACTS = ROOT / "data" / "quest-ranks.json"
QUESTS = ROOT / "data" / "quests.json"

HR_CAPS = [1, 30, 50, 99, 299, 998, 999]   # the client's HR band caps (hr_gates.py, mhfo-hd.dll 0x11858bec)
HARDCORE_NOTES = {109, 110, 111, 112, 113, 118}
MUSOU_MONSTERS = {155, 163, 167, 172, 174}
NO_RANK = {2: "Practice", 4: "Greetings", 5: "Greetings", 6: "Greetings", 8: "Hunting Road"}
VARIANT_ORDER = ["d0", "d1", "d2", "n0", "n1", "n2"]


def read_file(b):
    """The rank facts of one decompressed quest file."""
    u32 = lambda o: struct.unpack_from("<I", b, o)[0]
    u16 = lambda o: struct.unpack_from("<H", b, o)[0]
    body = u32(0)
    large = []
    p = u32(0x18)
    while p and u32(p) != 0 and len(large) < 64:   # 16-byte records, each -> monster ids ended by -1
        q = u32(p + 8)
        while q and u32(q) != 0xFFFFFFFF and len(large) < 64:
            large.append(u32(q))
            q += 4
        p += 16
    return {"cls": b[0x5c], "mlvl": b[0x48], "lvl": b[body + 0x04], "note": b[body + 0x2c],
            "need": u16(body + 0x4e),
            "var": [b[body + 0x91], b[body + 0x92], b[body + 0xb6], b[body + 0xb7], b[body + 0xb8]],
            "large": sorted(set(x for x in large if x))}


def extract(path):
    """One JSON line per .bin of a folder: [name, facts] or [name, "ERR", why]."""
    for name in sorted(n for n in os.listdir(path) if n.endswith(".bin")):
        try:
            with open(os.path.join(path, name), "rb") as f:
                print(json.dumps([name, read_file(f.read())], separators=(",", ":")))
        except Exception as ex:  # one bad file must not stop the list
            print(json.dumps([name, "ERR", str(ex)]))


def band_of(need):
    """HR1..HR7: the first HR cap at or above the HR the quest needs (the client's band rule)."""
    for i, cap in enumerate(HR_CAPS):
        if need <= cap:
            return "HR%d" % (i + 1)
    return "HR7"


def form_of(f):
    """The quest's special form from its file, or None.
    Zenith: class 9 with variant 16 (quest-form-names-deploy.md). Hardcore: class 2/3 with condition note
    109-113/118 (quest-classes.md). Supremacy: class 3 with variant 9: not in the RE docs; every class 3 quest
    titled 覇種 has it but 2, and every other class 3 variant-9 quest fights a Supremacy monster (checked here,
    2026-11-17). Musou: a G Rank quest (class 7) with a Musou monster id among its large monsters
    (quest-form-names-deploy.md; data/monster-ids.json names them "Musou ...") or with variant 11, which the
    site's own "Musou" quests (Musou Zinogre 146, Musou Elzelion 166) have; class 7 only, so the low-rank
    custom quests that reuse monster 155 and the Sky Corridor districts are not called Musou."""
    if f["cls"] == 9 and 16 in f["var"]:
        return "Zenith"
    if f["cls"] in (2, 3) and f["note"] in HARDCORE_NOTES:
        return "Hardcore"
    if f["cls"] == 3 and 9 in f["var"]:
        return "Supremacy"
    if f["cls"] == 7 and (11 in f["var"] or MUSOU_MONSTERS & set(f["large"])):
        return "Musou"
    return None


def rank_of(f):
    """(rank, rankNeed) of a quest from its file facts."""
    cls, need = f["cls"], f["need"]
    if cls == 7:   # G Rank: body+0x04 is the G★ level (matches the client's G★1-7 lists, 161 of 161)
        return "G★%d" % min(max(f["lvl"], 1), 8), ("GR %d" % need if need else None)
    if cls == 9:   # Zenith: body+0x04 is the ★ tier 1-4 (with header+0x48 64-67 and GR 200/400/600/800)
        return "Zenith★%d" % min(max(f["lvl"], 1), 4), ("GR %d" % need if need else None)
    if cls in NO_RANK:
        return NO_RANK[cls], ("HR %d" % need if need else None)
    return band_of(max(need, 1)), ("HR %d" % need if need else None)


def build(snapshot):
    """data/quest-ranks.json from the extract lines: per quest id the first variant's facts (d0 first)."""
    first = {}
    for line in open(snapshot, encoding="utf-8"):
        row = json.loads(line)
        m = re.match(r"(\d+)([dn]\d)\.bin$", row[0])
        if not m or row[1] == "ERR":
            continue
        qid, var = int(m.group(1)), m.group(2)
        if qid not in first or VARIANT_ORDER.index(var) < VARIANT_ORDER.index(first[qid][0]):
            first[qid] = (var, row[1])
    out = {str(q): first[q][1] for q in sorted(first)}
    FACTS.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print("wrote %s: %d quests" % (FACTS.relative_to(ROOT), len(out)))


def apply(check):
    facts = json.loads(FACTS.read_text(encoding="utf-8"))
    text = QUESTS.read_text(encoding="utf-8")
    data = json.loads(text)
    missing = 0
    for q in data["quests"]:
        for k in ("rank", "rankNeed", "form"):
            q.pop(k, None)
        f = facts.get(str(q["id"]))
        if not f:
            missing += 1
            continue
        rank, need = rank_of(f)
        q["rank"] = rank
        if need:
            q["rankNeed"] = need
        form = form_of(f)
        if form:
            q["form"] = form
    new = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ("\n" if text.endswith("\n") else "")
    if missing:
        print("%d quests have no quest file in data/quest-ranks.json" % missing)
    if new == text:
        print("quest ranks OK")
        return 0
    if check:
        print("data/quests.json is not up to date: run python3 dev/make-quest-ranks.py apply")
        return 1
    QUESTS.write_text(new, encoding="utf-8")
    print("wrote data/quests.json")
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "extract":
        extract(os.path.expanduser(sys.argv[2]))
    elif len(sys.argv) >= 3 and sys.argv[1] == "build":
        build(sys.argv[2])
    elif len(sys.argv) >= 2 and sys.argv[1] == "apply":
        sys.exit(apply("--check" in sys.argv))
    else:
        print(__doc__)
        sys.exit(2)
