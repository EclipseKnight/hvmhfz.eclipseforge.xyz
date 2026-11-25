#!/usr/bin/env python3
"""Checks that the names in the Frontier guide (guide-frontier-*.html) are the ones we use everywhere else: the
game's own English (our client patch, as the site's data has it), the site database and the Discord bot.

  python3 dev/check-guide-names.py            report: counts by kind, the top mismatches (exit 0)
  python3 dev/check-guide-names.py --write    also write dev/guide-names-findings.tsv, the rewrite worklist
  python3 dev/check-guide-names.py --strict   exit 1 while any name is mismatched or unknown (not allowlisted)
  python3 dev/check-guide-names.py --all      the findings file also lists the matched names
  python3 dev/check-guide-names.py --self-test   runs the checks on made-up data
  python3 dev/check-guide-names.py --ja-from-dat <decoded mhfdat.bin>   rebuilds dev/item-names-ja.json (below)

Report-only by default until the pages are rewritten; then add --strict to the site checks.

What it reads in each page's <main> (not the side lists, breadcrumbs or verdict labels):
  bold     <strong>/<b> text
  list     the lead of an <li> (before ":", " (", " - ")
  cell     a short table cell
  quote    "quoted" names (quest names mostly)
  path     menu paths "X > Y > Z" (every part is checked against the menu names)
  cjk      Chinese or Japanese text (mapped to our English through the client's Japanese names)
  note     phrases that keep the original guide's own names: "Chinese name", "literal translation", ...
Only name-like text is checked (capitalised words, at most 8; no ranks, counts or labels ending in ":").

Our names (the game's exact English, typos included; owner rule):
  items        data/item-ids.json (the client's names); data/items/index.json "aka" (a server or older name: a
               guide name that is an aka is reported with the item's name)
  decorations, sigils   data/armor/index.json;  armour pieces data/armor/<slot>.json (and their set names);
  weapons      data/weapons/<type>.json;  monsters data/monsters/index.json (+ Zenith forms) and data/monster-ids.json
  skills       data/skills/index.json (trees, skill names, Road skills, sigils)
  quests       data/quests.json names and categories;  places data/map-ids.json;  currencies data/currencies.json
  menus, NPCs  dev/guide-terms.tsv: the in-game English of town NPCs, counters, quest tabs and menus, with the
               source row for each and the guide's own names for them (column guide_names)
Japanese (for the guide's Chinese): dev/item-names-ja.json (items), data/quests.json nameJp, data/map-ids.json ja,
the monsters' katakana names and kanji epithets (dev/make-quest-monsters.py, dev/fix-quest-monster-names.py),
dev/guide-terms.tsv japanese, and, when hvmhfz_re is there (--re, default /root/mhfz/hvmhfz_re), its shipped
translation table's armour and weapon names (data/translations/shipped/mhfdat.tsv). Traditional Chinese is turned
into Japanese forms first (T2JP below: 劍 -> 剣, 藥 -> 薬, 龍 -> 竜 on both sides; 的 -> の, 任務 -> クエスト ...).

dev/item-names-ja.json: the client patch's mhfdat.bin keeps the original Japanese item names as a run of strings in
item order (hvmhfz_re docs/hiden-items.md section 2). --ja-from-dat aligns that run to item ids: the 500-odd items
whose name pointer still lands in the run, and the food data's Japanese names (data/food-recipes.json), are fixed
points; between two fixed points with as many strings as ids every name is certain ("h"); where strings are
missing (dummy items share one) a scored alignment places them ("m" when it agrees with its neighbours, else "l").

dev/guide-names-allow.tsv: deliberate exceptions (page or *, text, reason), e.g. the original guide's terms when
quoted as history, people and outside sites. An allowlisted name is reported as "allowed".

Status of each name: matched (our name exactly, or a plural of it), mismatched (we call it something else: the
best match and a confidence), unknown (no good match; the best guess, if any). Confidence: high, medium, low.
"""
import argparse
import difflib
import hashlib
import html
import html.parser
import importlib.util
import json
import math
import pathlib
import re
import struct
import sys
import unicodedata
from collections import Counter, defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
FINDINGS = "dev/guide-names-findings.tsv"
TERMS = "dev/guide-terms.tsv"
ALLOW = "dev/guide-names-allow.tsv"
JA_ITEMS = "dev/item-names-ja.json"
RE_DEFAULT = pathlib.Path("/root/mhfz/hvmhfz_re")

# Traditional Chinese -> Japanese character forms (OpenCC t2jp, single characters; pairs of characters).
T2JP_PAIRS = (
    "乘乗亂乱亙亘亞亜佛仏來来俠侠俱倶倂併值値假仮傳伝僞偽價価儉倹兒児兔兎內内兩両冰氷凛凜剎刹剩剰劍剣劑剤勞労勳勲勵励"
    "勸勧勻匀區区卷巻卻却卽即參参吳呉咒呪啞唖單単噓嘘嚙噛嚴厳囑嘱圈圏國国圍囲圓円圖図團団堯尭填塡增増墮堕壓圧壘塁壞壊"
    "壤壌壯壮壹壱壽寿奧奥奬奨妝粧姊姉姬姫孃嬢學学寢寝實実寫写寬寛寶宝將将專専對対屆届屬属峯峰峽峡嶽岳巖巌巢巣帶帯廁厠"
    "廢廃廣広廳庁彈弾彌弥彎弯彥彦徑径從従徵徴德徳恆恒悅悦惠恵惡悪惱悩愼慎慘惨應応懷懐戀恋戰戦戲戯戶戸戾戻拂払拔抜拜拝"
    "挾挟插挿揭掲搔掻搖揺搜捜摑掴擇択擊撃擔担據拠擧挙擴拡攝摂攪撹收収效効敍叙敕勅敘叙數数斷断晄晃晉晋晚晩晝昼暨曁曆暦"
    "曉暁曾曽會会枡桝查査條条棧桟棱稜榆楡榮栄槇槙槪概樂楽樓楼樞枢樣様橫横檜桧檢検櫻桜權権歐欧歡歓步歩歲歳歷歴歸帰殘残"
    "殼殻毆殴每毎氣気污汚沒没涉渉淚涙淨浄淺浅渴渇溪渓溫温溼湿滯滞滿満潑溌潛潜澀渋澁渋澤沢濕湿濟済濤涛濱浜濾沪瀧滝瀨瀬"
    "灣湾焰焔燈灯燒焼營営爐炉爭争爲為牀床犧犠狀状狹狭獎奨獨独獵猟獸獣獻献瓣弁甁瓶產産畫画當当疊畳痹痺瘦痩癡痴發発皋皐"
    "盜盗盡尽眞真硏研碎砕礪砺祕秘祿禄禦御禪禅禮礼禰祢禱祷稅税稱称稻稲穎頴穗穂穩穏穰穣竈竃竊窃竝並粹粋糉粽絕絶絲糸經経"
    "綠緑緖緒緣縁縣県縱縦總総繡繍繩縄繪絵繫繋繼継續続纔才纖繊缺欠罐缶羣群聯連聰聡聲声聽聴肅粛脣唇脫脱腦脳腳脚膽胆臟臓"
    "臺台與与舉挙舊旧舍舎艷艶荔茘莊荘莖茎菸煙萊莱萠萌萬万蔣蒋蔥葱薰薫藏蔵藝芸藥薬蘆芦處処虛虚號号螢蛍蟬蝉蟲虫蠟蝋蠶蚕"
    "蠻蛮衞衛裝装襃褒覺覚覽覧觀観觸触說説謠謡證証譯訳譽誉讀読變変讓譲豐豊豫予貓猫貳弐賣売賴頼贊賛贗贋踐践輕軽輛輌轉転"
    "辨弁辭辞辯弁遙遥遞逓遲遅邊辺郞郎鄉郷鄕郷鄰隣醉酔醫医醬醤醱醗釀醸釋釈銳鋭鋪舗錄録錢銭鍊錬鎭鎮鐵鉄鑄鋳鑛鉱閱閲關関"
    "陷陥隨随險険隱隠雙双雜雑雞鶏霸覇靈霊靜静顏顔顯顕飜翻餘余餠餅騷騒驅駆驗験驛駅髓髄體体髮髪鬥闘鬭闘鱉鼈鷄鶏鷗鴎鹼鹸"
    "鹽塩麥麦麪麺麴麹麵麺黃黄黑黒默黙點点黨党齊斉齋斎齒歯齡齢龍竜龜亀")
