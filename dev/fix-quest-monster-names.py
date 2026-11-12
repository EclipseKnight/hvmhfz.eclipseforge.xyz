#!/usr/bin/env python3
"""Checks and repairs the monster names of the English quest texts against the Japanese ones.

Why: the English quest texts came from translation waves that sometimes put in the wrong monster. The owner found
quest 50507, 狩猟体験！デュラガウア, shown as "Trial Hunt! Duramboros": デュラガウア (epithet 氷狐竜) is Dyuragaua;
Duramboros (ドボルベルク, 鎚尾竜) is not in Frontier at all. The same waves wrote "Dahren Mohran" for Harudomerugu
(ハルドメルグ), "Gargwa" for Anteka (ガウシカ) and mixed up some epithets (毒鳥竜, Iodrome, as "Gypceros").
dev/fix-quest-text-names.py repairs the Dos-/prey family swaps; this script checks every monster.

How a text is checked (one English text against its Japanese original):
- the Japanese text's monsters: the katakana names of dev/make-quest-monsters.py (JP, NO_PAGE) plus JP_EXTRA below
  and the kanji epithets of EPITHETS (氷狐竜 -> Dyuragaua), longest first;
- the English text's monsters: the field guide's names (data/monsters/index.json) plus EN_ALIASES (other spellings
  the texts use, "Lavasioth" for Volganos) and FOREIGN (monsters of other games: never right in a Frontier quest);
- both are compared by family (FAMILY: a subspecies counts as its species, so "Azure Rathalos" for 蒼火竜 is not
  flagged; subspecies mix-ups are not checked here);
- an English name whose family the Japanese text does not name is wrong. It is replaced by the Japanese text's
  monster when there is exactly one the English text does not name yet, or when the Japanese text names one family
  only, or when the wrong name ends the right one ("Ceanataur" for 鎌蟹, Shogun Ceanataur); OVERRIDES settles the
  texts a human reviewed; otherwise it is listed for a human ("left alone").
A Japanese text that names a monster the English text leaves out is fine (prose often says "the wyvern"). A class
word (CLASS_WORDS: 魚竜) stands for the quest's own monster of that class. When the Japanese text names no monster,
the quest's own monsters (its Japanese objectives) are accepted: a served title with the objective glued on
("Ancient Hymn 1 Rathian Variant") or a client line holding an objective has another fault. An objective whose
English has other numbers than its Japanese is another objective's text: listed, not renamed.

Texts checked (site): data/quests.json name (nameJp); data/quest-details.json objectiveEn (objectiveJp),
subAEn (subAJp), subBEn (subBJp), descriptionEn and description (descriptionJp), clientEn and client (the quest's
Japanese "client" in data/quests.json, when it has kana).

Run:    python3 dev/fix-quest-monster-names.py            (rewrite the two data files, list every text changed)
Check:  python3 dev/fix-quest-monster-names.py --check    (change nothing; exit 1 when a text names a wrong monster)
        python3 dev/fix-quest-monster-names.py --self-test (the rules on made-up texts)
        The check runs from dev/check-catalog-monsters.js. After a rewrite run dev/make-quest-pieces.py,
        dev/make-search-index.py, dev/make-item-data.py --offline and dev/make-share-pages.py.
Live quest files (strings 0-7 of each served English file against the Japanese original's, same file name):
        python3 dev/fix-quest-monster-names.py --files live.jsonl orig.jsonl [--fixes fixes.tsv]
        (the two snapshots of dev/make-quest-objectives.py "extract"; prints the counts per wrong pair and writes
        one row per string to fix: file, string index, old text, new text, for hvmhfz_re
        tools/quest/fix_monster_names.py)
"""
import collections
import importlib.util
import json
import pathlib
import re
import sys
import unicodedata

sys.dont_write_bytecode = True  # the importlib load below would leave dev/__pycache__
ROOT = pathlib.Path(__file__).resolve().parent.parent
QUESTS = ROOT / "data" / "quests.json"
DETAILS = ROOT / "data" / "quest-details.json"
INDEX = ROOT / "data" / "monsters" / "index.json"

_spec = importlib.util.spec_from_file_location("make_quest_monsters", ROOT / "dev" / "make-quest-monsters.py")
mqm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mqm)

