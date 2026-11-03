#!/usr/bin/env python3
"""Compares the site's names with the Monster Hunter Fandom wiki's Frontier database (data/wiki-names.json,
a names-only snapshot of https://monsterhunter.fandom.com/wiki/Category:Frontier_Database, 2026-11-03).

  python3 dev/check-wiki-names.py              exit code 0 = every difference is known, 1 = problems
  python3 dev/check-wiki-names.py --self-test  runs the checks on made-up data

The wiki's names are its own translations. Where the English client (our patch) shows its own word, the site
keeps the game's, so every difference must be listed below with the reason; a listed difference that no longer
exists is a problem too, so the lists stay honest. Checked:

1. Monsters: every field guide entry (data/monsters/index.json) is on the wiki's "Frontier: Monsters" list or
   in DIFFERENT / OURS_ONLY; every wiki monster is one of ours, a Zenith form of an entry with the "Zenith"
   variant, or in DIFFERENT (as the wiki side) / WIKI_ONLY.
2. The same monster has the same name everywhere: data/monster-ids.json (the Quest builder) and the Road
   builder's names (js/road-rules.js MONSTER_NAMES with GUIDE_NAMES on top, also road-data.html) give each id
   that has one guide entry that entry's name, except SERVER_NAME_KEPT.
3. Icons: data/monster-icons.json (the builders) gives each such id its entry's icon, except ICON_KEPT; every
   wiki-style icon (iconKind "wiki") is in data/monster-icon-sources.json with the wiki file it comes from and
   our file's SHA-1, and the file still has that SHA-1 (a swapped icon is how 18 monsters showed the wrong
   picture before 2026-11-03).
4. Places: every place in data/map-ids.json (its "base", else its name before the copy's suffix) is a wiki
   location or in PLACE_DIFFERENT / PLACE_OURS_ONLY.
5. Weapon types: js/hunters.js WEAPON_NAMES are the wiki's 14 weapon types.

Items are not compared here: the wiki's item list is short and uses older names; data/item-ids.json takes
the game's own names (dev/make-builder-data.py --dat).
"""
import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Our name -> the wiki's name for the same monster, and why ours stays. "game" = the English client's text.
DIFFERENT = {
    "Volganos": ("Lavasioth", "game: monster list, drop text and items (Volganos Scale)"),
    "Red Volganos": ("Lavasioth Subspecies", "game: monster list and drop text"),
    "Orange Espinas": ("Espinas Subspecies", "game: drop text and quest objectives (the hunt-record list says Brown Espinas)"),
    "White Espinas": ("Espinas Rare Species", "game: monster list"),
    "Elzelion": ("Eruzerion", "game: monster list"),
    "Raviente": ("Laviente", "game: monster list and Great Slaying text"),
    "Berserk Raviente": ("Berserk Laviente", "game: drop text"),
    "Duremudira (1st)": ("Duremudira", "one page per Sky Corridor district (ids 132 and 145); game: Duremudira"),
    "Duremudira (2nd)": ("Duremudira", "one page per Sky Corridor district (ids 132 and 145); game: Duremudira (2nd Dist.)"),
    "Duremudira (Musou)": ("Arrogant Duremudira", "the site's Musou naming (game achievement: Arrogant Duremudira)"),
    "Musou Deviljho": ("Starving Deviljho", "the site's Musou naming (player report #26); no English name in the game"),
    "Musou Nargacuga": ("Blinking Nargacuga", "the site's Musou naming; no English name in the game"),
    "Musou Pariapuria": ("Thirsty Pariapuria", "the site's Musou naming; no English name in the game"),
    "Musou Zinogre": ("Howling Zinogre", "the site's Musou naming; no English name in the game"),
    "Musou Guanzorumu": ("Ruler Guanzorumu", "the site's Musou naming; no English name in the game"),
    "Musou Mi Ru": ("Mysterious Mi Ru", "the site's Musou naming; no English name in the game"),
    "Musou Elzelion": ("Burning Freezing Eruzerion", "the site's Musou naming; no English name in the game"),
}
# Our entries the wiki's list does not have.
OURS_ONLY = {
    "Musou Zerureusu": "Musou monster (id 174, Erupe: Sparkling Zerureusu); not on the wiki's list",
    "Musou Bogabadorumu": "Musou monster (id 172, Erupe: Bombardier Bogabadorumu); not on the wiki's list",
    "Kokomoa": "server id 102 (Gogomoa's child); not on the wiki's list",
    "Rappy": "server id 175 (collaboration monster); not on the wiki's list",
    "King Shakalaka": "server id 176; not on the wiki's list",
    "Cactus": "field guide entry without a monster id (gathering target)",
    "Rock": "field guide entry without a monster id",
    "Poison Light Bug": "field guide entry without a monster id",
}
# Wiki monsters without a page of their own here.
WIKI_ONLY = {
    "Savage Deviljho": "Erupe's name for id 155, which the guide shows as Musou Deviljho (the Ferias tables' Musou Deviljho)",
    "Violent Laviente": "a Raviente event form (game: Violent Raviente) with no monster id of its own",
}
# Monster ids whose builder names stay the server's: the guide has no single page for them.
SERVER_NAME_KEPT = {123: "Gougarf (the guide has Lolo and Ray Gougarf)", 173: "Costumed Uruki (the guide's Uruki page)"}
ICON_KEPT = {176: "King Shakalaka has no icon of its own; the builders show Shakalaka's"}
ICON_SOURCE_KEPT = {"yama-kurai.png": "the wiki has no Yama Kurai icon (a question mark there); source not recorded"}