T2JP = {T2JP_PAIRS[k]: T2JP_PAIRS[k + 1] for k in range(0, len(T2JP_PAIRS), 2)}
# Taiwanese words -> the Japanese client's (after T2JP): quests, hunter, guild, points, menu, coin, cuff, the particle.
ZH_WORDS = (("任務", "クエスト"), ("猟人", "ハンター"), ("公会", "ギルド"), ("点数", "ポイント"), ("選単", "メニュー"),
            ("硬幣", "コイン"), ("鈕扣", "カフ"), ("的", "の"), ("·", "・"))

CJK = "\\u3040-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff"   # kana, CJK ideographs (a regex class body)
CJK_RUN = re.compile("[A-Za-z0-9\\uff10-\\uff19\\uff21-\\uff3a\\uff41-\\uff5a]*"     # a run with at least one kana or
                     "[\\u3041-\\u30fa\\u30fd-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff]"   # ideograph (not ・ or ー alone)
                     "[" + CJK + "\\uff10-\\uff19\\uff21-\\uff3a\\uff41-\\uff5a\\u00b7A-Za-z0-9]*")
NOTE_RE = re.compile(r"(Chinese names?|Chinese[- ]only|literal translation|translation of the Chinese|rough "
                     r"translations?|the original label[s]?|the guide'?s (?:own )?(?:English|name|label|list)|"
                     r"named in the guide|the guide calls|Japanese and Chinese names)", re.I)
QUOTE_RE = re.compile(r"[\"“]([^\"“”\n]{2,90})[\"”]")
SMALL = {"of", "the", "and", "a", "an", "in", "on", "for", "to", "at", "with", "de", "x", "or", "from", "vs", "by"}
SKIP_RE = re.compile(
    r"^(?:\d[\d,.]*\s*(?:x|%|z|pts?|points?|minutes?|hours?|days?|seconds?)?|x\d+|"
    r"(?:HR|GR|SR|G|HRP|GRP|Lv\.?|Level|Rank|Task|Step|Day|Page|Floor|Tier|Phase|Part|Stage|Week|Grade)\s*[\d★]+.*|"
    r"[★☆]+\d*|[A-Z]?\d+[-–]\d+.*|.*:|Different\.|Works the same\.|Unknown, not checked\.|Not available here yet\.)$")
GENERIC = re.compile(r"^(?:(?:light |dark |pale )?(?:red|blue|green|yellow|white|black|purple|pink|orange|grey|gray|"
                     r"brown|gold|silver)(?:(?:,| and| or|/| /) (?:light |dark )?(?:red|blue|green|yellow|white|black|"
                     r"purple|pink|orange|grey|gray|brown|gold|silver))*|.*\d+\s*%.*)$", re.I)   # colours, percentages
NAME_SPLIT = re.compile(r"\s*(?::|\s\(|\s[-–—]\s|;)\s*")
QTY_RE = re.compile(r"^(?:\d[\d,]*\s*[x×]?\s+(?=[A-Za-z])|[x×]\s*\d+\s+)|\s+(?:[x×]\s*\d+|\(\d+\s*x?\))$", re.I)
SLOT_WORDS = {"helm", "cap", "head", "headgear", "hat", "mask", "crown", "mail", "vest", "chest", "jacket", "body",
              "braces", "guards", "arms", "gloves", "vambraces", "sleeves", "tasset", "coil", "waist", "belt", "faulds",
              "greaves", "leggings", "legs", "boots", "shoes", "plate", "cuirass", "gauntlets", "trousers", "pants"}
WEAPON_SHORT = {"GS": "Great Sword", "LS": "Long Sword", "SnS": "Sword and Shield", "DS": "Dual Swords",
                "HBG": "Heavy Bowgun", "LBG": "Light Bowgun", "HH": "Hunting Horn", "GL": "Gunlance",
                "SAF": "Switch Axe F", "MS": "Magnet Spike", "Tonfa": "Tonfa", "Tonfas": "Tonfa", "Lance": "Lance",
                "Bow": "Bow", "Bows": "Bow", "Hammer": "Hammer", "Swaxe": "Switch Axe F"}
KIND_ORDER = ["decoration", "item", "armour", "armour set", "weapon", "monster", "skill", "quest", "quest category",
              "npc", "counter", "tab", "menu", "option", "place", "currency", "weapon type", "system", "item (aka)"]


def read_json(rel, root=ROOT):
    return json.loads((root / rel).read_text(encoding="utf-8"))


def key(text):
    """Comparison key: NFKC, lower case, one kind of apostrophe and dot, single spaces."""
    t = unicodedata.normalize("NFKC", text).lower().replace("’", "'").replace("‘", "'").replace("·", "・")
    t = re.sub(r"\s+([+-]\d)", r"\1", t)
    for short, full in (("sm", "small"), ("small", "small"), ("lg", "large"), ("large", "large"), ("med", "medium"),
                        ("xl", "very large")):   # Wind Res [Lg] = the game's Wind Res (Large)
        t = re.sub(r"[\[(]" + short + r"[\])]", "(" + full + ")", t)
    return re.sub(r"\s+", " ", t).strip(" .,!?")


def ja_key(text):
    """Japanese/Chinese comparison key: Traditional forms to Japanese ones, Taiwanese words to the client's."""
    t = unicodedata.normalize("NFKC", "".join(T2JP.get(c, c) for c in text))
    for zh, ja in ZH_WORDS:
        t = t.replace(zh, ja)
    return re.sub(r"[\s【】\[\]「」『』（）()]", "", t).upper()


def name_like(text):
    words = text.split()
    if not words or len(words) > 8 or len(text) > 70 or SKIP_RE.match(text):
        return False
    if not (text[0].isupper() or text[0].isdigit() or text[0] in "★Ｇ\"'"):
        return False
    caps = sum(1 for w in words if w[:1].isupper() or w[:1].isdigit() or not w[:1].isalpha())
    return caps >= max(1, len([w for w in words if w.lower() not in SMALL]) - 1)


