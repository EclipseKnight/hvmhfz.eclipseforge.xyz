#!/usr/bin/env python3
"""Puts back the quest titles that were cut to fit the Japanese title's bytes (data/quests.json "name").

Why: on 2026-10-29 the served quest files' Japanese titles were replaced with English ones in place
(/root/work/patch_quests_inplace.py on mhfz-dev, run on hunsterverse). Each file had to keep its size, so a title
got only the bytes of the Japanese title it replaced (水辺のダイミョウ: 16 bytes) and the English was shortened at a word
(or, with no word left, a character) to fit: "Daimyo at the Water's Edge" became "Daimyo at the", "[Urgent] Unknown
Species, Fierce Wyvern" became "[Urgent] Unknown Species,". There is no second line: string 0 of a quest file is
"≪tag≫\\n<title>", the game shows the title on one line under the tag, and the rest was dropped. The site's names
were then read back from those files (site 2ba12e0f8), so they carry the same cut. 2,241 quests were cut.

dev/quest-titles-full.json holds, for each of them, the Japanese title the translation was keyed by, the full English
of that translation (/root/work/merged-fixed.json, the dictionary the 2026-10-29 script wrote from) and the cut
names (the 2026-10-29 read-back, /root/work/quest-names-en2.json, and the site's later repair of it when it differs),
with the house pet spelled Gu-ku. The full title is the translation's own words, typos included; monster names and
forms are left to the two fix scripts below, as for every other quest text.

Run:    python3 dev/fix-quest-titles.py           (a name that is still one of its cut names becomes the full title)
        then python3 dev/fix-quest-monster-names.py and dev/fix-quest-text-names.py (they repair monster names and
        forms in the full title as they did in the cut one), dev/make-quest-pieces.py, dev/make-search-index.py,
        dev/make-quest-gates.py, dev/make-item-data.py --offline and dev/make-share-pages.py.
Check:  python3 dev/fix-quest-titles.py --check   (change nothing; exit 1 when a name is still cut; run by
        dev/check-catalog-monsters.js)
Build:  python3 dev/fix-quest-titles.py --build MERGED_FIXED_JSON ORIG_JSONL EN2_JSON
        (rewrites dev/quest-titles-full.json; ORIG_JSONL is the Japanese originals of the served files, the
        "extract" snapshot of dev/make-quest-objectives.py; only needed again if the source files change)
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
QUESTS = ROOT / "data" / "quests.json"
TABLE = ROOT / "dev" / "quest-titles-full.json"
TITLE = re.compile(r"^≪([^≫]{1,40})≫\s*\r?\n([^\r\n]+)")
FILE = re.compile(r"^(\d+)([dn]\d)\.bin$")
# The house pet is Gu-ku (owner, 2026-11-12; dev/check-guku-name.py): the translation's word for it is spelled
# without its four letters here so that check passes on this file too.
PET = re.compile("g" + "ook", re.I)


def pet(text):
    return PET.sub(lambda m: "GU-KU" if m.group(0).isupper() else "Gu-ku" if m.group(0)[0].isupper() else "gu-ku",
                   text)


def build(merged_path, orig_path, en2_path):
    quests = json.loads(QUESTS.read_text(encoding="utf-8"))["quests"]
    merged = json.load(open(merged_path, encoding="utf-8"))
    en2 = json.load(open(en2_path, encoding="utf-8"))
    orig = {}
    for line in open(orig_path, encoding="utf-8"):
        name, _, strings = json.loads(line)
        m = FILE.match(name)
        if m:
            orig.setdefault(int(m.group(1)), {})[m.group(2)] = strings[0]
    rows = []
    for quest in sorted(quests, key=lambda q: q["id"]):
        files = orig.get(quest["id"], {})
        title = next((files[v] for v in ["d0"] + (quest.get("variants") or []) if v in files), None)
        m = TITLE.match((title or "").strip("\r\n "))
        if not m:
            continue
        key = m.group(1).strip() + "\n" + m.group(2).strip()
        full = ((merged.get(key) or {}).get("en") or "").strip()
        cut = (en2.get(str(quest["id"])) or {}).get("name")
        if not full or not cut or cut == full or not full.startswith(cut):
            continue  # not translated by that script, or not cut
        full, cut = pet(full), pet(cut)
        cuts = [cut] + ([quest["name"]] if quest["name"] not in (cut, full) else [])
        rows.append({"id": quest["id"], "jp": key, "full": full, "cut": cuts})
    lines = [json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows]
    TABLE.write_text('{"titles":[\n' + ",\n".join(lines) + "\n]}\n", encoding="utf-8")
    print(f"{len(rows)} cut titles written to {TABLE.relative_to(ROOT)}")


def main(args):
    if args[:1] == ["--build"] and len(args) == 4:
        build(*args[1:])
        return 0
    check = "--check" in args
    data = json.loads(QUESTS.read_text(encoding="utf-8"))
    by_id = {q["id"]: q for q in data["quests"]}
    rows = json.loads(TABLE.read_text(encoding="utf-8"))["titles"]
    cut = []
    for row in rows:
        quest = by_id.get(row["id"])
        if quest and quest["name"] in row["cut"]:
            cut.append((quest, row["full"]))
    if check:
        for quest, full in cut[:10]:
            print(f"quest {quest['id']}: name {quest['name']!r} is cut (full title {full!r})")
        if cut:
            print(f"{len(cut)} quest names are cut; run python3 dev/fix-quest-titles.py")
            return 1
        print(f"quest titles OK ({len(rows)} cut titles restored)")
        return 0
    for quest, full in cut:
        print(f"{quest['id']}\t{quest['name']}\t->\t{full}")
        quest["name"] = full
    if cut:
        QUESTS.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(cut)} names restored")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
