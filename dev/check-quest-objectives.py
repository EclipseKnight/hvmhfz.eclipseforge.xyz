#!/usr/bin/env python3
"""Checks that the site's quest objectives are the quest files' (data/quest-objectives.json, written by
dev/make-quest-objectives.py from the served quest files and the original pack).

For every quest in data/quests.json that data/quest-objectives.json has:
1. the Japanese objective in data/quests.json and in data/quest-details.json are the same text;
2. it is the main objective's text (string 1 of the quest file, see dev/fix-quest-objectives.py) and not a
   sub-objective's, or empty, or the generic clear-condition line the site shows for a bare "monster and count" string;
3. when the text names a monster and the main objective's target is a hunt, capture or slay of a monster: that
   monster is the target (the field guide's page of the target's id, a Variant or Musou form counting as its base
   monster) and, for those three types, the count is the target's count (a count of 0 in the file, 4 quests, says nothing);
4. the English objective of a hunt of one monster has the Japanese text's count (the monsters' names in the English
   text are checked by dev/fix-quest-text-names.py, the game's English naming subspecies "Subspecies" where the
   field guide has "Pink Rathian");
5. the sub-objectives in data/quest-details.json (subAJp/subAEn, subBJp/subBEn) are the quest file's, and absent when
   the quest has none;
6. dev/fix-quest-objectives.py --check finds nothing to change.
Run:  python3 dev/check-quest-objectives.py            (exit 1 and the quests listed when something is wrong)
      python3 dev/check-quest-objectives.py --root DIR (check the data/ of another checkout)
"""
import importlib.util
import json
import pathlib
import re
import sys

sys.dont_write_bytecode = True
HERE = pathlib.Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fix = load("fix-quest-objectives")
mqm = fix.mqm

MONSTER_TYPES = {1, 257, 513}  # hunt, capture, slay: the count is the number of kills
TARGET_TYPES = MONSTER_TYPES | {32772, 98308, 16388}  # also damage, slay or damage, break a part: target is a monster
BASE = {"berserk-laviente": "raviente", "crimson-fatalis": "fatalis", "white-fatalis": "fatalis",
        "rusted-kushala-daora": "kushala-daora", "hermitaur": "ceanataur"}


def base(slug):
    return BASE.get(slug, slug[6:] if slug.startswith("musou-") else slug)


def slugs_in(text):
    """The field guide slugs the Japanese names of a text stand for, in order (a name with two pages gives both)."""
    table = dict(mqm.JP)
    hits, rest = [], text
    for jp in sorted(table, key=len, reverse=True):
        start = rest.find(jp)
        while start != -1:
            hits.append((start, table[jp]))
            rest = rest[:start] + "\0" * len(jp) + rest[start + len(jp):]
            start = rest.find(jp)
    out = []
    for _, value in sorted(hits, key=lambda h: h[0]):
        out.extend([value] if isinstance(value, str) else (value or []))
    return out


def counts(text):
    return [fix.to_int(n) for n in re.findall(r"([０-９]+)(?:頭|体|匹)", text)]


def check(root):
    data = root / "data"
    quests = json.loads((data / "quests.json").read_text(encoding="utf-8"))["quests"]
    details = json.loads((data / "quest-details.json").read_text(encoding="utf-8"))
    objectives = json.loads((data / "quest-objectives.json").read_text(encoding="utf-8"))["quests"]
    index = json.loads((data / "monsters" / "index.json").read_text(encoding="utf-8"))
    names = {m["slug"]: m["name"] for m in index}
    by_id = {}
    for m in index:
        for i in m.get("ids", []):
            by_id.setdefault(i, []).append(m["slug"])
    problems = []

    def bad(qid, what):
        problems.append("quest %s: %s" % (qid, what))

    for q in quests:
        qid = q["id"]
        o = objectives.get(str(qid))
        d = details.get(str(qid), {})
        if not o:
            continue
        string1, string2, string3, string4 = o["jp"]
        record = o["o"][0]
        texts = [("quests.json objectiveJp", q.get("objectiveJp")), ("quest-details.json objectiveJp", d.get("objectiveJp"))]
        if q.get("objectiveJp") is not None and d.get("objectiveJp") is not None and q["objectiveJp"] != d["objectiveJp"]:
            bad(qid, "objectiveJp differs: quests.json %r, quest-details.json %r" % (q["objectiveJp"], d["objectiveJp"]))
        for label, text in texts:
            if text is None:
                continue
            if not fix.kept(text, string1, string4, record):
                which = "sub-objective A" if text == string2 else "sub-objective B" if text == string3 else "another text"
                bad(qid, "%s %r is %s; the quest file's main objective is %r (target %s)" % (label, text, which, string1, record))
                continue
            named = [base(s) for s in slugs_in(text)]
            target = {base(s) for s in by_id.get(record[1], [])}
            if record[0] in TARGET_TYPES and target and named and not (set(named) & target):
                bad(qid, "%s %r names %s; the quest file's main target is monster %d (%s)" % (
                    label, text, named, record[1], sorted(target)))
            elif record[0] in MONSTER_TYPES and record[2] and target and len(named) == 1 and counts(text) and counts(text)[0] != record[2]:
                bad(qid, "%s %r says %d; the quest file's main target count is %d" % (label, text, counts(text)[0], record[2]))
        # English against Japanese
        jp, en = d.get("objectiveJp"), d.get("objectiveEn")
        if jp and en and fix.kept(jp, string1, string4, record):
            jp_names = mqm.monsters_in(jp, names)[0]
            if len(jp_names) == 1 and counts(jp) and re.search(r"\d", en) and int(re.search(r"\d+", en).group()) != counts(jp)[0]:
                bad(qid, "objectiveEn %r has another count than objectiveJp %r" % (en, jp))
        # Sub-objectives
        for key, i in (("subA", 1), ("subB", 2)):
            jp = o["jp"][i]
            has = jp not in ("", fix.NONE_JP)
            if has and d.get(key + "Jp") != jp:
                bad(qid, "%sJp is %r, the quest file's is %r" % (key, d.get(key + "Jp"), jp))
            if not has and (key + "Jp" in d or key + "En" in d):
                bad(qid, "%s present, the quest file has none" % key)
    return problems


def main(args):
    root = HERE.parent
    if "--root" in args:
        root = pathlib.Path(args[args.index("--root") + 1])
    problems = check(root)
    if root == HERE.parent:
        changes, cannot = fix.run(False)
        if changes or cannot:
            problems.append("dev/fix-quest-objectives.py --check: %d texts differ, %d cannot be written" % (len(changes), len(cannot)))
    for p in problems:
        print(p)
    print("quest objectives %s" % ("OK" if not problems else "wrong in %d places" % len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