# ---------------------------------------------------------------------------------------------- our names

class Pool:
    """Every name we use, by kind, with the Japanese ones for the guide's Chinese."""

    def __init__(self):
        self.exact = defaultdict(set)      # name -> kinds
        self.by_key = defaultdict(set)     # key(name) -> names
        self.alias = {}                    # key(guide name) -> (our name, kind, confidence, note)
        self.path_alias = {}               # key(last part of a guide path) -> the same
        self.ja = {}                       # ja_key -> (our English, kind, confidence, source)
        self.tokens = defaultdict(set)     # word -> names
        self.by_words = defaultdict(set)   # the key's words, sorted -> names
        self.forms = set()                 # form words before monster names ("Zenith", "Musou", ...)
        self.terms = []                    # rows of dev/guide-terms.tsv
        self.notes = []                    # what was not loaded

    def add(self, name, kind):
        name = (name or "").strip()
        if not name or re.search(r"dummy|^\?+$|^None$", name, re.I):
            return
        self.exact[name].add(kind)
        self.by_key[key(name)].add(name)
        self.by_words[" ".join(sorted(key(name).split()))].add(name)
        for w in re.findall(r"[a-z0-9']+", key(name)):
            if len(w) > 1 and w not in SMALL:
                self.tokens[w].add(name)

    def add_ja(self, ja, en, kind, conf, source):
        k = ja_key(ja or "")
        if not k or not en or not re.search("[" + CJK + "]", k):
            return
        old = self.ja.get(k)
        rank = {"high": 0, "medium": 1, "low": 2}
        if old is None or rank[conf] < rank[old[2]]:
            self.ja[k] = (en, kind, conf, source)

    def kind_of(self, name):
        kinds = self.exact.get(name) or set()
        return min(kinds, key=lambda k: KIND_ORDER.index(k) if k in KIND_ORDER else 99) if kinds else ""

    def finish(self):
        self.ja_index = defaultdict(set)
        for k in self.ja:
            for c in set(k):
                if re.match("[" + CJK + "]", c):
                    self.ja_index[c].add(k)
        self.df = {w: len(ns) for w, ns in self.tokens.items()}


def armour_set(name):
    words = name.split()
    if len(words) > 1 and words[-1].lower() in SLOT_WORDS:
        return " ".join(words[:-1])
    return None


def load_terms(root=ROOT):
    path = root / TERMS
    rows = []
    if not path.exists():
        return rows
    lines = [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]
    head = lines[0].split("\t")
    for line in lines[1:]:
        cells = line.split("\t") + [""] * len(head)
        rows.append(dict(zip(head, cells)))
    return rows


def load_pool(root=ROOT, re_dir=RE_DEFAULT):
    pool = Pool()
    items = read_json("data/item-ids.json", root)
    for i, name in items.items():
        pool.add(name, "item")
    index = read_json("data/items/index.json", root)["items"]
    for row in index:
        if row[3] and row[3] != row[1] and not pool.exact.get(row[3]):
            pool.alias.setdefault(key(row[3]), (row[1], "item", "high", "a server or older name of the item (aka)"))
    armor = read_json("data/armor/index.json", root)
    for row in armor["decorations"]:
        pool.add(row[1], "decoration")
    for row in armor["sigils"]:
        pool.add(row[1], "skill")
    for slot in ("head", "chest", "arms", "waist", "legs"):
        for row in read_json(f"data/armor/{slot}.json", root)["pieces"]:
            pool.add(row[1], "armour")
            s = armour_set(row[1])
            if s:
                pool.add(s, "armour set")
    for path in sorted((root / "data/weapons").glob("*.json")):
        if path.name in ("index.json", "ids.json"):
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        at = data["fields"].index("name")
        for row in data["weapons"]:
            pool.add(row[at], "weapon")
    for name in list(WEAPON_SHORT.values()) + armor["rank"]["classes"]:
        pool.add(name, "weapon type")
    listed = re.search(r"var WEAPON_NAMES = \[(.*?)\];", (root / "js/hunters.js").read_text(encoding="utf-8"), re.S)
    for name in re.findall(r'"([^"]*)"', listed.group(1) if listed else ""):
        pool.add(name, "weapon type")
    for name in armor["skillNames"].values():
        pool.add(name, "skill")
    systems = root / "guide-frontier-systems.html"
    if systems.exists():   # the site's own names of the game systems (its section headings)
        for h in re.findall(r"<h2[^>]*>(.*?)</h2>", systems.read_text(encoding="utf-8"), re.S):
            for part in re.split(r",| and |\(|\)", html.unescape(re.sub(r"<[^>]+>", "", h))):
                part = part.strip()
                if part and part[0].isupper() and part not in ("Our website tools", "Systems at a glance"):
                    pool.add(part, "system")
    for short in WEAPON_SHORT:
        pool.add(short, "weapon type")
    monsters = read_json("data/monsters/index.json", root)
    for m in monsters:
        pool.add(m["name"], "monster")
        if " (" in m["name"]:      # Duremudira (1st): the game says Duremudira
            pool.add(m["name"].split(" (")[0], "monster")
        if "Zenith" in (m.get("variants") or []):
            pool.add("Zenith " + m["name"], "monster")
    for name in read_json("data/monster-ids.json", root).values():
        pool.add(name, "monster")
    skills = read_json("data/skills/index.json", root)
    for tree in skills["trees"]:
        pool.add(tree[1], "skill")
        for level in tree[3]:
            pool.add(level[2], "skill")
    for row in skills["road"]:
        pool.add(row[1], "skill")
    quests = read_json("data/quests.json", root)["quests"]
    for q in quests:
        pool.add(q["name"], "quest")
        pool.add(q.get("category"), "quest category")
        if q.get("nameJp") and q.get("name") and re.search("[" + CJK + "]", q["nameJp"]):
            pool.add_ja(q["nameJp"], q["name"], "quest", "high", "data/quests.json nameJp")
        if q.get("categoryJp") and q.get("category"):
            pool.add_ja(q["categoryJp"], q["category"], "quest category", "high", "data/quests.json categoryJp")
    monster_names = {m["name"] for m in monsters}
    firsts = Counter()
    for q in quests:
        words = (q.get("name") or "").split()
        for n in range(1, len(words)):
            if " ".join(words[n:n + 3]) in monster_names or " ".join(words[n:n + 2]) in monster_names \
                    or words[n] in monster_names:
                firsts[words[n - 1]] += 1
    pool.forms = {w for w, n in firsts.items() if n >= 3 and w[:1].isupper() and w.lower() not in SMALL}
    for map_id, entry in read_json("data/map-ids.json", root).items():
        base = entry.get("base") or entry["name"]
        pool.add(base, "place")
        if entry.get("ja"):
            pool.add_ja(entry["ja"], base, "place", "high", f"data/map-ids.json {map_id}")
    for c in read_json("data/currencies.json", root)["currencies"]:
        pool.add(c["name"], "currency")
    pool.terms = load_terms(root)
    for row in pool.terms:
        en, kind = row.get("english", "").strip(), row.get("kind", "").strip() or "menu"
        conf = row.get("confidence", "").strip() or "low"
        if en:
            pool.add(en, kind)
            if row.get("japanese"):
                pool.add_ja(row["japanese"], en, kind, conf, "dev/guide-terms.tsv")
        for alias in filter(None, (a.strip() for a in row.get("guide_names", "").split("|"))):
            if re.search("[" + CJK + "]", alias):
                if en:
                    pool.add_ja(alias, en, kind, conf, "dev/guide-terms.tsv guide_names")
                continue
            if " > " in alias or "&gt;" in alias:
                *before, last = re.split(r"\s*(?:>|&gt;)\s*", alias)
                if en and last != en and key(en) not in {key(b) for b in before}:   # not a row about the parent
                    pool.path_alias[key(last)] = (en, kind, conf, row.get("note", "").strip() or "dev/guide-terms.tsv")
                continue
            if alias == en:
                continue
            old = pool.alias.get(key(alias))
            if old is None or {"high": 0, "medium": 1, "low": 2}[conf] < {"high": 0, "medium": 1, "low": 2}[old[2]]:
                pool.alias[key(alias)] = (en, kind, conf, row.get("note", "").strip() or "dev/guide-terms.tsv")
    ja_items = root / JA_ITEMS
    if ja_items.exists():
        conf_name = {"h": "high", "m": "medium", "l": "low"}
        for i, (ja, conf) in json.loads(ja_items.read_text(encoding="utf-8"))["names"].items():
            name = items.get(i)
            if name and not re.search("dummy", name, re.I):
                kind = "decoration" if "decoration" in pool.exact.get(name, ()) else "item"
                pool.add_ja(ja, name, kind, conf_name[conf], f"{JA_ITEMS} item {i}")
    else:
        pool.notes.append(f"{JA_ITEMS} missing: Chinese item names not mapped (run --ja-from-dat)")
    load_monster_ja(pool, root, monsters)
    tsv = re_dir / "data/translations/shipped/mhfdat.tsv" if re_dir else None
    if tsv and tsv.exists():
        for line in tsv.read_text(encoding="utf-8").splitlines():
            cells = line.split("\t")
            if len(cells) >= 5 and cells[2] in ("armour-name", "weapon-name", "name"):
                kind = {"armour-name": "armour", "weapon-name": "weapon"}.get(cells[2], "item")
                en = cells[4].strip()
                if pool.exact.get(en):
                    kind = pool.kind_of(en)
                pool.add_ja(cells[3], en, kind, "high", f"hvmhfz_re shipped/mhfdat.tsv {cells[0]}")
                s = armour_set(en)
                ja_set = re.sub(r"(ヘルム|キャップ|メイル|ベスト|アーム|ガード|フォールド|コイル|グリーヴ|レギンス|ヘッド|"
                                r"ハット|フェイク|メット)[^・]*$", "", cells[3])
                if kind == "armour" and s and ja_set != cells[3] and len(ja_set) > 1:
                    pool.add_ja(ja_set, s, "armour set", "medium", f"hvmhfz_re shipped/mhfdat.tsv {cells[0]} (set)")
    else:
        pool.notes.append(f"{tsv}: not found, armour and weapon Japanese names not used")
    pool.finish()
    return pool


