#!/usr/bin/env python3
"""Makes the quests' objective texts say what the quest files say (data/quest-objectives.json, from
dev/make-quest-objectives.py), and adds the sub-objectives to data/quest-details.json.

The problem it repairs. A quest file has a main objective and sub-objectives A and B, each with its own target,
count and text. The site had one Japanese objective text per quest in two files and they disagreed for 276 quests:
data/quests.json (objectiveJp) had the main objective, data/quest-details.json (objectiveJp, objectiveEn, which the
quest page shows) had sub-objective A's text (quest 63399: ドスファンゴ２頭 is the main objective, ブルファンゴ７頭
sub A; the page said "Slay 7 Bullfangos"). In 86 more quests both files had a sub-objective's text, or a delivery
named by the item list, instead of the main objective (quest 61531: the main objective is "set 4 Guild Flags at the
summit", the site said "Slay 10 Blango", which is sub-objective A).

What is the main objective's text? The quest file's string 1, in Japanese. When string 1 is only a monster and a count
(グラビモス変種２頭, a Variant or Aberrant hunt: the game shows the clear condition beside it) the site's generic
"メインターゲットの狩猟" is kept, since it names nothing wrong; a text that names another objective is replaced by the
string with its verb added (グラビモス変種２頭の狩猟), from the target's type (1 hunt, 257 capture, 513 slay).

What it does, for every quest in data/quest-objectives.json:
- quests.json objectiveJp and quest-details.json objectiveJp: kept when they are the main objective's text (or the
  generic text above, or empty); else set to the main objective's text; objectiveEn (and quests.json "objective" when
  its Japanese text changed) is then written in English: the English the site already has for that exact Japanese
  text, else built (verb, count, the field guide's monster name from data/monsters/index.json or the item's name from
  data/item-ids.json); "name" families are then the spelling dev/fix-quest-text-names.py writes;
- quest-details.json subAJp / subAEn / subBJp / subBEn: the sub-objectives' Japanese text (the original) and the
  served file's English text with its monster names repaired (dev/fix-quest-text-names.py,
  dev/fix-quest-monster-names.py), left out when the quest has none (なし);
- prints every text it changed, and the ones it could not write (a human finishes those).

Run:    python3 dev/fix-quest-objectives.py            (rewrite the two data files)
Check:  python3 dev/fix-quest-objectives.py --check    (change nothing; exit 1 when a text is not what it would write)
Then:   python3 dev/make-quest-monsters.py             (the catalog's monster list follows the Japanese objective)
        python3 dev/make-share-pages.py                (the share pages quote the objective)
dev/check-quest-objectives.py runs the check and compares the texts with the quest files' targets.
"""
import collections
import importlib.util
import json
import pathlib
import re
import sys

sys.dont_write_bytecode = True  # the importlib loads below would leave dev/__pycache__
ROOT = pathlib.Path(__file__).resolve().parent.parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / "dev" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mqm = load("make-quest-monsters")
fixnames = load("fix-quest-text-names")
monsternames = load("fix-quest-monster-names")

VERB_JP = {1: "狩猟", 257: "捕獲", 513: "討伐"}
VERB_EN = {"狩猟": "Hunt", "捕獲": "Capture", "討伐": "Slay", "撃退": "Repel", "納品": "Deliver"}
SUFFIX_EN = {"変種": " Variant", "奇種": ""}  # 奇種 is "Zenith X": a prefix, below
BARE = re.compile(r"[０-９]+(頭|匹|体)$")  # a monster and a count, no verb
NONE_JP = "なし"