# Katakana names make-quest-monsters.py does not list (it only needs objectives), and short forms the texts use.
JP_EXTRA = {
    "アルガノス": "aruganosu", "ガミザミ": "hermitaur", "ウルキー": "uruki", "ウルキ": "uruki", "ココモア": "kokomoa",
    "ラッピー": "rappy", "ミ・ル": "mi-ru", "シャガルマガラ": "shagaru-magala", "オルガロン": "kamu-orugaron",
    "ドゥレムディラ": "duremudira-1st", "オディバ": "odibatorasu", "ディオレ": "diorex", "ナルガ": "nargacuga",
    "ジンオウ": "zinogre", "レイア": "rathian", "レウス": "rathalos", "アカムト": "akantor", "トリド": "toridcless",
    "ラヴィ": "raviente", "ダイミョウ": "daimyo-hermitaur", "ショウグン": "shogun-ceanataur", "ファンゴ": "bullfango",
    "ククボ": None,  # an armour series, not a monster
    "ランゴ": "vespoid", "ルコ": "rukodiora", "ガルルガ": "yian-garuga", "ガンキン": "uragaan",
    "ディアブロッス": "diablos", "テオ": "teostra", "クシャ": "kushala-daora",
    "ぶらきでぃおす": "brachydios", "ごうがるふ": "lolo-gougarf",  # a child's letter, in hiragana
}

# Kanji epithets of single monsters (the Japanese texts' own pairs, e.g. 氷狐竜≪デュラガウア≫, checked against the
# quests' objectives). Class words (古龍, 飛竜, 牙獣, 鳥竜, 魚竜, 獣竜) and pairs (双火竜) are left out.
EPITHETS = {
    "火竜": "rathalos", "雌火竜": "rathian", "蒼火竜": "azure-rathalos", "桜火竜": "pink-rathian",
    "銀火竜": "silver-rathalos", "金火竜": "gold-rathian", "怪鳥": "yian-kut-ku", "青怪鳥": "blue-yian-kut-ku",
    "毒怪鳥": "gypceros", "紫毒鳥": "purple-gypceros", "紫怪鳥": "purple-gypceros", "黒狼鳥": "yian-garuga",
    "眠鳥": "hypnocatrice", "蒼眠鳥": "breeding-season-hypnocatrice", "蒼白眠鳥": "silver-hypnocatrice",
    "毒鳥竜": "iodrome", "麻痺鳥竜": "gendrome", "鎌蟹": "shogun-ceanataur", "盾蟹": "daimyo-hermitaur",
    "多殻蟹": "taikun-zamuza", "砦蟹": "shen-gaoren", "角竜": "diablos", "黒角竜": "black-diablos",
    "一角竜": "monoblos", "白一角竜": "white-monoblos", "岩竜": "basarios", "鎧竜": "gravios",
    "黒鎧竜": "black-gravios", "水竜": "plesioth", "翠水竜": "green-plesioth", "雪獅子": "blangonga",
    "桃毛獣": "congalala", "金獅子": "rajang", "紅蓮獅子": "voljang", "轟竜": "tigrex", "迅竜": "nargacuga",
    "恐暴竜": "deviljho", "砂竜": "cephadrome", "鋼龍": "kushala-daora", "風翔龍": "kushala-daora",
    "炎王龍": "teostra", "炎妃龍": "lunastra", "霞龍": "chameleos", "幻獣": "kirin", "老山龍": "lao-shan-lung",
    "岩山龍": "ashen-lao-shan-lung", "黒龍": "fatalis", "紅龍": "crimson-fatalis", "祖龍": "white-fatalis",
    "覇竜": "akantor", "浮岳龍": "yama-tsukami", "浮峰龍": "yama-kurai", "大巌竜": "raviente",
    "雷狼竜": "zinogre", "獄狼竜": "stygian-zinogre", "千刃竜": "seregios", "砕竜": "brachydios",
    "黒蝕竜": "gore-magala", "天廻龍": "shagaru-magala", "嵐龍": "amatsu", "氷牙竜": "barioth",
    "爆鎚竜": "uragaan", "氷狐竜": "dyuragaua", "黒狐竜": "mi-ru", "棘竜": "espinas", "棘茶竜": "orange-espinas",
    "棘白竜": "white-espinas", "溶岩竜": "volganos", "紅溶岩竜": "red-volganos", "喰血竜": "baruragaru",
    "極龍": "rukodiora", "雷極龍": "rebidiora", "冥雷竜": "doragyurosu", "蛮竜": "gurenzeburu", "獰竜": "abiorugu",
    "氷獰竜": "giaorugu", "弩岩竜": "odibatorasu", "呑竜": "pariapuria", "跳緋獣": "gogomoa",
    "尾晶蠍": "akura-vashimu", "灰晶蠍": "akura-jebia", "舞雷竜": "berukyurosu", "照雷鳥": "toridcless",
    "傾雷鳥": "farunokku", "晶竜": "kuarusepusu", "雅翁龍": "inagami", "司銀龍": "harudomerugu",
    "怒貌竜": "gasurabazura", "輝界竜": "zerureusu", "爆狼": "midogaron", "針纏竜": "hyujikiki",
    "華鳳鳥": "forokururu", "凍王龍": "toa-tesukatora", "暴鋸竜": "anorupatisu", "帝征龍": "guanzorumu",
    "創音竜": "poborubarumu", "黒穿竜": "meraginasu", "爆霧竜": "bogabadorumu", "灼零龍": "elzelion",
    "金塵龍": "garuba-daora", "炎角竜": "varusaburosu", "熾凍龍": "disufiroa", "天翔龍": "shantien",
    "雷轟竜": "diorex", "焔嶽龍": "keoaruboru", "裂水竜": "zenaserisu", "水砦竜": "gureadomosu",
    "凍海獣": "pokaradon", "響狼": "kamu-orugaron", "雄響狼": "kamu-orugaron", "雌響狼": "nono-orugaron",
    "闘獣": "lolo-gougarf", "金銀魚竜": "goruganosu", "大猪": "bulldrome", "奇面族": "shakalaka", "奇面王": "king-shakalaka",
    "大鎌将軍": "shogun-ceanataur", "大君": "taikun-zamuza", "白影": "khezu", "赤影": "red-khezu",
    # Short forms in quest names (浮岳 for 浮岳龍, 華鳳 for 華鳳鳥).
    "浮岳": "yama-tsukami", "浮峰": "yama-kurai", "華鳳": "forokururu", "黒蝕": "gore-magala", "獄狼": "stygian-zinogre",
    "弩岩": "odibatorasu", "棘茶": "orange-espinas", "炎王": "teostra", "奇面": "shakalaka", "雅翁": "inagami",
    "双轟": "tigrex", "桃毛": "congalala", "炎妃": "lunastra", "エスピナ": "espinas",  # エスピナ: the armour series
    # Pairs: 棘(竜)と眠(鳥), 青(怪鳥)と紫(怪鳥), 岩(竜)と鎧(竜).
    "棘と眠": ["espinas", "hypnocatrice"], "青紫怪鳥": ["blue-yian-kut-ku", "purple-gypceros"],
    "岩鎧": ["basarios", "gravios"],
}

