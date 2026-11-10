#!/usr/bin/env python3
"""Writes data/quest-objectives.json: what the game's quest files say each quest's objectives are.

Why: data/quests.json (objectiveJp) and data/quest-details.json (objectiveJp, objectiveEn) disagreed for 276 quests,
and 86 more showed a sub-objective as the main one. The quest file settles it. Each quest file holds, in its body
(docs/quest-files.md in hvmhfz_re, "Header" and "Strings"):
  body+0x30, +0x38, +0x40   the main objective, sub-objective A and B: u32 type, u16 target, u16 count
                            (type 1 hunt, 257 capture, 513 slay, 2 deliver, ... data/objective-types.json;
                            the target is a monster id or an item id)
  body+0x28 -> 8 strings    0 title, 1 main objective, 2 sub-objective A, 3 sub-objective B, 4 clear condition,
                            5 fail condition, 6 client, 7 description
Two sources, both on `hunsterverse` and read only:
  - the quest folder Erupe serves (~/frontier/frontier_live/Erupe/bin/quests): the targets and counts, which are
    the game's truth, and the English strings. Its string 1 (the main objective's text) is wrong in 157 quests: it
    repeats string 2, so the game shows sub-objective A's text as the main objective (reported to the owner, not
    changed here);
  - decrypt_quests.zip in the same folder (the original pack, 2024-03): the Japanese strings. Its targets and
    counts are the same as the served files' for every quest.
data/quest-objectives.json has, per quest id (all variants of a quest agree; the first is used):
  "o"   [[type, target, count] x3]  main, A, B (all zero = none)
  "jp"  [string 1, 2, 3, 4]         the Japanese original: main objective, sub A, sub B, clear condition
  "en"  [string 2, 3]               the served file's English text of sub A and B ("None" = none)

Run (read only on the server; the folder and the zip are only read):
  ssh hunsterverse 'python3 - extract ~/frontier/frontier_live/Erupe/bin/quests' < dev/make-quest-objectives.py > live.jsonl
  ssh hunsterverse 'python3 - extract ~/frontier/frontier_live/Erupe/bin/quests/decrypt_quests.zip' < dev/make-quest-objectives.py > orig.jsonl
  python3 dev/make-quest-objectives.py build live.jsonl orig.jsonl      (writes data/quest-objectives.json)
  python3 dev/fix-quest-objectives.py                                   (then repairs the site's texts)
"""
import json
import os
import pathlib
import re
import struct
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "quest-objectives.json"


def read_file(b):
    """[[type, target, count] x3, [8 strings]] of one decompressed quest file."""
    u32 = lambda o: struct.unpack_from("<I", b, o)[0]
    u16 = lambda o: struct.unpack_from("<H", b, o)[0]
    body = u32(0)
    objs = [[u32(body + 0x30 + 8 * i), u16(body + 0x34 + 8 * i), u16(body + 0x36 + 8 * i)] for i in range(3)]
    table = u32(body + 0x28)
    strings = []
    for i in range(8):
        start = u32(table + 4 * i)
        strings.append(b[start:b.index(b"\0", start)].decode("cp932", "replace"))
    return objs, strings


def extract(path):
    """One JSON line per .bin of a folder or zip: [name, records, strings] or [name, "ERR", why]."""
    if os.path.isdir(path):
        names = sorted(n for n in os.listdir(path) if n.endswith(".bin"))
        load = lambda n: open(os.path.join(path, n), "rb").read()
    else:
        z = zipfile.ZipFile(path)
        names = sorted(n for n in z.namelist() if n.endswith(".bin"))
        load = z.read
    for name in names:
        try:
            objs, strings = read_file(load(name))
            print(json.dumps([name, objs, strings], ensure_ascii=False, separators=(",", ":")))
        except Exception as ex:  # one bad file must not stop the list
            print(json.dumps([name, "ERR", str(ex)]))


def by_quest(lines):
    """{quest id: [(variant, records, strings)]} from snapshot lines, errors skipped."""
    out = {}
    for line in lines:
        row = json.loads(line)
        m = re.match(r"(\d+)([dn]\d)\.bin$", row[0])
        if m and row[1] != "ERR":
            out.setdefault(int(m.group(1)), []).append((m.group(2), row[1], row[2]))
    return out


def build(live_path, orig_path):
    live = by_quest(open(live_path, encoding="utf-8"))
    orig = by_quest(open(orig_path, encoding="utf-8"))
    quests, problems = {}, []
    for qid in sorted(orig):
        variants = sorted(orig[qid])
        first = variants[0]
        for v in variants[1:]:
            if v[1] != first[1] or v[2][1:5] != first[2][1:5]:
                problems.append("quest %d: variants %s and %s differ in objectives" % (qid, first[0], v[0]))
        entry = {"o": first[1], "jp": first[2][1:5]}
        if qid in live:
            lv = sorted(live[qid])[0]
            if lv[1] != first[1]:
                problems.append("quest %d: the served file's targets differ from the original pack's" % qid)
            entry["o"] = lv[1]  # the served file is the game's truth
            entry["en"] = lv[2][2:4]
        quests[str(qid)] = entry
    OUT.write_text(json.dumps({"quests": quests}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("%d quests (%d served files, %d original files)" % (len(quests), len(live), len(orig)))
    for p in problems:
        print("note:", p)


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == "extract":
        extract(args[1])
    elif len(args) == 3 and args[0] == "build":
        build(args[1], args[2])
    else:
        sys.exit(__doc__)