# Our place name -> the wiki's, and why ours stays.
PLACE_DIFFERENT = {
    "Tidal Island": ("Tide Island", "game: location list"),
    "Battlefield": ("Battleground", "game: location list"),
    "Top of Great Forest": ("Great Forest Peak", "game: location list"),
    "Painted Falls": ("Painted Waterfalls", "game: location list"),
    "Highlands": ("Highland", "game: location list"),
    "Forest and Hills": ("Forest & Hills", "the game writes both; kept"),
    "Ancient Tower": ("Tower", "kept apart from the Sky Corridor's tower (game: Tower)"),
}
PLACE_OURS_ONLY = {
    "Arena with Moat": "a copy of the Arena", "Amatsu's arena": "a monster's own stage",
    "Guanzorumu's arena": "a monster's own stage", "Shagaru Magala's arena": "a monster's own stage",
    "Berserk Raviente": "the Berserk Raviente stages", "Caravan Blimp": "Caravan stage",
    "Dundorma Fort": "not on the wiki's list", "Hunter's Road": "the Hunting Road's stage",
    "Historical Site": "game: location list (Musou quests); not on the wiki's list",
    "Large Airship": "Shantien's stage; not matched to the game's or the wiki's list yet",
    "Unused stage": "no quest uses it", "Unused test stage": "no quest uses it",
}


