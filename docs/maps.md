# Maps (stages)

A quest's map is `body.mapId` (and the map record's `map.mapId`, docs/quest-fields.md). The client knows 97
map ids, each with its own list of areas (`data/map-areas.json`, read from `mhfo-hd.dll` by
`dev/make-builder-data.py`). Many are copies of one place: day and night are separate maps, a place can
come in a short and a long version (the Volcano with and without Areas 9-10, the Sky Corridor districts with
and without the tower climb), and fights against one monster have their own small stage. `data/map-ids.json`
gives every map a name of its own that says which copy it is; the Quest builder's map dropdown, and every
other page that names a map, reads it from there.

## data/map-ids.json

One entry per map id in `map-areas.json`:

| Key | Meaning |
|---|---|
| `name` | the map's name, unique: the place, then what makes this copy different (`Volcano (night)`, `Ancient Tower 2`, `Sky Corridor, 3rd District, short`). Place names are the English client's own (its location list, below), else the area names; where the quest text or a wiki uses another word it is in `note` (Gorge is "Canyon" in our translated quest text) |
| `base` | only for maps whose areas are in `data/area-ids.json`: the place as those area names write it (`Volcano - Area 3 - Day`), so the builder can drop it from the area labels |
| `group` | the dropdown group: Field maps, Arenas and battle stages, Towers, Forts and sieges, Raviente, Road and special, Unused / untested (maps no quest file uses; always and only those) |
| `quests` | how many quests in `data/quest-details.json` use the map |
| `source` | where the name comes from (below) |
| `confidence` | `confirmed` = the map's area names and the quests on it agree; `likely` = one of them says it, or the day/night part rests on the id pattern; `guess` = no name for its areas, worked out from the id pattern or the odd mix of areas |
| `note` | what tells the copy apart, or why the name is only likely |

Sources:

- **area-ids**: the area names in `data/area-ids.json` ("Desert - Area 3 - Night").
- **overlay areas**: the full area table of the MHFZ Overlay 0.3.0 (`frontier_tools/MHFZ_Overlay_v0.3.0`),
  where `area-ids.json` came from; it also names the arena, tower, fort, Raviente and Sky Corridor areas
  that `area-ids.json` leaves out ("Castle Schrade Area 2", "Tower 2", "Duremudira Arena", "Berserk Raviente
  Support 03"). Read from the program's code on 2026-11-02 (`ldc.i4` id, `ldstr` name pairs).
- **quest text**: the names, categories and objectives of the quests on the map (`data/quests.json`), in
  English and Japanese ("Slay: Battlefield Akantor", シュレイド城, 迎撃, 黄昏).
- **wiki** (2026-11-02): monsterhunterwiki.org and wikiwiki.jp field pages. They give names, area counts and
  Japanese names but no ids, so every match is by description and confidence is not raised by it. It moved
  Gorge to Canyon (峡谷), Solitude Island/Isle to Solitary Isles (絶島) and Top of the Great Forest to Great
  Forest Canopy (樹海頂部) (all three moved back on 2026-11-03, see **client** below), and gave the muted
  Japanese name (`ja` in `map-ids.json`). Kept: Battlefield (8, 69; the wiki says Battleground, 決戦場). Not found, so no name or `ja`: 10, 25, 33, 34, 36-39, 45, 46,
  70, 72, 74, 76-78, 82-85.
- **client** (2026-11-03): the English client's own location list in `dat/mhfpac.bin` (the released patch's,
  decoded; the quest list and the quest info screen use it): Fortress, Forest & Hills, Desert, Swamp, Volcano,
  Jungle, Castle Schrade, Battlefield, Arena, Snowy Mountains, Town, Tower, Great Forest, Gorge, Great Arena,
  Top of Great Forest, Balloon, Solitude Island, Highlands, Competition Arena, Interceptor's Base, Tidal Island,
  Polar Sea, World's End, Exploration Ship, Flower Field, Deep Crater, Bamboo Forest, White Lake, Solitude
  Island Depths, Cloud Viewing Fort, Painted Falls, Sanctuary, Hunting Road, Sacred Pinnacle, Historical Site.
  It gave Gorge, Solitude Island, Top of Great Forest, Interceptor's Base, Historical Site and Battlefield (8;
  the area ids 88 and 197 too). It names places, not maps, so the copies keep our own suffixes. Kept on purpose:
  Ancient Tower (the list's "Tower", kept apart from the Sky Corridor's tower areas), Forest and Hills (the
  game writes both that and "Forest & Hills"), Large Airship (63, Shantien's map: not matched to the list's
  "Balloon" or "Exploration Ship" yet). `dev/check-wiki-names.py` compares the place names with the Monster
  Hunter Fandom wiki's Frontier location list (`data/wiki-names.json`).