def load_monster_ja(pool, root, monsters):
    names = {m["slug"]: m["name"] for m in monsters}

    def module(rel):
        spec = importlib.util.spec_from_file_location(rel.replace("-", "_").replace("/", "_"), root / rel)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    try:
        mqm = module("dev/make-quest-monsters.py")
        fix = module("dev/fix-quest-monster-names.py")
    except Exception as exc:  # the checker still runs without them
        pool.notes.append(f"monster Japanese names not loaded: {exc}")
        return
    jp = dict(getattr(mqm, "JP", {}))
    jp.update(getattr(fix, "JP_EXTRA", {}))
    for ja, slug in list(jp.items()) + list(getattr(fix, "EPITHETS", {}).items()):
        slug = slug[0] if isinstance(slug, list) else slug
        if slug in names:
            pool.add_ja(ja, names[slug], "monster", "high", "dev/make-quest-monsters.py / fix-quest-monster-names.py")
    for ja, en in getattr(mqm, "NO_PAGE", {}).items():
        pool.add_ja(ja, en, "monster", "high", "dev/make-quest-monsters.py NO_PAGE")


# ---------------------------------------------------------------------------------------------- matching

def best_matches(pool, text, n=3):
    k = key(text)
    words = [w for w in re.findall(r"[a-z0-9']+", k) if len(w) > 1 and w not in SMALL]
    score = Counter()
    for w in words:
        for cand in (w, w.rstrip("s"), w + "s"):
            if cand in pool.tokens and pool.df[cand] < 3000:
                for name in pool.tokens[cand]:
                    score[name] += 1.0 / math.log(2 + pool.df[cand])
    out = []
    for name, _ in score.most_common(300):
        r = difflib.SequenceMatcher(None, k, key(name)).ratio()
        out.append((r, name))
    out.sort(key=lambda x: (-x[0], len(x[1])))
    return out[:n]


def conf_of(ratio):
    return "high" if ratio >= 0.93 else "medium" if ratio >= 0.85 else "low"