# Other English spellings of field guide monsters in the texts (older translation waves, the game's own words).
EN_ALIASES = {
    "Lavasioth": "volganos", "Barlagual": "baruragaru", "Toridokuresu": "toridcless", "Quarusepsu": "kuarusepusu",
    "Kuarlusepusu": "kuarusepusu", "Qualsepsu": "kuarusepusu", "Chachabu": "shakalaka", "Farnock": "farunokku",
    "Arganos": "aruganosu", "Golganos": "goruganosu", "Odiba": "odibatorasu", "Orgaron": "kamu-orugaron",
    "Gougarufu": "lolo-gougarf", "Gougarf": "lolo-gougarf", "Nana Tesukatori": "lunastra",
    "Teo Tesukatoru": "teostra", "Zenaseris": "zenaserisu", "Diorex": "diorex", "Eruzerion": "elzelion",
    "Toastra": "toa-tesukatora", "Vojan": "voljang", "Valsabros": "varusaburosu", "Vorsphyroa": "disufiroa",
    "Gamizami": "hermitaur", "Kantaros": "hornetaur", "Yaozami": "ceanataur", "Gabras": "remobra",
    "Duragaua": "dyuragaua", "Doragyuros": "doragyurosu", "Kut-Ku": "yian-kut-ku", "Garuga": "yian-garuga",
    "Narga": "nargacuga", "Kushala": "kushala-daora", "Daimyo": "daimyo-hermitaur", "Shogun": "shogun-ceanataur",
    "Lao-Shan": "lao-shan-lung", "Lao Shan Lung": "lao-shan-lung", "Laviente": "raviente",
    "Berserk Laviente": "berserk-laviente", "Kirin": "kirin", "Uruki": "uruki", "Mi-Ru": "mi-ru",
    "King Chachabu": "king-shakalaka", "Shakalaka King": "king-shakalaka", "Dos-Genprey": "gendrome",
    "Dos-Ioprey": "iodrome",
    # Whole spans, so a fix replaces all of it ("Purple Kut-Ku" for 紫怪鳥, Purple Gypceros).
    "Purple Kut-Ku": "yian-kut-ku", "Purple Yian Kut-Ku": "yian-kut-ku", "Blue & Purple Kut-Ku": "yian-kut-ku",
    "Gold and Silver Plesioth": "plesioth",
    # Items, not the monster: フルフルベビー.
    "Khezu Baby": None, "Khezu Babies": None, "Baby Khezu": None, "Khezu Whelp": None, "Khezu Whelps": None,
}