def read(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def road_names(text):
    """js/road-rules.js: Erupe's MONSTER_NAMES with GUIDE_NAMES on top, as the Road builder shows them."""
    names = re.findall(r'"([^"]*)"', re.search(r"var MONSTER_NAMES = \[(.*?)\];", text, re.S).group(1))
    guide = re.search(r"var GUIDE_NAMES = \{(.*?)\};", text, re.S)
    for monster_id, name in re.findall(r'(\d+): "([^"]*)"', guide.group(1) if guide else ""):
        names[int(monster_id)] = name
    return names


def place_of(entry):
    return entry.get("base") or re.split(r" \(|, | \d+$| with ", entry["name"])[0]


def check_monsters(wiki, index, fail, different=DIFFERENT, ours_only=OURS_ONLY, wiki_only=WIKI_ONLY):
    wiki_set = set(wiki)
    ours = {e["name"]: e for e in index}
    for name in ours:
        if name in wiki_set:
            if name in different or name in ours_only:
                fail(f"monster {name!r} is the wiki's name now: take it out of DIFFERENT/OURS_ONLY")
        elif name in different:
            if different[name][0] not in wiki_set:
                fail(f"monster {name!r}: DIFFERENT says the wiki calls it {different[name][0]!r}, not on the wiki's list")
        elif name not in ours_only:
            fail(f"monster {name!r} (data/monsters/index.json) is not on the wiki's list: use the wiki's name, "
                 "or list it in DIFFERENT/OURS_ONLY with the reason")
    for name in list(different) + list(ours_only):
        if name not in ours:
            fail(f"monster {name!r} is listed in dev/check-wiki-names.py but has no guide entry")
    wiki_side = {w for w, _ in different.values()}
    for name in wiki:
        if name in ours or name in wiki_side or name in wiki_only:
            if name in wiki_only and (name in ours or name in wiki_side):
                fail(f"wiki monster {name!r} has a page now: take it out of WIKI_ONLY")
            continue
        base = name[len("Zenith "):] if name.startswith("Zenith ") else None
        if base and base in ours and "Zenith" in (ours[base].get("variants") or []):
            continue
        fail(f"wiki monster {name!r} has no guide entry: add one, or list it in WIKI_ONLY with the reason")
    for name in wiki_only:
        if name not in wiki_set:
            fail(f"WIKI_ONLY lists {name!r}, which is not on the wiki's list")


def single_entries(index):
    by_id = {}
    for e in index:
        for monster_id in e.get("ids") or []:
            by_id.setdefault(monster_id, []).append(e)
    return {i: es[0] for i, es in by_id.items() if len(es) == 1}


def check_ids(index, monster_ids, road, icons, fail):
    for monster_id, e in sorted(single_entries(index).items()):
        if monster_id in SERVER_NAME_KEPT:
            continue
        if str(monster_id) in monster_ids and monster_ids[str(monster_id)] != e["name"]:
            fail(f"data/monster-ids.json: id {monster_id} is {monster_ids[str(monster_id)]!r}, the guide says {e['name']!r}")
        if 0 < monster_id < len(road) and road[monster_id] != e["name"]:
            fail(f"js/road-rules.js: id {monster_id} shows as {road[monster_id]!r}, the guide says {e['name']!r} "
                 "(add it to GUIDE_NAMES, then run dev/make-road-data.py)")
        want = "/assets/monsters/icons/" + e["icon"] if e.get("icon") else None
        if want and monster_id not in ICON_KEPT and icons.get(str(monster_id)) != want:
            fail(f"data/monster-icons.json: id {monster_id} is {icons.get(str(monster_id))!r}, the guide's icon is {want!r}")


def check_icon_sources(index, sources, fail, sha1_of):
    for e in index:
        icon = e.get("icon")
        if e.get("iconKind") != "wiki" or not icon or icon in ICON_SOURCE_KEPT:
            continue
        source = sources.get(icon)
        if not source:
            fail(f"{e['slug']}: wiki icon {icon} is not in data/monster-icon-sources.json")
        elif sha1_of(icon) != source["sha1"]:
            fail(f"assets/monsters/icons/{icon} changed since it was checked against {source['wiki']}: check the "
                 "picture, then update its sha1 in data/monster-icon-sources.json")


def check_places(wiki_places, maps, fail):
    wiki_set = set(wiki_places)
    seen = set()
    for map_id, entry in maps.items():
        place = place_of(entry)
        seen.add(place)
        if place in wiki_set or place in PLACE_OURS_ONLY:
            continue
        if place in PLACE_DIFFERENT:
            if PLACE_DIFFERENT[place][0] not in wiki_set:
                fail(f"place {place!r}: PLACE_DIFFERENT names wiki location {PLACE_DIFFERENT[place][0]!r}, not on the list")
            continue
        fail(f"data/map-ids.json map {map_id}: place {place!r} is not a wiki location: use the game's or the wiki's "
             "name, or list it in PLACE_DIFFERENT/PLACE_OURS_ONLY")
    for place in list(PLACE_DIFFERENT) + list(PLACE_OURS_ONLY):
        if place not in seen:
            fail(f"dev/check-wiki-names.py lists place {place!r}, which no map uses")


def check_weapons(wiki_types, hunters_js, fail):
    listed = re.search(r"var WEAPON_NAMES = \[(.*?)\];", hunters_js, re.S)
    ours = re.findall(r'"([^"]*)"', listed.group(1)) if listed else []
    if sorted(ours) != sorted(wiki_types):
        fail(f"js/hunters.js WEAPON_NAMES {sorted(set(ours) ^ set(wiki_types))} differ from the wiki's weapon types")


def run():
    problems = []
    fail = problems.append
    wiki = read("data/wiki-names.json")
    index = read("data/monsters/index.json")
    check_monsters(wiki["monsters"], index, fail)
    road = road_names((ROOT / "js/road-rules.js").read_text(encoding="utf-8"))
    check_ids(index, read("data/monster-ids.json"), road, read("data/monster-icons.json"), fail)
    sources = read("data/monster-icon-sources.json")["icons"]
    check_icon_sources(index, sources, fail,
                       lambda icon: hashlib.sha1((ROOT / "assets/monsters/icons" / icon).read_bytes()).hexdigest())
    check_places(wiki["locations"], read("data/map-ids.json"), fail)
    check_weapons(wiki["weaponTypes"], (ROOT / "js/hunters.js").read_text(encoding="utf-8"), fail)
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} problem(s)")
        return 1
    print(f"wiki names OK: {len(index)} guide entries against {len(wiki['monsters'])} wiki monsters "
          f"({len(DIFFERENT)} named differently, {len(OURS_ONLY)} ours only, {len(WIKI_ONLY)} wiki only), "
          f"{len(sources)} wiki icons unchanged, {len(wiki['locations'])} wiki locations, "
          f"{len(wiki['weaponTypes'])} weapon types")
    return 0