def classify(pool, text, source="bold"):
    """(status, kind, our name, confidence, note) for one name, or None when it is not a name we check."""
    text = QTY_RE.sub("", text.strip()).strip(" .,;!?")
    if not text:
        return None
    if source == "cjk":
        return classify_cjk(pool, text)
    if text in pool.exact:
        return ("matched", pool.kind_of(text), text, "high", "")
    if key(text) in pool.alias:
        en, kind, conf, note = pool.alias[key(text)]
        return ("mismatched", kind, en, conf, "the guide's name; " + note) if en else \
            ("unknown", kind, "", conf, "the guide's name; no name in our client: " + note)
    same = pool.by_key.get(key(text))
    if same:
        name = sorted(same)[0]
        if unicodedata.normalize("NFKC", name) == unicodedata.normalize("NFKC", text):
            return ("matched", pool.kind_of(name), name, "high", "the game writes full-width letters")
        return ("mismatched", pool.kind_of(name), name, "high", "capitals, spaces or punctuation differ")
    for cut in ("es", "s"):
        if text.endswith(cut) and text[:-len(cut)] in pool.exact:
            return ("matched", pool.kind_of(text[:-len(cut)]), text[:-len(cut)], "high", "plural")
    points = re.match(r"^(.*?)\s*([+-]\d+)$", text)
    if points and points.group(1) in pool.exact and pool.kind_of(points.group(1)) == "skill":
        return ("matched", "skill", points.group(1), "high", f"a skill tree with points ({points.group(2)})")
    if points and points.group(1):     # "Exploit Weakness +2": check the skill name without its points
        c = classify(pool, points.group(1), source)
        if c and c[0] != "matched":
            return c[:4] + (c[4] + f" (written with {points.group(2)})",)
        if c:
            return c
    if GENERIC.match(text):
        return None
    order = pool.by_words.get(" ".join(sorted(key(text).split())))
    if order and len(text.split()) > 1:
        name = sorted(order)[0]
        return ("mismatched", pool.kind_of(name), name, "high", "the same words in another order")
    words = text.split()
    if len(words) > 1 and words[0] in pool.forms and " ".join(words[1:]) in pool.exact \
            and pool.kind_of(" ".join(words[1:])) == "monster":
        return ("matched", "monster", text, "medium", f"form + monster ({words[0]})")
    if not name_like(text):
        return None
    best = best_matches(pool, text)
    weak = source in ("cell", "list", "quote", "path")
    if best and best[0][0] >= (0.9 if len(words) == 1 else 0.85):
        r, name = best[0]
        mine, ours = set(key(text).split()), set(key(name).split())
        if mine < ours or ours < mine:    # a word more or less: another thing as often as the same one
            return ("unknown", pool.kind_of(name), name, "low",
                    f"our name has {'more' if mine < ours else 'fewer'} words ({r:.2f}): check it is the same thing")
        a, b = sorted(mine - ours), sorted(ours - mine)
        if len(a) == len(b) == 1 and re.sub(r"[+-]\d+$", "", a[0]) == re.sub(r"[+-]\d+$", "", b[0]):
            return ("unknown", pool.kind_of(name), name, "low", f"ours names a level ({name}): check which one")
        short = len(a) == len(b) == 1 and min(len(a[0]), len(b[0])) >= 3 and (
            b[0].startswith(a[0].rstrip(".")) or a[0].startswith(b[0].rstrip(".")))     # Crit / Critical
        if len(a) == len(b) == 1 and not short and difflib.SequenceMatcher(None, a[0], b[0]).ratio() < 0.8:
            return ("unknown", pool.kind_of(name), name, "low", f"one word differs ({a[0]} / {b[0]}, {r:.2f}): "
                    "check it is the same thing")
        others = "; also " + ", ".join(n for _, n in best[1:] if _ >= 0.8) if any(x >= 0.8 for x, _ in best[1:]) else ""
        return ("mismatched", pool.kind_of(name), name, conf_of(r), f"close match {r:.2f}{others}")
    if best and best[0][0] >= (0.75 if weak else 0.6):
        guesses = ", ".join(f"{n} ({r:.2f})" for r, n in best if r >= 0.6)
        kind = pool.kind_of(best[0][1]) if best[0][0] >= 0.8 else "name?"
        return ("unknown", kind, best[0][1], "low", "nearest: " + guesses)
    if weak:
        return None    # table text, list leads and quotes with nothing near are mostly not names
    return ("unknown", "name?", "", "low", "no match in our data")


def classify_cjk(pool, text):
    k = ja_key(text)
    if k in pool.ja:
        en, kind, conf, src = pool.ja[k]
        return ("mismatched", kind, en, conf, f"Chinese/Japanese name; our English from {src}")
    cands = set()
    for c in set(k):
        cands |= pool.ja_index.get(c, set())
    best = sorted(((difflib.SequenceMatcher(None, k, c).ratio(), c) for c in cands), key=lambda x: (-x[0], len(x[1])))
    inside = sorted((c for c in cands if len(k) >= 3 and c.endswith(k) and len(c) <= len(k) + 4), key=len)
    if inside:     # Ｇ級·閃耐珠 is the Japanese G級・閃耐珠: the guide often leaves out the rank prefix
        en, kind, conf, src = pool.ja[inside[0]]
        more = f" (also {len(inside) - 1} more)" if len(inside) > 1 else ""
        return ("mismatched", kind, en, "medium" if conf == "high" and len(inside) == 1 else "low",
                f"Chinese/Japanese name, the end of {inside[0]}{more}; our English from {src}")
    if best and best[0][0] >= (0.8 if len(k) < 5 else 0.7) and len(k) >= 3:
        r, c = best[0]
        en, kind, conf, src = pool.ja[c]
        return ("mismatched", kind, en, "medium" if conf == "high" and r >= 0.85 else "low",
                f"Chinese/Japanese name, close to {c} ({r:.2f}); our English from {src}")
    guess = "; nearest " + ", ".join(f"{c} = {pool.ja[c][0]} ({r:.2f})" for r, c in best[:2] if r >= 0.5) if best else ""
    return ("unknown", "cjk", "", "low", "Chinese/Japanese text with no name of ours" + guess)


MENU_KINDS = {"tab", "menu", "npc", "counter", "option", "quest category", "system", "weapon type", "place", "currency"}


def classify_part(pool, part):
    """One part of a menu path: the menu names first, then our other names."""
    if key(part) in pool.path_alias and part not in pool.exact:
        en, kind, conf, note = pool.path_alias[key(part)]
        return ("mismatched", kind, en, conf, note)
    c = classify(pool, part, "path-part")
    if c and c[0] != "matched" and c[1] not in MENU_KINDS:
        menu = [(r, n) for r, n in best_matches(pool, part, 40) if pool.kind_of(n) in MENU_KINDS and r >= 0.75]
        if menu:
            r, n = menu[0]
            return ("mismatched" if r >= 0.85 else "unknown", pool.kind_of(n), n, conf_of(r), f"nearest menu name {r:.2f}")
        return ("unknown", "menu?", "", "low", "not a menu name of ours")
    return c


def classify_path(pool, parts):
    out, worst, notes = [], "matched", []
    rank = {"matched": 0, "allowed": 0, "mismatched": 1, "unknown": 2}
    conf = "high"
    for part in parts:
        c = classify_part(pool, part) or ("unknown", "menu?", "", "low", "")
        if c[0] == "matched":
            out.append(c[2])
        elif c[2]:
            out.append(c[2])
            notes.append(f"{part} -> {c[2]} ({c[3]})")
        else:
            out.append("?")
            notes.append(f"{part}: not a menu name of ours")
        if rank[c[0]] > rank[worst]:
            worst = c[0]
        if c[0] != "matched" and {"high": 0, "medium": 1, "low": 2}[c[3]] > {"high": 0, "medium": 1, "low": 2}[conf]:
            conf = c[3]
    return worst, "path", " > ".join(out), conf if worst != "matched" else "high", "; ".join(notes)


# ---------------------------------------------------------------------------------------------- the pages

BLOCKS = {"p", "li", "td", "th", "dd", "dt", "figcaption", "h2", "h3", "h4", "caption", "summary"}
TRACK = BLOCKS | {"strong", "b"}
VOID = {"br", "img", "wbr", "hr", "input", "meta", "link", "source", "col", "area", "base", "embed", "track"}