# Field guide entries that are not monsters, or words the English prose uses for other things ("Felyne Comrade").
EN_IGNORE = {"Rock", "Cactus", "Unknown", "Erupe", "Felyne", "Melynx", "Khezu Baby"}

# Monsters of other Monster Hunter games, not in Frontier: always wrong in a quest text.
FOREIGN = {"Duramboros": "Duramboros (ドボルベルク)", "Dahren Mohran": "Dahren Mohran (ダレン・モーラン)",
           "Gargwa": "Gargwa (ガーグァ)"}

# Class words: a text that says 魚竜 ("piscine wyvern") means the quest's own piscine wyvern, when its objectives
# name one (quest 15009 砂漠の魚竜 is a Cephadrome quest, 61102 魚竜自在 a Plesioth one).
CLASS_WORDS = {"魚竜": {"plesioth", "cephadrome", "cephalos", "goruganosu", "zenaserisu", "volganos"}}

# Reviewed texts the rules above cannot settle: (quest id, text kind, wrong English name) -> the right monster's slug,
# "=words" to put instead of the name, or None when the name is right after all. Text kinds: name (site name, file
# string 0), objective (1), subA (2), subB (3), client (6), description (7; site descriptionEn and description).
OVERRIDES = {
    (103, "name", "Gogomoa"): "cephalos",              # 砂漠の暴走族を止めろ！: the desert "biker gang" is Cephalos
    (62559, "description", "Bulldrome"): "bullfango",  # ブルファンゴ came in with the Dyuragaua
    (53220, "description", "Hypnocatrice"): "=Halk",   # ホルク, the hunter's pet bird
    (50874, "name", "Shantien"): "=Tower",             # 天廊ネコ指南: the Sky Corridor tower (that is too wide)
    (55707, "name", "Plesioth"): None,                 # 受け継がれる魚竜魂！ (a Rathalos quest): the fish wyvern spirit
    (63107, "name", "Yian Kut-Ku"): "=Blue Kut-Ku & Purple Gypceros",  # みんなで青紫怪鳥討伐！
    (50650, "description", "Plesioth"): "=Goruganosu and Aruganosu",  # 金銀魚竜
    (50873, "description", "Shantien"): "=Sky Corridor",  # 天廊調査, next to a wrong ≪Toa Tesukatora≫ for 華鳳鳥
    (53139, "name", "Yian Kut-Ku"): None,              # an April Fools' "メガ個体" (mega specimen) quest
    (63299, "description", "Plesioth"): None,          # 魚竜のキモ, the Plesioth liver item
    (50163, "description", "Kuarusepusu"): "=Orugaron",  # reward list: 響狼の紅玉, the Orugaron ruby
    (50172, "description", "Akura Vashimu"): "akura-jebia",  # reward list: 灰晶蠍の血晶石 ...
}

# Subspecies, rare species and forms count as their species.
FAMILY = {
    "azure-rathalos": "rathalos", "silver-rathalos": "rathalos", "pink-rathian": "rathian",
    "gold-rathian": "rathian", "blue-yian-kut-ku": "yian-kut-ku", "purple-gypceros": "gypceros",
    "breeding-season-hypnocatrice": "hypnocatrice", "silver-hypnocatrice": "hypnocatrice",
    "black-diablos": "diablos", "white-monoblos": "monoblos", "black-gravios": "gravios",
    "green-plesioth": "plesioth", "red-khezu": "khezu", "red-volganos": "volganos", "orange-espinas": "espinas",
    "white-espinas": "espinas", "ashen-lao-shan-lung": "lao-shan-lung", "stygian-zinogre": "zinogre",
    "crimson-fatalis": "fatalis", "white-fatalis": "fatalis", "rusted-kushala-daora": "kushala-daora",
    "berserk-laviente": "raviente", "ray-gougarf": "lolo-gougarf", "nono-orugaron": "kamu-orugaron",
    "aruganosu": "goruganosu", "pokara": "pokaradon", "duremudira-2nd": "duremudira-1st",
    "duremudira-musou": "duremudira-1st", "musou-mi-ru": "mi-ru",
    # The two small crabs: the field guide calls ヤオザミ "Ceanataur" and ガミザミ "Hermitaur", the served quest files
    # mostly "Young Ceanataur" and "Young Hermitaur" (but "Hermitaur" 36 times for ヤオザミ); the main series'
    # English is the other way round. Not settled here, so either name is accepted for either crab.
    "hermitaur": "ceanataur",
}


