#!/usr/bin/env python3
"""Puts the right Dos-/prey monster names into the English quest texts, going by the Japanese text.

The English quest texts (data/quest-details.json: objectiveEn, descriptionEn, description, clientEn, client;
data/quests.json: objective, name) came from translation waves that swapped Iodrome and Gendrome (ドスイーオス is
Iodrome, ドスゲネポス is Gendrome; 79 + 59 objectives said the other one), Ioprey and Genprey (イーオス is Ioprey,
ゲネポス Genprey) and now and then named another bird or boar (ギアノス as Velociprey, ドスファンゴ as Bullfango).
Nothing in this repo writes those texts, so this script is the repair, and the check that they stay right.

What it does, for every text that has a Japanese original next to it (quest-details.json: objectiveJp,
descriptionJp, and the quest's own "client" line in quests.json; quests.json: objectiveJp, nameJp):
- reads the names of the "Dos / prey" family the Japanese text holds (the table of dev/make-quest-monsters.py:
  ランポス, ドスランポス, ギアノス, ゲネポス, ドスゲネポス, イーオス, ドスイーオス, ブルファンゴ, ドスファンゴ,
  ガレオス, ドスガレオス, ブランゴ, ドドブランゴ), in order of appearance;
- reads the names of the same family the English text holds, each once, in order;
- when both lists are as long as each other and differ, renames the English names one for one to the Japanese
  text's (every mention, keeping a plural "s"). Objectives are rewritten as a whole family; descriptions, clients and quest names only
  for the four names that were swapped (Iodrome, Gendrome, Ioprey, Genprey), since prose may name a monster in
  words the Japanese does not (a description of a Dos- quest that talks of "the pack");
- when the lists differ in length, changes nothing and prints the quest (those need a human).

Run:    python3 dev/fix-quest-text-names.py            (rewrite the two data files, list every quest changed)
Check:  python3 dev/fix-quest-text-names.py --check    (change nothing; exit 1 when a text is not what it would write)
The check runs from dev/check-catalog-monsters.js.
"""
import importlib.util
import json
import pathlib
import re
import sys

sys.dont_write_bytecode = True  # the importlib load below would leave dev/__pycache__
ROOT = pathlib.Path(__file__).resolve().parent.parent
QUESTS = ROOT / "data" / "quests.json"
DETAILS = ROOT / "data" / "quest-details.json"
INDEX = ROOT / "data" / "monsters" / "index.json"

_spec = importlib.util.spec_from_file_location("make_quest_monsters", ROOT / "dev" / "make-quest-monsters.py")
mqm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mqm)

FAMILY = {"Velociprey", "Velocidrome", "Giaprey", "Genprey", "Gendrome", "Ioprey", "Iodrome", "Bullfango",
          "Bulldrome", "Cephalos", "Cephadrome", "Blango", "Blangonga"}
SWAPPED = {"Iodrome", "Gendrome", "Ioprey", "Genprey"}


# Older wave spellings of the Dos- names ("Dos-Genprey" for Gendrome).
ALIASES = {"Dos-Genprey": "Gendrome", "Dos-Ioprey": "Iodrome", "Dos Genprey": "Gendrome", "Dos Ioprey": "Iodrome"}


def english_names(text, allowed):
    """(start, end, canonical name, plural) of every family name in an English text, in order. "Bullfangos" counts
    as a plural."""
    found = []
    spellings = {name: name for name in allowed}
    spellings.update({a: n for a, n in ALIASES.items() if n in allowed})
    for spelling in sorted(spellings, key=len, reverse=True):
        for m in re.finditer(r"\b" + re.escape(spelling) + r"(s|es)?\b", text, re.I):
            if not any(a < m.end() and m.start() < b for a, b, _, _ in found):
                found.append((m.start(), m.end(), spellings[spelling], m.group(1) or ""))
    return sorted(found)


def fix(jp, en, allowed, names):
    """The English text with its family names replaced by the Japanese text's, or (en, problem)."""
    if not jp or not en:
        return en, None
    jp = re.sub(r"[\n\u3000 ]", "", jp)  # a line break can cut a name in two (ドス/イーオス)
    wanted = [n for n in mqm.monsters_in(jp, names)[0] if n in allowed]  # distinct, in order of appearance
    have = english_names(en, allowed)
    seen = []  # distinct English names in order; the Nth is the Japanese text's Nth (a pronoun or a repeat adds none)
    for _, _, name, _ in have:
        if name not in seen:
            seen.append(name)
    if seen == wanted or (not seen and not wanted):
        return en, None
    if len(seen) != len(wanted):
        return en, "names %s in the Japanese, %s in the English" % (wanted, seen)
    rename = dict(zip(seen, wanted))
    out, last = [], 0
    for start, end, name, plural in have:
        before = en[last:start]
        article = re.search(r"\b([Aa])n? $", before)
        if article:  # "a Gendrome" / "an Iodrome"
            before = before[:article.start()] + article.group(1) + ("n " if rename[name][0] in "AEIOU" else " ")
        out.append(before)
        out.append(rename[name] + ("s" if plural else ""))
        last = end
    out.append(en[last:])
    return "".join(out), None


def run(write):
    quests = json.loads(QUESTS.read_text(encoding="utf-8"))
    details = json.loads(DETAILS.read_text(encoding="utf-8"))
    names = {m["slug"]: m["name"] for m in json.loads(INDEX.read_text(encoding="utf-8"))}
    changes, problems = [], []

    def apply(holder, key, jp, allowed, qid, label):
        new, problem = fix(jp, holder.get(key), allowed, names)
        if problem:
            problems.append("quest %s %s: %s" % (qid, label, problem))
        elif new != holder.get(key):
            changes.append((qid, label, holder[key], new))
            holder[key] = new

    for q in quests["quests"]:
        qid = q["id"]
        apply(q, "objective", q.get("objectiveJp"), FAMILY, qid, "quests.json objective")
        apply(q, "name", q.get("nameJp"), SWAPPED, qid, "quests.json name")
        d = details.get(str(qid))
        if d:
            apply(d, "objectiveEn", d.get("objectiveJp"), FAMILY, qid, "details objectiveEn")
            for key in ("descriptionEn", "description"):
                apply(d, key, d.get("descriptionJp"), SWAPPED, qid, "details " + key)
            if re.search("[぀-ヿ]", q.get("client") or ""):  # event quests keep their target line here
                for key in ("clientEn", "client"):
                    apply(d, key, q["client"], FAMILY, qid, "details " + key)
    if write and changes:
        QUESTS.write_text(json.dumps(quests, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        DETAILS.write_text(json.dumps(details, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return changes, problems


def main(args):
    changes, problems = run("--check" not in args)
    for qid, label, old, new in changes:
        print("quest %s %s: %r -> %r" % (qid, label, old, new))
    quests = sorted({c[0] for c in changes})
    print("%d texts of %d quests %s" % (len(changes), len(quests), "differ" if "--check" in args else "changed"))
    if "--verbose" in args:
        for p in problems:
            print("left alone: " + p)
    elif problems:
        print("%d texts left alone (names differ in number; --verbose lists them)" % len(problems))
    return 1 if changes and "--check" in args else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