class Page(html.parser.HTMLParser):
    """Collects (tag, class, text, line) of the elements in <main>, outside the side lists."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.out, self.main, self.skip = [], [], 0, 0

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        a = dict(attrs)
        cls = a.get("class") or ""
        skip = tag in ("nav", "script", "style", "header", "footer") or "hb-side" in cls
        self.stack.append([tag, cls, self.getpos()[0], [], skip])
        if tag == "main":
            self.main += 1
        if skip:
            self.skip += 1

    def handle_endtag(self, tag):
        if not any(e[0] == tag for e in self.stack):
            return
        while self.stack:
            t, cls, line, parts, skip = self.stack.pop()
            text = "".join(parts)
            if self.stack:
                self.stack[-1][3].append(text)
            if t == "main":
                self.main -= 1
            if skip:
                self.skip -= 1
            elif self.main and not self.skip and t in TRACK:
                self.out.append((t, cls, text, line))
            if t == tag:
                break

    def handle_data(self, data):
        if self.stack:
            self.stack[-1][3].append(data)


def line_at(text, start, index):
    return start + text.count("\n", 0, index)


def path_parts(text):
    """Menu paths "Quest Counter > Hunter Quests > Urgent Quests" in a block of text: (index, found, parts)."""
    out = []
    for sentence in re.finditer(r"[^.;!?\n]*\s>\s[^.;!?\n]*", text):
        s = sentence.group()
        pieces = re.split(r"\s+>\s+", s)
        if len(pieces) < 2:
            continue
        lead = re.search(r"((?:(?:[A-Z★0-9][\w'’&/★.-]*|of|the|and|for|in)\s+)*[A-Z★0-9][\w'’&/★.-]*)\s*$", pieces[0])
        tail = re.match(r"\s*((?:[A-Z★0-9][\w'’&/★.-]*)(?:\s+(?:[A-Z★0-9][\w'’&/★.-]*|of|the|and|for|in)(?=\s+[A-Z★0-9]|$))*"
                        r"(?:\s+[A-Z★0-9][\w'’&/★.-]*)*)", pieces[-1])
        if not lead or not tail:
            continue
        parts = [lead.group(1).strip()] + [p.strip() for p in pieces[1:-1]] + [tail.group(1).strip()]
        parts = [re.sub(r"^(?:the|a|in|on|at|from|then|open|use|pick|choose|select|go to)\s+", "", p, flags=re.I)
                 for p in parts]
        if any(re.search(r"[,()]|^\d+$|[" + CJK + "]", p) for p in parts):
            continue     # "Great Sword 1 > 8 > 17" (levels), "GS > SnS, Lance" (orders), Chinese menu text
        if all(parts) and all(len(p) <= 50 for p in parts):
            found = " > ".join(parts)
            out.append((sentence.start() + s.find(parts[0]), found, parts))
    return out


def candidates(page_html):
    """(line, found text, source, context) for every name the page shows."""
    parser = Page()
    parser.feed(page_html)
    seen, out = set(), []

    def emit(line, found, source, context=""):
        found = re.sub(r"\s+", " ", found).strip()
        if found and (line, found, source) not in seen:
            seen.add((line, found, source))
            out.append((line, found, source, context))

    for tag, cls, text, line in parser.out:
        flat = re.sub(r"\s+", " ", text).strip()
        if tag in ("strong", "b"):
            if "hv-verdict" not in cls and not re.search("[" + CJK + "]", flat) and " > " not in flat:
                emit(line, flat, "bold")
            continue
        if tag == "li":
            lead = NAME_SPLIT.split(flat, 1)[0]
            if lead != flat or len(flat) <= 60:
                emit(line, lead, "list")
        if tag == "td" and flat and len(flat) <= 90:
            for part in re.split(r",\s+|\s+/\s+|\s+or\s+", NAME_SPLIT.split(flat, 1)[0]):
                emit(line, part, "cell")
        if tag not in BLOCKS:
            continue
        for m in QUOTE_RE.finditer(text):
            if not re.search("[" + CJK + "]", m.group(1)):
                emit(line_at(text, line, m.start()), m.group(1), "quote")
        for index, found, parts in path_parts(text):
            emit(line_at(text, line, index), found, "path", parts)
        for m in CJK_RUN.finditer(text):
            emit(line_at(text, line, m.start()), m.group(), "cjk")
        for m in NOTE_RE.finditer(text):
            a = max(text.rfind(".", 0, m.start()) + 1, m.start() - 90)
            b = text.find(".", m.end())
            b = len(text) if b < 0 or b - m.end() > 90 else b
            emit(line_at(text, line, m.start()), text[a:b].strip(), "note", m.group())
    return out


def load_allow(root=ROOT):
    path = root / ALLOW
    allow = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.startswith("#"):
                cells = line.split("\t")
                if len(cells) >= 2 and cells[0] != "page":
                    allow[(cells[0].strip(), cells[1].strip())] = cells[2].strip() if len(cells) > 2 else ""
    return allow


def check_page(pool, name, page_html, allow):
    rows = []
    for line, found, source, context in candidates(page_html):
        why = allow.get((name, found), allow.get(("*", found)))
        if why is not None:
            rows.append((name, line, found, source, "allowed", "", "", "high", why))
            continue
        if source == "path":
            c = classify_path(pool, context)
        elif source == "note":
            c = ("unknown", "note", "", "low", f"keeps the original guide's own name ({context}): use our name, "
                 "or allowlist it when it is quoted as history")
        else:
            c = classify(pool, found, source)
        if c is None:
            continue
        status, kind, ours, conf, note = c
        rows.append((name, line, found, source, status, kind, ours, conf, note))
    return rows


# ---------------------------------------------------------------------------------------------- reporting

def report(rows, pool, top=25):
    by = defaultdict(Counter)
    for r in rows:
        kind = r[5] or r[3]
        by[kind][r[4]] += 1
    print("names by kind (matched / mismatched / unknown / allowed):")
    for kind in sorted(by, key=lambda k: -sum(by[k].values())):
        c = by[kind]
        print(f"  {kind:<16} {c['matched']:>5} {c['mismatched']:>5} {c['unknown']:>5} {c['allowed']:>5}")
    total = Counter(r[4] for r in rows)
    print(f"total: {total['matched']} matched, {total['mismatched']} mismatched, {total['unknown']} unknown, "
          f"{total['allowed']} allowed, over {len({r[0] for r in rows})} pages")
    src = defaultdict(Counter)
    for r in rows:
        src[r[3]][r[4]] += 1
    print("by where found: " + ", ".join(f"{s} {c['matched']}/{c['mismatched']}/{c['unknown']}" for s, c in
                                          sorted(src.items())))
    spacing = [r for r in rows if r[4] == "mismatched" and r[8].startswith("capitals, spaces")]
    print(f"of the mismatches, {len(spacing)} differ only in capitals, spaces or punctuation (e.g. Issen +2 / Issen+2)")
    miss = Counter((r[2], r[6], r[5], r[7]) for r in rows if r[4] == "mismatched" and r not in spacing)
    if miss:
        print(f"top mismatches (guide name -> ours, kind, confidence, times):")
        for (found, ours, kind, conf), n in sorted(miss.items(), key=lambda x: (-x[1], x[0][3] != "high"))[:top]:
            print(f"  {found} -> {ours} [{kind}, {conf}] x{n}")
    for note in pool.notes:
        print("note: " + note)


def write_findings(rows, path, include_matched=False):
    keep = [r for r in rows if include_matched or r[4] in ("mismatched", "unknown")]
    order = {"mismatched": 0, "unknown": 1, "allowed": 2, "matched": 3}
    keep.sort(key=lambda r: (r[0], r[1], order[r[4]], r[2]))
    with open(path, "w", encoding="utf-8") as out:
        out.write("# The Frontier guide's names that differ from ours: written by dev/check-guide-names.py --write;\n"
                  "# the worklist for the rewrite pass. status: mismatched (use our_name) or unknown (decide);\n"
                  "# source: where the name was found (bold, list, cell, quote, path, cjk, note).\n")
        out.write("page\tline\tfound\tsource\tstatus\tkind\tour_name\tconfidence\tnote\n")
        for r in keep:
            out.write("\t".join(str(c).replace("\t", " ").replace("\n", " ") for c in r) + "\n")
    print(f"{path}: {len(keep)} rows")


def run(args):
    pool = load_pool(ROOT, pathlib.Path(args.re) if args.re else None)
    allow = load_allow()
    rows = []
    pages = sorted(ROOT.glob("guide-frontier-*.html"))
    for page in pages:
        rows += check_page(pool, page.name, page.read_text(encoding="utf-8"), allow)
    report(rows, pool)
    if args.write:
        write_findings(rows, ROOT / FINDINGS, args.all)
    bad = sum(1 for r in rows if r[4] in ("mismatched", "unknown"))
    if args.strict and bad:
        print(f"{bad} name(s) differ from ours (--strict)")
        return 1
    return 0


# ---------------------------------------------------------------------------------------------- --ja-from-dat

def ja_from_dat(dat_path, root=ROOT):
    """Writes dev/item-names-ja.json: the client's Japanese item names by id (see the module comment)."""
    data = open(dat_path, "rb").read()
    names = read_json("data/item-ids.json", root)
    table = struct.unpack_from("<I", data, 0x100)[0]
    anchor = b"\0" + "調合書①入門編".encode("cp932") + b"\0"   # item 1, the first of the run
    last = b"\0" + "秘伝宝玉・剣聖".encode("cp932") + b"\0"     # item 16405
    lo = data.find(anchor) + 1
    end = data.find(last) + 1
    if lo <= 0 or end <= 0:
        sys.exit("the Japanese item names are not in this file: is it the client patch's decompressed mhfdat.bin?")
    strs, o = [], lo
    top = max(int(i) for i in names)
    while len(strs) < top + 50:
        e = data.index(b"\0", o)
        strs.append((o, data[o:e].decode("cp932", "replace")))
        o = e + 1
        while data[o] == 0:
            o += 1
    at = {o: k for k, (o, _) in enumerate(strs)}
    anch = {}
    for i in range(1, top + 1):
        p = struct.unpack_from("<I", data, table + 4 * i)[0]
        if p in at:
            anch[i] = at[p]
    by_text = defaultdict(list)
    for k, (_, s) in enumerate(strs):
        by_text[s].append(k)

    def food(x):
        if isinstance(x, dict):
            if isinstance(x.get("id"), int) and x.get("ja"):
                yield x["id"], x["ja"]
            for v in x.values():
                yield from food(v)
        elif isinstance(x, list):
            for v in x:
                yield from food(v)

    for i, ja in food(read_json("data/food-recipes.json", root)):
        if len(by_text.get(ja, [])) == 1:
            anch.setdefault(i, by_text[ja][0])
    anch[1], anch[16405] = at[lo], at[end]
    ids = sorted(anch)
    ids = [i for n, i in enumerate(ids) if n == 0 or anch[i] > anch[ids[n - 1]]]
    out, pairs = {}, []
    for a, b in zip(ids, ids[1:]):
        if b - a == anch[b] - anch[a]:
            for j in range(b - a):
                out[a + j] = (strs[anch[a] + j][1], "h")
                pairs.append((a + j, strs[anch[a] + j][1]))
    for i in ids:
        out[i] = (strs[anch[i]][1], "h")
    score = _scorer(pairs, names, root)
    for a, b in zip(ids, ids[1:]):
        if b - a != anch[b] - anch[a]:
            got = _align(list(range(a + 1, b)), list(range(anch[a] + 1, anch[b])), strs, score)
            for i, (k, conf) in got.items():
                out[i] = (strs[k][1], conf)
    result = {str(i): [s.replace("\n", " "), c] for i, (s, c) in sorted(out.items())
              if s and "\n" not in s and str(i) in names}
    doc = {"_about": "dev/check-guide-names.py --ja-from-dat: the Japanese item names the client patch's mhfdat.bin "
                     "keeps in item order, by item id; h = certain (between two fixed points with as many names as ids), "
                     "m = placed by the alignment and agreeing with its neighbours, l = placed, less sure",
           "mhfdat_sha256": hashlib.sha256(data).hexdigest(), "names": result}
    (root / JA_ITEMS).write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    c = Counter(v[1] for v in result.values())
    print(f"{JA_ITEMS}: {len(result)} names ({c['h']} certain, {c['m']} medium, {c['l']} low); {len(anch)} fixed points")