- **id pattern**: night copies follow their day map: 2-6 and 11 are day, 16-21 the same places at night,
  then 12/22, 1/23, 9/24 and 10/25 pair up the same way; where the areas carry no Day/Night name the pairing
  is the only evidence.

Not used, and why: the client's own per-map name text (body `+0x24` indexes it, RE `quest-files.md`) is
behind code not decompiled yet, so no map name here is the game's own label for that map (the place names
are, see **client**). Erupe and the 010
templates have no map names.

Totals (2026-11-02): 81 maps used by quests (52 confirmed, 26 likely, 3 guesses), 16 used by no quest file.
`node dev/check-quest-fields.js` checks that every map id in `map-areas.json` has an entry, that no two names
are the same, that the counts match `quest-details.json` and that this table matches the JSON.

## Area names

`data/area-ids.json` named only the field maps' areas, so the builder's start-area and spawn-area pickers
showed "Unnamed area" for arenas, towers, forts, Raviente and the other stages. On 2026-11-02 the 126 areas
the maps use that it left out were named from the overlay's area table (same source as above), rewritten in
the file's `<place> - <area> - <Day/Night>` form; the maps on those places got a `base`, so the pickers show
"Area 3" instead of "Ancient Tower, Area 3". The client's own name text (`mhfdat.bin`) is Japanese and its
name table is not traced, so no English client name was used.

What is less than the overlay says, marked in the name itself:

- `(guess)`: Fortress areas 1-6 (ids 14, 30, 28, 11, 12, 31 by the order of map 1's area list; the overlay
  calls every one "Siege Fortress Day"), all of the night Fortress (map 23, ids 76-82, no table names
  them), area 395 (Sky Corridor 4th District, "Absent" in the overlay), and 437 / 438: the overlay calls
  437 "Guanzorumu Arena 01" and 438 "Berserk Raviente Base Camp", but 437 is the base camp of Berserk
  Raviente stages 2-5 and 438 that of Guanzorumu's arena, so they are read as swapped.
- Day or night is left out where only the map id pattern says it (Dundorma Fort, the night Fortress, the
  Caravan Blimp).
- "Unused area (no name in any table)": ids 266-271, 284, 285, 287, 381-385, which the overlay lists as
  "Absent"; only unused maps have them. "Solitude Island - part not named": the seven island areas the
  overlay calls only "Solitude Island".

## The maps