# Objectives that are not "hunt N monsters" or "deliver N items": the game's own English where the served files
# have it for the same text (the flag, the tails, the beak, the barrel bombs, the cacti), else a plain translation.
SPECIAL = {
    "ギルドフラッグを山頂に設置": "Plant the Guild Flag at the summit",
    "ギルドフラッグ２個の山頂設置": "Place 2 guild flags at the summit",
    "ギルドフラッグ４個の山頂設置": "Place 4 guild flags at the summit",
    "岩８個の破壊": "Destroy 8 rocks",
    "イワ２個の破壊": "Destroy 2 rocks",
    "イワ３０個の破壊": "Destroy 30 rocks",
    "爆発する仕掛け３０個の破壊": "Destroy 30 explosive devices",
    "設置済タル爆弾１０個の破壊": "Destroy 10 placed barrel bombs",
    "覇王樹５個の破壊": "Destroy 5 cacti",
    "ラージャンの尻尾切断": "Sever Rajang's tail",
    "リオレイアの尻尾切断": "Sever Rathian's tail",
    "ヒプノックのクチバシ破壊": "Break Hypnocatrice's beak",
    "大きな木の下でお祝い": "Celebrate under the big tree",
    "拠点でけむり玉を使用": "Use a Smoke Bomb at base camp",
    "拠点で花火を使用": "Use fireworks at base camp",
    "ＢＣで支給Ｇクラッカー使用": "Use the supplied G Cracker at base camp",
    "夜空に花火を打ち上げる": "Launch fireworks into the night sky",
    "花畑でのんびり": "Relax in the flower field",
    "塔頂部で拍手": "Clap at the top of the tower",
    "モンスターを挑発する": "Taunt a monster",
    "滝つぼがある場所で寝る": "Sleep at a place with a waterfall basin",
    "たくさんのラッピーと？？？": "Lots of Rappies and ???",
    "？？？": "???",
    "？？？？？？": "??????",
}


def full_width(n):
    return str(n).translate(str.maketrans("0123456789", "０１２３４５６７８９"))


def to_int(text):
    return int(text.translate(str.maketrans("０１２３４５６７８９", "0123456789")))


def squash(text):
    return re.sub(r"[\s　]", "", text)


def main_text(string1, record):
    """The main objective's Japanese text (the objective the site should show), from string 1 and its target type."""
    if BARE.search(string1):
        return string1 + "の" + VERB_JP.get(record[0], "討伐")
    return string1


def kept(text, string1, string4, record):
    """True when a site text is acceptable for a quest: empty, the main objective's text, or, when string 1 is a bare
    monster and count, the clear-condition line the site shows as a generic objective."""
    if text is None or squash(text) in (squash(string1), squash(main_text(string1, record))):
        return True
    return bool(BARE.search(string1)) and squash(text) == squash(string4)


class Writer:
    """Builds English objective texts out of what the site already knows."""

    def __init__(self, quests, details, objectives, index):
        self.names = {m["slug"]: m["name"] for m in index}
        self.items = json.loads((ROOT / "data" / "item-ids.json").read_text(encoding="utf-8"))
        votes = collections.defaultdict(collections.Counter)
        self.item_votes = collections.defaultdict(collections.Counter)
        for q in quests:
            d, o = details.get(str(q["id"])), objectives.get(str(q["id"]))
            if not d or not o or d.get("objectiveJp") != o["jp"][0] or not d.get("objectiveEn"):
                continue
            votes[o["jp"][0]][d["objectiveEn"]] += 1
            m = re.match(r"^(.+?)[０-９]+(?:個|枚|匹)の納品$", o["jp"][0])
            n = re.match(r"^Deliver \d+ (.+)$", d["objectiveEn"])
            if m and n:
                self.item_votes[m.group(1)][n.group(1)] += 1
        self.known = {jp: c.most_common(1)[0][0] for jp, c in votes.items()}

    def monster_name(self, jp):
        listed = mqm.monsters_in(jp, self.names)[0]
        return listed[0] if len(listed) == 1 else None

    def write(self, jp, record):
        """(English text, None) or (None, why not)."""
        if jp in self.known:
            return self.known[jp], None
        if jp == NONE_JP:
            return "None", None
        if jp in SPECIAL:
            return SPECIAL[jp], None
        m = re.match(r"^全ての大型モンスターを(討伐|狩猟)$", jp)
        if m:
            return "%s all large monsters" % VERB_EN[m.group(1)], None
        m = re.match(r"^(.+?)(変種|奇種)?([０-９]+)(頭|匹|体)の(討伐|狩猟|捕獲|撃退)$", jp)
        if m:
            name = self.monster_name(m.group(1))
            if name:
                if m.group(2) == "奇種":
                    name = "Zenith " + name
                name += SUFFIX_EN.get(m.group(2), "")
                return "%s %d %s" % (VERB_EN[m.group(5)], to_int(m.group(3)), name), None
        m = re.match(r"^(.+?)([０-９]+)(個|枚|匹)の納品$", jp)
        if m:
            name = None
            if self.item_votes.get(m.group(1)):
                name = self.item_votes[m.group(1)].most_common(1)[0][0]
            elif record[0] == 2 and str(record[1]) in self.items:
                name = self.items[str(record[1])]
            if name:
                return "Deliver %d %s" % (to_int(m.group(2)), name), None
        return None, "no English for %r" % jp