def _scorer(pairs, names, root):
    """Learns from the certain pairs how the English name and icon go with the Japanese name's characters."""
    icons = {row[0]: row[2] for row in read_json("data/items/index.json", root)["items"]}

    def itype(i):
        m = re.match(r"item-(\d+)-", icons.get(i) or "")
        return m.group(1) if m else "?"

    def words(i):
        return {w for w in re.findall(r"[a-z]+", names.get(str(i), "").lower()) if len(w) > 1}

    def chars(s):
        return {c for c in unicodedata.normalize("NFKC", s) if ord(c) > 0x2FFF}

    def toks(s):
        return set(re.findall(r"[A-Za-z]+|\d+", unicodedata.normalize("NFKC", s).upper()))

    n = len(pairs)
    tl, t, l, wc, cc, co = Counter(), Counter(), Counter(), Counter(), Counter(), Counter()
    for i, s in pairs:
        last = unicodedata.normalize("NFKC", s)[-1:]
        tl[(itype(i), last)] += 1
        t[itype(i)] += 1
        l[last] += 1
        W, C = words(i), chars(s)
        wc.update(W)
        cc.update(C)
        co.update((w, c) for w in W for c in C)

    def pmi(w, c):
        k = co.get((w, c), 0)
        return max(0.0, math.log(k * n / (wc[w] * cc[c]))) if k >= 2 else 0.0

    def score(i, s):
        name = names.get(str(i), "")
        if re.search(r"dummy|^$", name, re.I):
            return -4.0
        last = unicodedata.normalize("NFKC", s)[-1:]
        sc = math.log(((tl[(itype(i), last)] + 0.1) / (l[last] + 6)) / ((t[itype(i)] + 1) / (n + 60)))
        W, C = words(i), chars(s)
        sc += 1.5 * sum(max([pmi(w, c) for c in C] or [0]) for w in W) / max(len(W), 1)
        a, b = toks(name), toks(s)
        if b:
            sc += 3 * len(a & b) - 1.5 * len(b - a)
        return sc
    return score