| Id | Name | Group | Areas | Quests | Source | Confidence | What tells it apart |
|---|---|---|---|---|---|---|---|
| 1 | Fortress (day) | Forts and sieges | 7 | 15 | overlay areas, quest text, wiki | likely | Lao-Shan Lung fort defense; every area is "Siege Fortress Day" in the overlay table; Japanese: 砦 |
| 2 | Forest and Hills (day) | Field maps | 13 | 81 | area-ids, quest text | confirmed |  |
| 3 | Desert (day) | Field maps | 12 | 563 | area-ids, quest text | confirmed |  |
| 4 | Swamp (day) | Field maps | 11 | 431 | area-ids, quest text | confirmed |  |
| 5 | Volcano (day) | Field maps | 10 | 235 | area-ids, quest text | confirmed | the original Volcano, Areas 1-8 |
| 6 | Jungle (day) | Field maps | 11 | 478 | area-ids, quest text | confirmed |  |
| 7 | Castle Schrade | Arenas and battle stages | 2 | 15 | overlay areas, quest text | confirmed | Fatalis; quest names say Castle Schrade (シュレイド城) |
| 8 | Battlefield (Crimson Fatalis) | Arenas and battle stages | 2 | 10 | overlay areas, quest text, wiki, client | likely | Crimson Fatalis (紅き怒りを追撃せよ); the Volcano secret area then the battlefield; the English client's location list says Battlefield, the wikis Battleground (決戦場); Japanese: 決戦場 |
| 9 | Arena (day) | Arenas and battle stages | 2 | 122 | overlay areas, quest text, wiki | likely | quest text says Arena (闘技場); weak wiki match: Great Arena (大闘技場), unresolved |
| 10 | Felyne Arena (day) | Arenas and battle stages | 2 | 14 | overlay areas, quest text | likely | the Arena base camp with another fight area; Felyne and Melynx, Velocidrome quests |
| 11 | Snowy Mountains (day) | Field maps | 10 | 295 | area-ids, quest text | confirmed |  |
| 12 | Dundorma Fort (day) | Forts and sieges | 4 | 9 | overlay areas, quest text, id pattern, wiki | likely | Dundorma defense quests; day or night from the id pattern only; wiki: probably Battlequarters (戦闘街); Japanese: 戦闘街 |
| 13 | Ancient Tower 1 | Towers | 9 | 159 | overlay areas, quest text, wiki | likely | Tower 1: top area is Tower 1 Area 8; Rathalos and Kirin quests; Japanese: 塔 |
| 14 | Ancient Tower 2 | Towers | 10 | 176 | overlay areas, quest text, wiki | likely | Tower 1 plus the Tower 2 top area; Azure Rathalos, Pink Rathian; Japanese: 塔 |
| 15 | Ancient Tower 3 | Towers | 11 | 176 | overlay areas, quest text, wiki | likely | Tower 3, Areas 8-10 at the top; Lunastra, Teostra; the wiki's Tower 3 is the 1-area Forlorn Arena (塔の秘境), not this 11-area map, so the Japanese 塔 is for the tower in general; Japanese: 塔 |
| 16 | Forest and Hills (night) | Field maps | 13 | 83 | area-ids, quest text | confirmed |  |
| 17 | Desert (night) | Field maps | 12 | 548 | area-ids, quest text | confirmed |  |
| 18 | Swamp (night) | Field maps | 11 | 425 | area-ids, quest text | confirmed |  |
| 19 | Volcano (night) | Field maps | 10 | 241 | area-ids, quest text | confirmed | the original Volcano, Areas 1-8 |
| 20 | Jungle (night) | Field maps | 11 | 520 | area-ids, quest text | confirmed |  |
| 21 | Snowy Mountains (night) | Field maps | 10 | 290 | area-ids, quest text | confirmed |  |
| 22 | Dundorma Fort (night) | Forts and sieges | 4 | 7 | overlay areas, quest text, id pattern, wiki | likely | its own copy of the four Dundorma Fort areas; night from the id pattern only; wiki: probably Battlequarters (戦闘街); Japanese: 戦闘街 |
| 23 | Fortress (night) | Forts and sieges | 7 | 27 | quest text, id pattern, wiki | guess | Lao-Shan Lung fort defense on seven areas no table names; night from the id pattern only; Japanese: 砦 |
| 24 | Arena (night) | Arenas and battle stages | 2 | 111 | overlay areas, quest text, id pattern, wiki | likely | quest text says Arena (闘技場); weak wiki match: Great Arena (大闘技場), unresolved |
| 25 | Felyne Arena (night) | Arenas and battle stages | 2 | 14 | overlay areas, quest text, id pattern | likely | Felyne and Melynx, Velocidrome quests |
| 26 | Great Forest (day) | Field maps | 9 | 287 | area-ids, quest text | confirmed |  |
| 27 | Great Forest (night) | Field maps | 9 | 288 | area-ids, quest text | confirmed |  |
| 28 | Volcano with Areas 9-10 (day) | Field maps | 12 | 129 | area-ids, quest text | confirmed | the later Volcano: adds Areas 9 and 10 (Volganos, Midogaron) |
| 29 | Volcano with Areas 9-10 (night) | Field maps | 12 | 116 | area-ids, quest text | confirmed | the later Volcano: adds Areas 9 and 10 (Volganos, Midogaron) |
| 30 | Jungle, Area 10 only (Sleep Learning) | Raviente, Road and special | 1 | 2 | area-ids, quest text | confirmed | one area; used by the two Sleep Learning quests |
| 31 | Gorge (day) | Field maps | 7 | 179 | area-ids, quest text, wiki, client | confirmed | the English client's location list says Gorge, as the Fandom wiki does; monsterhunterwiki.org and our translated quest text say Canyon (峡谷); Japanese: 峡谷 |
| 32 | Gorge (night) | Field maps | 7 | 166 | area-ids, quest text, wiki, client | confirmed | the English client's location list says Gorge, as the Fandom wiki does; monsterhunterwiki.org and our translated quest text say Canyon (峡谷); Japanese: 峡谷 |
| 33 | Unused test stage, PvP Room (day) | Unused / untested | 6 | 0 | overlay areas | guess | odd mix: two Interceptor's Base areas, an Arena base camp, Cities Map, PvP Room |
| 34 | Unused test stage, Halk Area (night) | Unused / untested | 6 | 0 | overlay areas | guess | night copy of map 33 with Halk Area |
| 35 | Battlefield (Akantor) | Arenas and battle stages | 2 | 62 | overlay areas, quest text | confirmed | quest names say Battlefield; Akantor |
| 36 | Unused stage, areas 266 and 268 | Unused / untested | 2 | 0 | overlay areas | guess | no table names its areas |
| 37 | Unused stage, areas 267 and 269 | Unused / untested | 2 | 0 | overlay areas | guess | no table names its areas |
| 38 | Unused stage, areas 266 and 270 | Unused / untested | 2 | 0 | overlay areas | guess | no table names its areas |
| 39 | Unused stage, areas 267 and 271 | Unused / untested | 2 | 0 | overlay areas | guess | no table names its areas |
| 40 | Interceptor's Base, 2 areas (day) | Unused / untested | 2 | 0 | overlay areas, wiki, client | likely | base camp and Area 1 of the Interceptor's Base; Interceptor's Base is the English client's word; Japanese: 迎撃拠点 |
| 41 | Interceptor's Base, 2 areas (night) | Unused / untested | 2 | 0 | overlay areas, wiki, client | likely | base camp and Area 1 of the Interceptor's Base; Interceptor's Base is the English client's word; Japanese: 迎撃拠点 |
| 42 | Solitude Island, whole island (set 1) | Unused / untested | 7 | 0 | overlay areas, wiki, client | likely | Raviente: campaign tent, balloon and the isles; Solitude Island is the English client's word; Japanese: 絶島 |
| 43 | Solitude Island, whole island (set 2) | Unused / untested | 7 | 0 | overlay areas, wiki, client | likely | Raviente: the other copy of the island areas; Solitude Island is the English client's word; Japanese: 絶島 |
| 44 | Top of Great Forest | Arenas and battle stages | 2 | 159 | overlay areas, quest text, wiki, client | likely | two areas; Doragyurosu and the Exotic (G★8) quests; Top of Great Forest is the English client's word (Fandom wiki: Great Forest Peak); Japanese: 樹海頂部 |
| 45 | Caravan Blimp (day) | Raviente, Road and special | 1 | 1 | overlay areas | guess | one area; one Caravan (インター) quest with no title |
| 46 | Caravan Blimp (night) | Raviente, Road and special | 1 | 3 | overlay areas | guess | one area; three Caravan (インター) quests with no title |
| 47 | Solitude Island 1 (Raviente) | Raviente, Road and special | 2 | 3 | overlay areas, quest text, wiki, client | confirmed | Great Slaying: the balloon and isle 1; Solitude Island is the English client's word; Japanese: 絶島 |
| 48 | Solitude Island 2 (Raviente) | Raviente, Road and special | 2 | 3 | overlay areas, quest text, wiki, client | confirmed | Great Slaying: the balloon and isle 2; Solitude Island is the English client's word; Japanese: 絶島 |
| 49 | Solitude Island 3 (Raviente) | Raviente, Road and special | 2 | 7 | overlay areas, quest text, wiki, client | confirmed | Great Slaying: the balloon and isle 3; Solitude Island is the English client's word; Japanese: 絶島 |
| 50 | Highlands (day) | Field maps | 8 | 188 | area-ids, quest text | confirmed |  |
| 51 | Highlands (night) | Field maps | 8 | 210 | area-ids, quest text | confirmed |  |
| 52 | Ancient Tower 1 with Area 9 | Towers | 10 | 134 | overlay areas, quest text, wiki | likely | Tower 1 plus the Tower 1 Area 9 summit; Stygian Zinogre, mostly G rank; Japanese: 塔 |
| 53 | Arena with moat (day) | Arenas and battle stages | 2 | 443 | overlay areas, quest text, wiki | likely | the busy G rank arena: daily, Idaten and Great Arena quests; weak wiki match: the Season 10 new Great Arena (新大闘技場) |
| 54 | Arena with moat (night) | Arenas and battle stages | 2 | 436 | overlay areas, quest text, wiki | likely | the busy G rank arena: daily, Idaten and Great Arena quests; weak wiki match: the Season 10 new Great Arena (新大闘技場) |
| 55 | Interceptor's Base (day) | Forts and sieges | 4 | 132 | overlay areas, quest text, wiki, client | confirmed | Intercept quests (迎撃); Interceptor's Base is the English client's word; Japanese: 迎撃拠点 |
| 56 | Interceptor's Base (night) | Forts and sieges | 4 | 126 | overlay areas, quest text, wiki, client | confirmed | Intercept quests (迎撃); Interceptor's Base is the English client's word; Japanese: 迎撃拠点 |
| 57 | Tidal Island (day) | Field maps | 6 | 162 | area-ids, quest text, wiki | confirmed | Japanese: 潮島 |
| 58 | Tidal Island (night) | Field maps | 6 | 136 | area-ids, quest text, wiki | confirmed | Japanese: 潮島 |
| 59 | Tidal Island (dusk) | Field maps | 6 | 22 | area-ids, quest text, wiki | likely | its own six areas, one "Orange Area 5"; quest names say dusk (黄昏); Japanese: 潮島 |
| 60 | Polar Sea (day) | Field maps | 7 | 82 | area-ids, quest text | confirmed |  |
| 61 | Polar Sea (night) | Field maps | 7 | 86 | area-ids, quest text | confirmed |  |
| 62 | World's End (Disufiroa) | Arenas and battle stages | 2 | 14 | overlay areas, quest text | confirmed | Disufiroa |
| 63 | Large Airship (Shantien) | Arenas and battle stages | 3 | 23 | overlay areas, quest text | confirmed | Shantien |
| 64 | Flower Field (day) | Field maps | 6 | 34 | area-ids, quest text | confirmed |  |
| 65 | Flower Field (night) | Field maps | 6 | 48 | area-ids, quest text | confirmed |  |
| 66 | Deep Crater (Crimson Fatalis) | Arenas and battle stages | 2 | 7 | overlay areas, quest text, wiki | likely | Battlefield entrance then Deep Crater; Crimson Fatalis (紅龍); Japanese: 火口深部 |
| 67 | Bamboo Forest (day) | Arenas and battle stages | 2 | 33 | overlay areas, quest text | confirmed | Inagami (雅翁龍) |
| 68 | Bamboo Forest (night) | Arenas and battle stages | 2 | 31 | overlay areas, quest text | confirmed | Inagami (雅翁龍) |
| 69 | Battlefield (Varusaburosu) | Arenas and battle stages | 3 | 57 | overlay areas, quest text, wiki | likely | Volcano secret area, then the battlefield; the wiki calls it Battleground (決戦場), our quest text says Battlefield; Japanese: 決戦場 |
| 70 | Unused stage, areas 381-385 | Unused / untested | 5 | 0 | overlay areas | guess | no table names its areas |
| 71 | Sky Corridor, 1st District | Towers | 5 | 3 | overlay areas, quest text, wiki | likely | airship, tower entrance, Tower 01, then Duremudira; Japanese: 天廊 |
| 72 | Sky Corridor, 1st District, Duremudira only | Towers | 3 | 1 | overlay areas, quest text | likely | airship straight to the Duremudira arena |
| 73 | Sky Corridor, 2nd District | Towers | 5 | 1 | overlay areas, quest text, wiki | likely | airship, tower entrance, Tower 02, then Duremudira; Japanese: 天廊 |
| 74 | Sky Corridor, 2nd District, Duremudira only | Towers | 3 | 3 | overlay areas, quest text | likely | airship straight to the Duremudira arena; also Arrogant Duremudira |
| 75 | Sky Corridor, 3rd District | Towers | 5 | 2 | overlay areas, quest text, wiki | likely | quest names say Third District; Japanese: 天廊 |
| 76 | Sky Corridor, 3rd District, short | Towers | 3 | 1 | overlay areas, quest text | likely | airship, the urgent tower floor, Duremudira arena |
| 77 | Sky Corridor, 4th District | Unused / untested | 5 | 0 | overlay areas | likely | no quest file uses it |
| 78 | Sky Corridor, 4th District, short | Towers | 3 | 1 | overlay areas, quest text | likely | quest name says Fourth District |
| 79 | White Lake (day) | Field maps | 7 | 66 | area-ids, quest text | confirmed |  |
| 80 | White Lake (night) | Field maps | 7 | 52 | area-ids, quest text | confirmed |  |
| 81 | Berserk Raviente, combat stage 1 | Raviente, Road and special | 2 | 18 | overlay areas, quest text | confirmed | Berserk / Extreme Raviente slaying |
| 82 | Berserk Raviente, combat stage 2 | Unused / untested | 2 | 0 | overlay areas | likely | no quest file uses it |
| 83 | Berserk Raviente, combat stage 3 | Unused / untested | 2 | 0 | overlay areas | likely | no quest file uses it |
| 84 | Berserk Raviente, combat stage 4 | Unused / untested | 2 | 0 | overlay areas | likely | no quest file uses it |
| 85 | Berserk Raviente, combat stage 5 | Unused / untested | 2 | 0 | overlay areas | likely | no quest file uses it |
| 86 | Berserk Raviente, support stage 1 | Raviente, Road and special | 2 | 3 | overlay areas, quest text | confirmed | G rank siege support quests |
| 87 | Berserk Raviente, support stage 2 | Raviente, Road and special | 2 | 3 | overlay areas, quest text | confirmed | G rank siege support quests |
| 88 | Berserk Raviente, support stage 3 | Raviente, Road and special | 2 | 3 | overlay areas, quest text | confirmed | G rank siege support quests |
| 89 | Berserk Raviente, support stage 4 | Raviente, Road and special | 2 | 3 | overlay areas, quest text | confirmed | G rank siege support quests |
| 90 | Berserk Raviente, support stage 5 | Raviente, Road and special | 2 | 3 | overlay areas, quest text | confirmed | G rank siege support quests |
| 91 | Guanzorumu's arena | Arenas and battle stages | 2 | 26 | overlay areas, quest text | confirmed | Guanzorumu |
| 92 | Painted Falls (day) | Field maps | 7 | 41 | area-ids, quest text | confirmed |  |
| 93 | Painted Falls (night) | Field maps | 7 | 34 | area-ids, quest text | confirmed |  |
| 94 | Shagaru Magala's arena | Arenas and battle stages | 2 | 12 | overlay areas, quest text | confirmed | Shagaru Magala |
| 95 | Hunting Road | Raviente, Road and special | 2 | 2 | area-ids, quest text | confirmed | area names say Hunter's Road |
| 96 | Amatsu's arena | Arenas and battle stages | 2 | 8 | overlay areas, quest text | confirmed | Amatsu |
| 97 | Historical Site (Musou) | Arenas and battle stages | 2 | 25 | overlay areas, quest text, wiki, client | likely | Musou quests (遷悠) against many monsters; Historical Site is the English client's word; Japanese: 古跡 |