def family(slug):
    if slug.startswith("musou-") and slug not in FAMILY:
        return slug[len("musou-"):]
    return FAMILY.get(slug, slug)


def load_names():
    """{slug: field guide name} and the two lookup tables: Japanese spelling -> slug, English spelling -> slug."""
    names = {m["slug"]: m["name"] for m in json.loads(INDEX.read_text(encoding="utf-8"))}
    jp = {k: v for k, v in mqm.JP.items() if isinstance(v, str) or v is None}
    jp.update({k: v[0] for k, v in mqm.JP.items() if isinstance(v, list)})
    jp.update(JP_EXTRA)
    jp.update(EPITHETS)
    en = {name: slug for slug, name in names.items() if name not in EN_IGNORE}
    en.update(EN_ALIASES)
    en.update({k: "!" + k for k in FOREIGN})
    for table in (jp, en):
        for v in table.values():
            for slug in (v if isinstance(v, list) else [v]):
                if slug and not slug.startswith("!") and slug not in names:
                    raise SystemExit("fix-quest-monster-names: %r is not in data/monsters/index.json" % slug)
    return names, jp, en


def jp_monsters(text, jp):
    """Slugs the Japanese text names, in order of appearance (longest spellings first; a spelling may name two)."""
    text = re.sub(r"[\n　 ]", "", text or "")
    found = []
    for spelling in sorted(jp, key=len, reverse=True):
        start = text.find(spelling)
        while start != -1:
            found.append((start, jp[spelling]))
            text = text[:start] + "\0" * len(spelling) + text[start + len(spelling):]
            start = text.find(spelling)
    out = []
    for _, value in sorted(found, key=lambda f: f[0]):
        for slug in (value if isinstance(value, list) else [value]):
            if slug and slug not in out:
                out.append(slug)
    return out


_EN_RE = {}


def en_monsters(text, en):
    """(start, end, slug) of every monster name in an English text, in order ("!Name" for a FOREIGN one; spellings
    mapped to None, like the item "Khezu Baby Ice", are skipped)."""
    key = id(en)
    if key not in _EN_RE:
        spellings = sorted(en, key=len, reverse=True)
        _EN_RE[key] = re.compile(r"(?<![A-Za-z])(" + "|".join(re.escape(s).replace(r"\ ", r"[ \n]") for s in spellings)
                                 + r")(?:s|es)?(?![a-z])")
    out = []
    for m in _EN_RE[key].finditer(text or ""):
        slug = en[re.sub(r"\n", " ", m.group(1))]
        if slug:
            out.append((m.start(1), m.end(1), slug))
    return out


def keep_break(old, new):
    """new, with a line break where old had one ("Purple\nYian Kut-Ku" -> "Purple\nGypceros"): the served files
    break every line by hand."""
    if "\n" not in old or " " not in new:
        return new
    at = old[:old.index("\n")].count(" ") + 1  # the break comes after this many words
    words = new.split(" ")
    at = min(at, len(words) - 1)
    return " ".join(words[:at]) + "\n" + " ".join(words[at:])


def numbers(text):
    return re.findall(r"\d+", unicodedata.normalize("NFKC", text))