def _align(ids, ks, strs, score, band=260):
    """Monotone alignment of ids to strings (an id may have none: dummies share one); id -> (string index, conf)."""
    n, m = len(ids), len(ks)
    neg = -1e18
    D = [[neg] * (m + 1) for _ in range(n + 1)]
    B = [[0] * (m + 1) for _ in range(n + 1)]
    S = {}
    D[0][0] = 0.0
    for x in range(n + 1):
        mid = x * m // max(n, 1)
        for y in range(max(0, mid - band), min(m, mid + band) + 1):
            v = D[x][y]
            if v == neg:
                continue
            if x < n and y < m:
                s = score(ids[x], strs[ks[y]][1])
                S[(x, y)] = s
                if v + s > D[x + 1][y + 1]:
                    D[x + 1][y + 1], B[x + 1][y + 1] = v + s, 1
            if x < n and v - 0.5 > D[x + 1][y]:
                D[x + 1][y], B[x + 1][y] = v - 0.5, 2
            if y < m and v - 3.0 > D[x][y + 1]:
                D[x][y + 1], B[x][y + 1] = v - 3.0, 3
    x, y, path = n, m, []
    while x or y:
        b = B[x][y]
        if b == 1:
            path.append((x - 1, y - 1))
            x, y = x - 1, y - 1
        elif b == 2:
            x -= 1
        else:
            y -= 1
    path.reverse()
    out = {}
    for n, (px, py) in enumerate(path):
        before = path[n - 1][1] if n else -1        # the string matched before (an id between may have none)
        after = path[n + 1][1] if n + 1 < len(path) else m
        steady = before == py - 1 and after == py + 1
        out[ids[px]] = (ks[py], "m" if steady and S.get((px, py), 0) >= 1.0 else "l")
    return out


# ---------------------------------------------------------------------------------------------- self-test

def self_test():
    cases = []

    def expect(label, got, want):
        ok = got == want
        cases.append(ok)
        print(("ok   " if ok else "FAIL ") + label + ("" if ok else f": got {got!r}, want {want!r}"))

    pool = Pool()
    for name, kind in (("Basic Fencing Deco", "decoration"), ("Rathalos Scale", "item"), ("Mega Potion", "item"),
                       ("Rathalos", "monster"), ("Rukodiora", "monster"), ("G Deco Quests", "tab"),
                       ("Other Quests", "tab"), ("NPC Settings", "option"), ("Options", "menu"),
                       ("Guts Deco G and Abiorugu", "quest"), ("Deoderant 1 Deco", "decoration")):
        pool.add(name, kind)
    pool.forms = {"Gou"}
    pool.alias[key("NPC Options")] = ("NPC Settings", "option", "high", "dev/guide-terms.tsv")
    pool.alias[key("Purple Guildie")] = ("", "npc", "low", "no client name")
    pool.add_ja("剣技珠Ｇ", "Basic Fencing Deco", "decoration", "high", "test")
    pool.add_ja("火竜の鱗", "Rathalos Scale", "item", "medium", "test")
    pool.finish()
    expect("an exact name matches", classify(pool, "Rathalos Scale")[0], "matched")
    expect("a quantity is not part of the name", classify(pool, "15x Rathalos Scale")[0], "matched")
    expect("a plural matches", classify(pool, "Rathalos Scales")[:3], ("matched", "item", "Rathalos Scale"))
    expect("capitals differ", classify(pool, "Mega potion")[:3], ("mismatched", "item", "Mega Potion"))
    expect("a guide alias gives our name", classify(pool, "NPC Options")[:3], ("mismatched", "option", "NPC Settings"))
    expect("an alias without a client name is unknown", classify(pool, "Purple Guildie")[0], "unknown")
    expect("a near name is a mismatch", classify(pool, "Deodorant 1 Deco")[:3],
           ("mismatched", "decoration", "Deoderant 1 Deco"))
    pool.add("Weakness Exploit", "skill")
    expect("words in another order", classify(pool, "Exploit Weakness +2")[:3], ("mismatched", "skill", "Weakness Exploit"))
    expect("colours and percentages are not names", (classify(pool, "Dark Blue."), classify(pool, "67% health")),
           (None, None))
    expect("a form word before a monster", classify(pool, "Gou Rukodiora")[0], "matched")
    expect("lower-case prose is not a name", classify(pool, "basic weapons"), None)
    expect("a rank is not a name", classify(pool, "GR 300"), None)
    expect("Traditional Chinese maps to the Japanese name", classify(pool, "劍技珠G", "cjk")[:3],
           ("mismatched", "decoration", "Basic Fencing Deco"))
    expect("的 reads as の and 龍 as 竜", classify(pool, "火龍的鱗", "cjk")[2], "Rathalos Scale")
    expect("unknown Chinese stays unknown", classify(pool, "這裡", "cjk")[0], "unknown")
    expect("a menu path", path_parts("Pick Other Quests > G Deco Quests in the list."),
           [(5, "Other Quests > G Deco Quests", ["Other Quests", "G Deco Quests"])])
    expect("a path part that is a guide alias", classify_path(pool, ["Options", "NPC Options"])[:3],
           ("mismatched", "path", "Options > NPC Settings"))
    page = ("<main><aside class=\"hb-side\"><strong>Side Only</strong></aside><ul><li><strong>5x</strong> raw gem "
            "(Chinese name 海棠原珠) from \"Guts Deco G and Abiorugu\" in <strong>Other Quests &gt; G Deco Quests"
            "</strong></li></ul><p><strong class=\"hv-verdict\">Different.</strong> Mega potion</p></main>")
    found = {(c[1], c[2]) for c in candidates(page)}
    expect("the side list and verdicts are left out", any(f == "Side Only" or f == "Different." for f, _ in found), False)
    expect("quotes, paths, CJK and notes are found",
           {("Guts Deco G and Abiorugu", "quote"), ("Other Quests > G Deco Quests", "path"), ("海棠原珠", "cjk")}
           <= found and any(s == "note" for _, s in found), True)
    rows = check_page(pool, "p.html", page, {("*", "Guts Deco G and Abiorugu"): "test"})
    expect("an allowlisted name is allowed", [r[4] for r in rows if r[2] == "Guts Deco G and Abiorugu"], ["allowed"])
    ids, ks = list(range(10, 16)), list(range(5))
    strs = [(0, s) for s in ("毒袋", "麻痺袋", "睡眠袋", "火炎袋", "電気袋")]
    eng = {10: "Poison Sac", 11: "Paralysis Sac", 12: "(dummy)", 13: "Sleep Sac", 14: "Flame Sac", 15: "Electro Sac"}
    sc = lambda i, s: -4.0 if "dummy" in eng[i] else 2.0
    expect("the alignment skips a dummy item", {i: k for i, (k, _) in _align(ids, ks, strs, sc).items()},
           {10: 0, 11: 1, 13: 2, 14: 3, 15: 4})
    print(f"{sum(cases)} of {len(cases)} cases pass")
    return 0 if all(cases) else 1


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--write", action="store_true", help=f"write {FINDINGS}")
    p.add_argument("--all", action="store_true", help="the findings file also lists matched and allowed names")
    p.add_argument("--strict", action="store_true", help="exit 1 while any name is mismatched or unknown")
    p.add_argument("--re", default=str(RE_DEFAULT) if RE_DEFAULT.exists() else "", help="hvmhfz_re checkout")
    p.add_argument("--ja-from-dat", metavar="MHFDAT", help=f"rebuild {JA_ITEMS} from a decompressed mhfdat.bin")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args()
    if args.self_test:
        return self_test()
    if args.ja_from_dat:
        ja_from_dat(args.ja_from_dat)
        return 0
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
