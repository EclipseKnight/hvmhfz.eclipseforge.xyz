#!/usr/bin/env python3
"""Writes the "monsters" list of every quest in data/quests.json from the quest's Japanese objective.

The catalog's first monster lists came from the English objective, which drops the subspecies (リオレウス希少種,
Silver Rathalos, came out as "Azure Rathalos"; ゲリョス亜種 as "Gypceros"), used other spellings than the
field guide ("Kuarlusepusu", "Espinas Rare Species") and had a few plain errors ("Dahren Mohran" on
Harudomerugu quests, "Gargwa" on Anteka quests). 1,566 quests listed no monster at all although their
objective names one. The Japanese objective (objectiveJp, from the quest file) names the monster exactly,
so this script reads that and writes the field guide's names (data/monsters/index.json), which the quest
pages link to.

How a quest's list is made:
- every name of JP below found in objectiveJp, longest names first (so リオレウス希少種 wins over リオレウス),
  in the order they appear;
- names mapped to None are not monsters with a guide page (fish, bugs, "？？？", "大型モンスター") and are
  skipped; NO_PAGE names monsters of the game the guide has no page for yet, listed by name;
- when the objective names no monster (a delivery, a missing objective), the old list stays, with any
  name the guide does not use replaced by the guide's (OLD_NAMES).

Run it after data/quests.json is rebuilt:  python3 dev/make-quest-monsters.py
(--check: change nothing, exit 1 when data/quests.json is not what it would write)
Check:  node dev/check-catalog-monsters.js  (every catalog monster has a page, and this script has run)
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
QUESTS = ROOT / "data" / "quests.json"
INDEX = ROOT / "data" / "monsters" / "index.json"

# Japanese name in quest objectives -> field guide slug(s) (data/monsters/index.json), or None for no page.
# 変種 is the Henshu form of the same monster; 亜種 the subspecies, 希少種 the rare species.
JP = {
    "アイルー": "felyne", "アカムトルム": "akantor", "アクラ・ヴァシム": "akura-vashimu",
    "アクラ・ジェビア": "akura-jebia", "アノルパティス": "anorupatisu", "アビオルグ": "abiorugu",
    "アプケロス": "apceros", "アプトノス": "aptonoth", "アマツマガツチ": "amatsu",
    "イーオス": "genprey", "イナガミ": "inagami", "イビルジョー": "deviljho",
    "イャンガルルガ": "yian-garuga", "ガルルガ変種": "yian-garuga",
    "イャンクック": "yian-kut-ku", "イャンクック亜種": "blue-yian-kut-ku",
    "ウラガンキン": "uragaan", "エスピナス": "espinas", "エスピナス亜種": "orange-espinas",
    "エスピナス希少種": "white-espinas", "エルゼリオン": "elzelion", "オオナズチ": "chameleos",
    "オディバトラス": "odibatorasu", "カム・オルガロン": "kamu-orugaron", "ノノ・オルガロン": "nono-orugaron",
    "ガウシカ": "anteka", "ガスラバズラ": "gasurabazura", "ガノトトス": "plesioth",
    "ガノトトス亜種": "green-plesioth", "ガブラス": "remobra", "ガルバダオラ": "garuba-daora",
    "ガレオス": "cephalos", "カンタロス": "hornetaur", "ギアオルグ": "giaorugu", "ギアノス": "giaprey",
    "キリン": "kirin", "キングチャチャブー": "king-shakalaka", "クアルセプス": "kuarusepusu",
    "クシャルダオラ": "kushala-daora", "グァンゾルム": "guanzorumu", "グラビモス": "gravios",
    "グラビモス亜種": "black-gravios", "グレアドモス": "gureadomosu", "グレンゼブル": "gurenzeburu",
    "ケオアルボル": "keoaruboru", "ケルビ": "kelbi", "ゲネポス": "ioprey", "ゲリョス": "gypceros",
    "ゲリョス亜種": "purple-gypceros", "ゴア・マガラ": "gore-magala", "ゴウガルフ": ["lolo-gougarf", "ray-gougarf"],
    "ゴゴモア": "gogomoa", "ゴルガノス": "goruganosu", "コンガ": "conga", "シェンガオレン": "shen-gaoren",
    "ジンオウガ": "zinogre", "ジンオウガ亜種": "stygian-zinogre", "シャンティエン": "shantien",
    "ショウグンギザミ": "shogun-ceanataur", "セルレギオス": "seregios", "ゼナセリス": "zenaserisu",
    "ゼルレウス": "zerureusu", "ダイミョウザザミ": "daimyo-hermitaur", "タイクンザムザ": "taikun-zamuza",
    "チャチャブー": "shakalaka", "ディアブロス": "diablos", "ディアブロス亜種": "black-diablos",
    "ディオレックス": "diorex", "ディスフィロア": "disufiroa", "ティガレックス": "tigrex",
    "テオ・テスカトル": "teostra", "デュラガウア": "dyuragaua", "トア・テスカトラ": "toa-tesukatora",
    "ドスイーオス": "gendrome", "ドスガレオス": "cephadrome", "ドスゲネポス": "iodrome",
    "ドスファンゴ": "bulldrome", "ドスランポス": "velocidrome", "ドドブランゴ": "blangonga",
    "ドラギュロス": "doragyurosu", "トリドクレス": "toridcless", "ナナ・テスカトリ": "lunastra",
    "ナルガクルガ": "nargacuga", "ババコンガ": "congalala", "ババコンガ変種": "congalala",
    "バサルモス": "basarios", "バサルモス変種": "basarios", "パリアプリア": "pariapuria",
    "バルラガル": "baruragaru", "ハルドメルグ": "harudomerugu", "ヒプノック": "hypnocatrice",
    "ヒプノック繁殖期": "breeding-season-hypnocatrice", "ヒプノック希少種": "silver-hypnocatrice",
    "ヒュジキキ": "hyujikiki", "ファルノック": "farunokku", "フォロクルル": "forokururu",
    "ブラキディオス": "brachydios", "ブランゴ": "blango", "ブルック": "burukku", "ブルファンゴ": "bullfango",
    "フルフル": "khezu", "フルフル亜種": "red-khezu", "ベリオロス": "barioth", "ベルキュロス": "berukyurosu",
    "ヴァルサブロス": "varusaburosu", "ヴォージャン": "voljang", "ヴォルガノス": "volganos",
    "ヴォルガノス亜種": "red-volganos", "ボガバドルム": "bogabadorumu", "ポカラ": "pokara",
    "ポカラドン": "pokaradon", "ポボルバルム": "poborubarumu", "ポポ": "popo", "ミドガロン": "midogaron",
    "ミラボレアス": "fatalis", "メラギナス": "meraginasu", "メラルー": "melynx", "モス": "mosswine",
    "モノブロス": "monoblos", "モノブロス亜種": "white-monoblos", "ヤオザミ": "ceanataur",
    "ヤマクライ": "yama-kurai", "ヤマツカミ": "yama-tsukami", "ラージャン": "rajang",
    "ラヴィエンテ": "raviente", "ラオシャンロン": "lao-shan-lung", "ラオシャンロン亜種": "ashen-lao-shan-lung",
    "ランゴスタ": "vespoid", "ランポス": "velociprey", "リオレイア": "rathian", "リオレイア亜種": "pink-rathian",
    "リオレイア希少種": "gold-rathian", "リオレウス": "rathalos", "リオレウス亜種": "azure-rathalos",
    "リオレウス希少種": "silver-rathalos", "リオレウス変種": "rathalos", "ルコディオラ": "rukodiora",
    "レビディオラ": "rebidiora", "大雷光虫": "great-thunderbug",
    # Not monsters with a guide page: hidden names, "all large monsters", fish, bugs, a baby Khezu delivery.
    "？？？？？？？": None, "？？？？？": None, "？？？": None, "大型モンスター": None, "フルフルベビー": None,
    "黄金魚": None, "サシミウオ": None, "カジキマグロ": None, "春夜鯉": None, "ハリマグロ": None,
    "イーモンサーモン": None, "イカリオオマグロ": None, "大食いマグロ": None, "カクサンデメキン": None,
    "ヒレナガウオ": None, "コシツウオ": None, "フレイムタイラント": None, "ロイヤルカブト": None,
    "キラビートル": None, "オオツノアゲハ": None, "釣りバッタ": None, "ドスヘラクレス": None,
}

# In the game, but the field guide has no page for them yet: listed under this name, without a link
# (dev/check-catalog-monsters.js lists them as known gaps).
NO_PAGE = {"シャガルマガラ": "Shagaru Magala"}

# Names in the old lists that the guide spells differently (used only when the objective names nothing).
OLD_NAMES = {"Kuarlusepusu": "Kuarusepusu", "Eruzerion": "Elzelion", "Lavasioth": "Volganos",
             "Espinas Subspecies": "Orange Espinas", "Espinas Rare Species": "White Espinas",
             "Hypnocatrice Rare": "Silver Hypnocatrice", "Dahren Mohran": "Harudomerugu", "Gargwa": "Anteka"}


def monsters_in(objective, names):
    """The names of the monsters an objective names, in order of appearance, and whether it named any
    name of the tables at all (a fish or "？？？" counts: the objective is about it, not about the old list)."""
    table = dict(JP)
    table.update({jp: {"name": name} for jp, name in NO_PAGE.items()})
    found = []  # (position, table value)
    text = objective
    for jp in sorted(table, key=len, reverse=True):
        start = text.find(jp)
        while start != -1:
            found.append((start, table[jp]))
            text = text[:start] + "\0" * len(jp) + text[start + len(jp):]  # keep positions, hide the match
            start = text.find(jp)
    out = []
    for _, value in sorted(found, key=lambda f: f[0]):
        if isinstance(value, dict):
            listed = [value["name"]]
        else:
            listed = [names[slug] for slug in ([value] if isinstance(value, str) else value or [])]
        for name in listed:
            if name not in out:
                out.append(name)
    return out, bool(found)


def build(quests, index):
    names = {m["slug"]: m["name"] for m in index}
    for slug in {s for v in JP.values() if v for s in ([v] if isinstance(v, str) else v)}:
        if slug not in names:
            raise SystemExit(f"make-quest-monsters: JP table names {slug!r}, not in data/monsters/index.json")
    for quest in quests:
        listed, named = monsters_in(quest.get("objectiveJp") or "", names)
        if not named:
            listed = []
            for name in quest.get("monsters") or []:
                name = OLD_NAMES.get(name, name)
                if name not in listed:
                    listed.append(name)
        quest["monsters"] = listed
    return quests


def main(args):
    data = json.loads(QUESTS.read_text(encoding="utf-8"))
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    before = [list(q.get("monsters") or []) for q in data["quests"]]
    build(data["quests"], index)
    changed = [q["id"] for b, q in zip(before, data["quests"]) if b != q["monsters"]]
    if "--check" in args:  # used by dev/check-catalog-monsters.js: is data/quests.json what this writes?
        if changed:
            print(f"data/quests.json: {len(changed)} monster lists differ from dev/make-quest-monsters.py "
                  f"(e.g. quests {', '.join(map(str, changed[:5]))}); run it")
            return 1
        return 0
    changed = len(changed)
    QUESTS.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"data/quests.json: {len(data['quests'])} quests, {changed} monster lists changed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