def run(write):
    quests = json.loads(fixnames.QUESTS.read_text(encoding="utf-8"))
    details = json.loads(fixnames.DETAILS.read_text(encoding="utf-8"))
    objectives = json.loads((ROOT / "data" / "quest-objectives.json").read_text(encoding="utf-8"))["quests"]
    index = json.loads(fixnames.INDEX.read_text(encoding="utf-8"))
    names = {m["slug"]: m["name"] for m in index}
    writer = Writer(quests["quests"], details, objectives, index)
    changes, problems = [], []

    def put(holder, key, new, qid, label):
        old = holder.get(key)
        if new is None:
            if key in holder:
                changes.append((qid, label, old, None))
                del holder[key]
        elif old != new:
            changes.append((qid, label, old, new))
            holder[key] = new

    def english(jp, record, qid, label):
        en, why = writer.write(jp, record)
        if why:
            problems.append("quest %s %s: %s" % (qid, label, why))
            return None
        en, _ = fixnames.fix(jp, en, fixnames.FAMILY, names)
        return en

    for q in quests["quests"]:
        qid = q["id"]
        o = objectives.get(str(qid))
        d = details.get(str(qid))
        if not o:
            continue
        string1, _, _, string4 = o["jp"]
        record = o["o"][0]
        jp_main = main_text(string1, record)
        # The main objective.
        if q.get("objectiveJp") is not None and not kept(q["objectiveJp"], string1, string4, record):
            if mqm.monsters_in(q["objectiveJp"], names)[1] and not mqm.monsters_in(jp_main, names)[1] and q.get("monsters"):
                put(q, "monsters", [], qid, "quests.json monsters")  # the list came from the wrong text (make-quest-monsters.py keeps an old list when the text names nothing)
            put(q, "objectiveJp", jp_main, qid, "quests.json objectiveJp")
            en = english(jp_main, record, qid, "quests.json objective")
            if en:
                put(q, "objective", en, qid, "quests.json objective")
        if d is not None:
            if d.get("objectiveJp") is not None and not kept(d["objectiveJp"], string1, string4, record):
                put(d, "objectiveJp", jp_main, qid, "details objectiveJp")
                en = english(jp_main, record, qid, "details objectiveEn")
                if en:
                    put(d, "objectiveEn", en, qid, "details objectiveEn")
            # The sub-objectives, as the game lists them.
            for key, i in (("subA", 1), ("subB", 2)):
                jp = o["jp"][i]
                en = (o.get("en") or [None, None])[i - 1]
                has = jp not in ("", NONE_JP)
                put(d, key + "Jp", jp if has else None, qid, "details %sJp" % key)
                if has and en and en != "None":
                    en, _ = fixnames.fix(jp, en, fixnames.FAMILY, names)
                    en = monsternames.repair(jp, en, int(qid), key, " ".join(o["jp"][:3]))
                    put(d, key + "En", en, qid, "details %sEn" % key)
                else:
                    put(d, key + "En", None, qid, "details %sEn" % key)
    if write and changes:
        fixnames.QUESTS.write_text(json.dumps(quests, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        fixnames.DETAILS.write_text(json.dumps(details, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return changes, problems


def main(args):
    changes, problems = run("--check" not in args)
    for qid, label, old, new in changes:
        if "--quiet" not in args:
            print("quest %s %s: %r -> %r" % (qid, label, old, new))
    quests = {c[0] for c in changes}
    main_texts = {c[0] for c in changes if c[1] in ("details objectiveJp", "quests.json objectiveJp")}
    subs = {c[0] for c in changes if "sub" in c[1]}
    print("%d texts of %d quests %s (%d main objectives, %d quests' sub-objectives)" % (
        len(changes), len(quests), "differ" if "--check" in args else "changed", len(main_texts), len(subs)))
    for p in problems:
        print("could not write: " + p)
    return 1 if (changes or problems) and "--check" in args else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