def check_text(jp_text, en_text, jp, en, names, where=None, quest_monsters=()):
    """(new English text or None, [(wrong label, right name or None)]) for one pair of texts; where = (quest id,
    text kind) for OVERRIDES; quest_monsters = the slugs the quest's Japanese objectives name (for CLASS_WORDS)."""
    if not jp_text or not en_text or not re.search(r"[぀-ヿ一-鿿]", jp_text):
        return None, []
    want = [s for s in jp_monsters(jp_text, jp) if names[s] not in EN_IGNORE]  # アイルー: "Felyne" is not checked
    for word, fams in CLASS_WORDS.items():
        if word in jp_text:
            want += [s for s in quest_monsters if family(s) in fams and s not in want]
    # A Japanese text that names no monster ("古の賛歌") is not about a monster; an English one that names the quest's
    # own monster has another fault (some served titles have the objective glued on: "Ancient Hymn 1 Rathian
    # Variant"), not a wrong name.
    named = bool(want)
    want_fams = [family(s) for s in want] or [family(s) for s in quest_monsters]
    kind = where[1] if where else None
    if kind == "client":  # served client lines that hold an objective ("Rajang Variant x1") have another fault
        want_fams += [family(s) for s in quest_monsters]
    have = en_monsters(en_text, en)
    have_fams = {family(s) for _, _, s in have if not s.startswith("!")}
    missing = [s for s in want if family(s) not in have_fams]
    missing_fams = list(dict.fromkeys(family(s) for s in missing))
    wrong = []
    out, last = [], 0
    for start, end, slug in have:
        if not slug.startswith("!") and family(slug) in want_fams:
            continue
        wrong_name = slug[1:] if slug.startswith("!") else names[slug]
        label = FOREIGN.get(wrong_name, wrong_name)
        inside = [s for s in missing if re.search(r"\b%s$" % re.escape(wrong_name), names[s])]
        override = (where[0], where[1], wrong_name) if where else None
        if override in OVERRIDES:
            target = OVERRIDES[override]
            if target is None:
                continue
        elif not named:  # a wrong monster in a text that names none: only a human can tell what was meant
            target = None
        elif len(missing_fams) == 1:
            target = next(s for s in missing if family(s) == missing_fams[0])
        elif len(set(want_fams)) == 1:
            target = want[0]
        elif len(inside) == 1:  # "Ceanataur" for 鎌蟹 (Shogun Ceanataur) next to another monster
            target = inside[0]
        else:
            target = None
        right = target and (target[1:] if target.startswith("=") else names[target])
        wrong.append((label, right))
        if right:
            before = en_text[last:start]
            article = re.search(r"\b([Aa])n?( |\n)$", before)
            if article:  # "a Gendrome" / "an Iodrome"
                vowel = right[0] in "AEIOU"
                before = before[:article.start()] + article.group(1) + ("n" if vowel else "") + article.group(2)
            out.append(before)
            out.append(keep_break(en_text[start:end], right))
            last = end
    if not wrong:
        return None, []
    if kind in ("objective", "subA", "subB") and numbers(en_text) and numbers(en_text) != numbers(jp_text):
        # The whole objective is another one's ("Slay 8 Ioprey" for ヒプノック１頭の狩猟): renaming would not fix it.
        return None, [("objective text of another objective", None)]
    out.append(en_text[last:])
    new = "".join(out)
    return (new if new != en_text else None), wrong


KIND = {"name": "name", "objectiveEn": "objective", "subAEn": "subA", "subBEn": "subB", "descriptionEn": "description",
        "description": "description", "clientEn": "client", "client": "client"}
FILE_KIND = {0: "name", 1: "objective", 2: "subA", 3: "subB", 4: "clear", 5: "fail", 6: "client", 7: "description"}


_TABLES = []


def repair(jp_text, en_text, qid, kind, objectives_jp=""):
    """en_text with its wrong monster names replaced (unchanged when none or when only a human can tell); for
    dev/fix-quest-objectives.py, which copies the served files' sub-objective English. objectives_jp: the quest's
    Japanese objectives (for CLASS_WORDS)."""
    if not _TABLES:
        _TABLES.extend(load_names())
    names, jp, en = _TABLES
    new, _ = check_text(jp_text, en_text, jp, en, names, (qid, kind), jp_monsters(objectives_jp, jp))
    return new or en_text


def site_pairs(quests, details):
    """(quest id, label, holder dict, English key, Japanese text) of every site text checked."""
    for q in quests:
        qid = q["id"]
        yield qid, "name", q, "name", q.get("nameJp")
        d = details.get(str(qid))
        if not d:
            continue
        for en_key, jp_key in (("objectiveEn", "objectiveJp"), ("subAEn", "subAJp"), ("subBEn", "subBJp"),
                               ("descriptionEn", "descriptionJp"), ("description", "descriptionJp")):
            yield qid, en_key, d, en_key, d.get(jp_key)
        if re.search("[぀-ヿ一-鿿]", q.get("client") or ""):
            for key in ("clientEn", "client"):
                yield qid, key, d, key, q["client"]