def self_test():
    cases = []

    def expect(label, problems, want):
        ok = any(want in p for p in problems) if want else not problems
        cases.append(ok)
        print(("ok   " if ok else "FAIL ") + label + ("" if ok else f": {problems}"))

    wiki = ["Rathalos", "Lavasioth", "Zenith Rathalos", "Mi Ru"]
    index = [{"name": "Rathalos", "variants": ["Zenith"], "ids": [11], "slug": "rathalos", "icon": "rathalos.png"},
             {"name": "Volganos", "ids": [75], "slug": "volganos"}, {"name": "Mi Ru", "ids": [113], "slug": "mi-ru"}]
    diff = {"Volganos": ("Lavasioth", "game")}
    p = []
    check_monsters(wiki, index, p.append, diff, {}, {})
    expect("a known difference and a Zenith form pass", p, None)
    p = []
    check_monsters(wiki, index, p.append, {}, {}, {})
    expect("an unlisted name is a problem", p, "'Volganos' (data/monsters/index.json) is not on the wiki's list")
    p = []
    check_monsters(wiki + ["Zenith Mi Ru"], index, p.append, diff, {}, {})
    expect("a Zenith form of an entry without the Zenith variant is a problem", p, "'Zenith Mi Ru' has no guide entry")
    p = []
    check_monsters(wiki, index, p.append, dict(diff, **{"Rathalos": ("Lavasioth", "x")}), {}, {})
    expect("a listed difference that is gone is a problem", p, "'Rathalos' is the wiki's name now")
    p = []
    check_ids(index, {"11": "Rathalos", "75": "Lavasioth"}, ["Mon0"] * 11 + ["Rathalos"], {"11": "/assets/monsters/icons/rathalos.png"}, p.append)
    expect("a builder name that differs from the guide is a problem", p, "id 75 is 'Lavasioth'")
    p = []
    check_icon_sources([{"slug": "rathalos", "icon": "rathalos.png", "iconKind": "wiki"}],
                       {"rathalos.png": {"wiki": "File:X", "sha1": "aaa"}}, p.append, lambda icon: "bbb")
    expect("a swapped icon file is a problem", p, "changed since it was checked")
    p = []
    check_places(["Gorge"], {"31": {"name": "Canyon (day)", "base": "Canyon"}}, p.append)
    expect("an unknown place is a problem", p, "place 'Canyon' is not a wiki location")
    p = []
    check_weapons(["Bow", "Tonfa"], 'var WEAPON_NAMES = ["Bow", "Tonfa"];', p.append)
    expect("the same weapon types pass", p, None)
    print(f"{sum(cases)} of {len(cases)} cases pass")
    return 0 if all(cases) else 1


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv[1:] else run())