def run_site(write):
    names, jp, en = load_names()
    data = json.loads(QUESTS.read_text(encoding="utf-8"))
    details = json.loads(DETAILS.read_text(encoding="utf-8"))
    changes, left = [], []
    pairs = collections.Counter()
    objectives = {}
    for q in data["quests"]:
        d = details.get(str(q["id"])) or {}
        texts = [q.get("objectiveJp"), d.get("objectiveJp"), d.get("subAJp"), d.get("subBJp")]
        objectives[q["id"]] = jp_monsters(" ".join(t for t in texts if t), jp)
    for qid, label, holder, key, jp_text in site_pairs(data["quests"], details):
        new, wrong = check_text(jp_text, holder.get(key), jp, en, names, (qid, KIND[key]), objectives[qid])
        for wrong_label, target in wrong:
            pairs[(wrong_label, target or "?")] += 1
            if not target:
                left.append("quest %s %s: %s (Japanese: %s)" % (qid, label, wrong_label, jp_text.replace("\n", " ")))
        if new:
            changes.append((qid, label, holder[key], new))
            holder[key] = new
    if write and changes:
        QUESTS.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        DETAILS.write_text(json.dumps(details, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return changes, left, pairs


# The served files' boxes (the client does not wrap: hvmhfz_re docs/translation.md "Line breaks and box widths").
# A fixed string keeps every line within its old widest line (at least LINE_BYTES, the served descriptions' usual
# 26) and gains at most one line; a quest title line may reach TITLE_BYTES (99.5% of the served titles fit in 40
# cp932 bytes). Where a title would not fit, the crabs take their short names.
LINE_BYTES, TITLE_BYTES = 26, 40
SHORT = {"Shogun Ceanataur": "Shogun", "Daimyo Hermitaur": "Daimyo"}


def width(line):
    return len(line.encode("cp932", "replace"))


def fit_box(old, new, kind):
    """new laid out to fit old's box (see above), or None when it cannot."""
    old_lines = old.split("\n")
    if kind == "name":
        limit = max(max(map(width, old_lines)), TITLE_BYTES)
        for long, short in SHORT.items():
            if max(map(width, new.split("\n"))) > limit:
                new = new.replace(long, short)
        return new if max(map(width, new.split("\n"))) <= limit else None
    limit = max(max(map(width, old_lines)), LINE_BYTES)
    lines = new.split("\n")
    i = 0
    while i < len(lines):
        while width(lines[i]) > limit:  # move the last word down to the next line
            if " " not in lines[i]:
                return None
            head, word = lines[i].rsplit(" ", 1)
            lines[i] = head
            if i + 1 == len(lines):
                lines.append(word)
            else:
                lines[i + 1] = word + (" " + lines[i + 1] if lines[i + 1] else "")
        i += 1
    return "\n".join(lines) if len(lines) <= len(old_lines) + 1 else None


def snapshot(path):
    """{file name: [8 strings]} of a dev/make-quest-objectives.py "extract" snapshot (errors skipped)."""
    out = {}
    for line in open(path, encoding="utf-8"):
        row = json.loads(line)
        if row[1] != "ERR":
            out[row[0]] = row[2]
    return out


def run_files(live_path, orig_path, fixes_path):
    names, jp, en = load_names()
    live, orig = snapshot(live_path), snapshot(orig_path)
    pairs, files, quests, left = collections.Counter(), set(), set(), []
    rows = []
    for name in sorted(live):
        if name not in orig:
            continue
        objectives = jp_monsters(" ".join(orig[name][1:4]), jp)
        for i, (en_text, jp_text) in enumerate(zip(live[name], orig[name])):
            new, wrong = check_text(jp_text, en_text, jp, en, names, (int(name[:5]), FILE_KIND[i]), objectives)
            for wrong_label, target in wrong:
                pairs[(wrong_label, target or "?")] += 1
                if not target:
                    left.append("%s string %d: %s (Japanese: %s)" % (name, i, wrong_label, jp_text.replace("\n", " ")))
            if new:
                fitted = fit_box(en_text, new, FILE_KIND[i])
                if fitted is None:
                    left.append("%s string %d: %r does not fit the box" % (name, i, new))
                    continue
                rows.append((name, i, en_text, fitted))
                files.add(name)
                quests.add(name[:5])
    if fixes_path:
        with open(fixes_path, "w", encoding="utf-8") as f:
            f.write("file\tstring\told_text\tnew_text\n")
            for name, i, old, new in rows:
                f.write("%s\t%d\t%s\t%s\n" % (name, i, old.replace("\n", "\\n"), new.replace("\n", "\\n")))
    print("live files: %d strings to fix in %d files of %d quests" % (len(rows), len(files), len(quests)))
    print_pairs(pairs)
    for line in left:
        print("left alone: " + line)
    return 0


def print_pairs(pairs):
    print("wrong name -> Japanese text's monster: count")
    for (wrong, right), n in sorted(pairs.items(), key=lambda p: (-p[1], p[0])):
        print("  %s -> %s: %d" % (wrong, right, n))


def self_test():
    """Made-up texts with the cases the rules are for; returns the number of failures."""
    names, jp, en = load_names()
    cases = [  # (Japanese, English, kind, quest's objectives in Japanese, expected English or None = unchanged)
        ("狩猟体験！デュラガウア", "Trial Hunt! Duramboros", "name", "", "Trial Hunt! Dyuragaua"),
        ("天嵐への導き【氷狐竜】", "Storm Guidance: Duramboros", "name", "", "Storm Guidance: Dyuragaua"),
        ("剛種適性試験・岩竜と毒鳥竜", "Hardcore Test: Basarios & Gypceros", "name", "", "Hardcore Test: Basarios & Iodrome"),
        ("凄腕への励み・鎌蟹", "Aim for Expert: Ceanataur", "name", "", "Aim for Expert: Shogun Ceanataur"),
        ("ドスゲネポスとは･･･？", "What's an Iodrome...?", "name", "", "What's a Gendrome...?"),
        ("跳緋獣を追え！", "Chase the\nPariapuria!", "name", "", "Chase the\nGogomoa!"),
        ("紫怪鳥の狩猟", "Purple Kut-Ku Hunt", "name", "", "Purple Gypceros Hunt"),
        ("ハルドメルグ素材獲得", "Dahren Mohran Materials", "name", "", "Harudomerugu Materials"),
        ("砂漠の魚竜を釣って狩れ！", "Fish and Hunt the Desert Plesioth!", "name", "ドスガレオス１頭の狩猟",
         "Fish and Hunt the Desert Cephadrome!"),
        ("回避の鬼！魚竜自在", "Dodge Master! Free Plesioth", "name", "ガノトトス１頭の討伐", None),
        ("古の賛歌", "Ancient Hymn 1 Rathian Variant", "name", "リオレイア変種１頭", None),
        ("デュラガウア１頭の狩猟", "Hunt 1 Dyuragaua", "objective", "", None),
        ("ヒプノック１頭の狩猟", "Slay 8 Ioprey", "objective", "", None),  # another objective's text: left
        ("フルフルベビー２匹の納品", "Deliver 2 Khezu Babies", "objective", "", None),
    ]
    failures = 0
    for jp_text, en_text, kind, objectives, want in cases:
        new, _ = check_text(jp_text, en_text, jp, en, names, (0, kind), jp_monsters(objectives, jp))
        if new != want:
            failures += 1
            print("self-test: %r / %r gave %r, expected %r" % (jp_text, en_text, new, want))
    boxes = [("Hunt the Basarios that\nlives in the Volcano.", "Hunt the Black Gravios that\nlives in the Volcano.",
              "Hunt the Black Gravios\nthat lives in the Volcano.")]
    for old, new, want in boxes:
        got = fit_box(old, new, "description")
        if got != want:
            failures += 1
            print("self-test: fit_box gave %r, expected %r" % (got, want))
    print("self-test: %d cases, %d failures" % (len(cases) + len(boxes), failures))
    return failures


def main(args):
    if "--self-test" in args:
        return 1 if self_test() else 0
    if args and args[0] == "--files":
        fixes = args[args.index("--fixes") + 1] if "--fixes" in args else None
        return run_files(args[1], args[2], fixes)
    check = "--check" in args
    changes, left, pairs = run_site(not check)
    if "--verbose" in args or not check:
        for qid, label, old, new in changes:
            print("quest %s %s: %r -> %r" % (qid, label, old, new))
        print_pairs(pairs)
    for line in left:
        print("left alone: " + line)
    print("%d texts of %d quests %s" % (len(changes), len({c[0] for c in changes}),
                                        "name a wrong monster" if check else "changed"))
    return 1 if check and (changes or left) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
