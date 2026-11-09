# Quest builder vs Pax's quest editor: what is missing, and the plan

Owner (2026-11-09 14:06): list what our quest builder (`quest-editor.html`, `js/quest-editor.js`) lacks
compared with PaxMHFZQuestEditor: monster size, difficulty and exact coordinates; every quest flag (forced
Hardcore, conquest, "no alk" and the rest); equipment restrictions (arena quests, forced loadouts); all the
quest restriction options; Reward 1/2/3 (the reward preview); which counter a quest appears at, its quest
type, time of day, season and the "New" / "Recommended" mark; and anything else Pax has.

This page compares every field and feature of Pax's editor with ours, says where each missing one lives and
what it would take, and splits the work into five tasks. Research only (2026-11-09): nothing here changes
code.

## Sources

| Short name | What | Where |
|---|---|---|
| Pax | PaxMHFZQuestEditor, last commit `dcc2cdb` (2024-03-21), Tauri/React. **No licence file**: read it, copy nothing (AGENTS rule 10). Its offsets count from the file start; our body starts at file 0xc0, so Pax `0xc4` = our `body +0x04` | `github.com/Paxlord/PaxMHFZQuestEditor`, read-only clone in `/root/work/pax-quest-editor/` on mhfz-dev: `src/Utils/QuestParams/*.js`, `src/Pages/*.jsx`, `src/Data/*.js` |
| fields | our field reference: offsets, sizes, ranges, value names, what the builder edits | `docs/quest-fields.md`, `data/quest-fields.json` |
| RE | client trace of the quest file, the event list entry and Erupe's offsets | `hvmhfz_re` `docs/quest-files.md` (body table, "ENUMERATE_QUEST entry", "Erupe's offsets: verdicts"), `data/quest_fields.tsv`, `docs/quest-classes.md` (part 75) |
| API | codec, blank quest, ranges, submit and publish | `hvmhfz_rest_api` `quest/QuestCodec.java`, `QuestModelRanges.java`, `QuestMaps.java`, `QuestDraftController.java`, `QuestSubmissionController.java` (`publishSandboxQuest`), `QuestFile.java` (`withNoRewards`) |
| Erupe | the event list entry and custom quest serving | `server/channelserver/handlers_quest.go` at live `e342bd4`: `buildEventQuest`, `loadQuestFile`, `sandboxQuestFile`, `sandboxQuestID` |
| sample | counts over the 5,000 uncompressed live quest files in `/root/work/re-mhfz/quests-live/` (2026-11-09; the script, `/root/work/qb-gap-scratch/survey.py`, reads game files and stays off this repo) | below, "in the sample" |
| live rows | read-only count of `event_quests` by `quest_type` and `mark` on `hvmhfz-db` (2026-11-09) | below |

## Summary

Pax's controls, grouped as Pax's menu groups them, come to **52 rows** below:

| Status | Rows |
|---|---|
| present | 17 |
| partial | 5 |
| missing | 27 |
| not needed here | 3 |

"Not needed": Pax's two unfinished pages (small monsters, gatherables) and its quest list export, which
Erupe builds itself. Six of the 27 missing rows are the six equipment slots.

Two findings on the way, both in the plan:

1. **Custom quests pay their reward money.** The account page says "Custom quests grant no rewards or
   zenny", and `QuestFile.withNoRewards` empties the reward groups and the header points, but not the money at
   `body +0x10`, `+0x18`, `+0x1c`. The client adds what is left of `+0x10` to the player's money on a clear
   (RE `0x10b11d60`), and the builder offers up to 999,999 zenny, so an author can farm their own testing
   quest. Zeroing it is not a one-line fix: the same field is the faint pool, and the quest fails when it
   reaches 0 (RE `0x10aa86c0`). Chunk 5 and the owner question at the end.
2. **`event_quests.flags` writes the wrong byte.** Erupe's `buildEventQuest` replaces body `+0x03` with the
   column; the client reads season and day/night from body `+0x02` (RE, "Erupe's offsets: verdicts"). So time
   of day and season must be set in the quest file (`body.seasonFlags`), not through that column. Every live
   row has `flags` NULL, so nothing is broken today.

## Every Pax control vs ours

Status: **present** (ours edits it), **partial** (ours edits some of it; what is missing is said),
**missing** (ours does not edit it; the model may still carry the bytes), **not needed** (see above).
"Ours" names the key in `data/quest-fields.json` where there is one.

### Quest Params › Objectives

| # | Pax control | Pax offset | Ours | Status |
|---|---|---|---|---|
| 1 | Main objective: type, target, amount | 0xf0 | `body.objective0.*` (+0x30) | present |
| 2 | Sub A objective: type, target, amount | 0xf8 | `body.objective1.*` (+0x38) | present |
| 3 | Sub B objective: type, target, amount | 0x100 | `body.objective2.*` (+0x40) | present |
| 4 | Main "Zenny Reward" | 0xd0 | `body.rewardMoney` (+0x10), "Reward money" | present |
| 5 | Sub A / Sub B "Zenny Reward" | 0xd8, 0xdc | `body.objective1Money`, `objective2Money` (+0x18, +0x1c): shown, kept from the blank | missing |
| 6 | Main / Sub A / Sub B "Points Reward" | 0x4c, 0x54, 0x58 (header) | `header.objective0Points` etc.: carried, zeroed at submit | missing |

### Quest Params › Currencies

| # | Pax control | Pax offset | Ours | Status |
|---|---|---|---|---|
| 7 | Quest Fee | 0xcc | `body.zenny` (+0x0c), "Contract fee" | present |
| 8 | Death Count | 0xd4 | `body.faintPenalty` (+0x14): carried | missing |
| 9 | Map Variant | 0x153 | `body.variantIndex` (+0x93): carried | missing |
| 10 | Mandatory Objectives (main only / main + A / main + A + B) | 0x108 | `body.objectiveMode` (+0x48): carried | missing |

### Quest Params › Quest Flags (three bytes, 24 checkboxes)

| # | Pax control | Pax offset | Ours | Status |
|---|---|---|---|---|
| 11 | Flags 1: Hiden, Fix HC, HC to UL, G Rank, SR, two unknown, UL Fixed | 0x157 | `body.variantFlags1` (+0x97): carried | missing |
| 12 | Flags 2: Low Conquest, No Halk Pots, No Cuff, Timer, No Active Feature, Fixed Difficulty, High Conquest, Road | 0x158 | `body.variantFlags2` (+0x98): carried | missing |
| 13 | Flags 3: No Reward Skills, GSR to GR, No Easy Drink, No GP Skills, Zenith, Interception, unknown, No Sigils | 0x159 | `body.variantFlags3` (+0x99): only bit 4 (Zenith), set with a Zenith monster | partial: 1 of 8 bits, derived |

### Big Monsters › Monsters List

| # | Pax control | Pax offset | Ours | Status |
|---|---|---|---|---|
| 14 | Monster (up to 5) | large spawn record +0x00 | `largeSpawnAreas[].spawns[].monsterId` | present (ours has no limit of 5; one area holds 5 distinct monsters) |
| 15 | Quantity | record +0x04 | `spawns[].count` | present |
| 16 | Starting Zone, from the map's area list | record +0x08 | `spawns[].areaId`, from `data/map-areas.json` | present |
| 17 | Coordinates filled from the most common spot of the zone | record +0x20 | the API copies a real quest's position for that map and area (`QuestMaps.withPositions`) | present |
| 18 | X, Y, Z typed in | record +0x20, +0x24, +0x28 (f32) | `spawns[].position`: no input, and the server overwrites it on every save | missing |

### Big Monsters › Monster Parameters and Monster Flags

| # | Pax control | Pax offset | Ours | Status |
|---|---|---|---|---|
| 19 | Size (in %) | 0x44 (header) | `header.monsterSize`: carried | missing |
| 20 | Difficulty (stat table, named list or custom number) | 0x48 (header) | `header.monsterLevel`: only Zenith ★1-★4 (64-67) while a Zenith monster is in the quest | partial: no other level |
| 21 | Monster Flags 1-5 (one byte per monster slot) | 0x151, 0x152, 0x176-0x178 | `body.monsterVariants[0-4]`: 0 or 16 (Zenith), set by the Zenith form picker | partial: Zenith only |

Pax reads and writes back the size spread byte (header +0x46, `header.sizeClass`) without an input; we
carry it too. It belongs with row 19 in the plan.

### Small Monsters, Gatherables

| # | Pax control | Pax offset | Ours | Status |
|---|---|---|---|---|
| 22 | Small Monsters | - | shown per set and part, not edited | not needed (Pax: "TBI", not implemented) |
| 23 | Gatherables | - | none | not needed (Pax: "TBI", not implemented) |

### Quest Rewards

| # | Pax control | Pax offset | Ours | Status |
|---|---|---|---|---|
| 24 | Reward Flag (5 named modes) | 0x150 | `body +0x90`: not in the model (kept as raw bytes) | missing |
| 25 | Boxes 1-5 (main, sub A, sub B, ...) | reward table header | `rewardGroups[].groupId` with a named condition picker | present |
| 26 | Item: chance, id, count | reward entries | `rewardGroups[].entries[]`, with each item's share of the group | present |
| 27 | Slot limit per box (24 for the first, 4 for the others) | - | only the 1,024-byte table limit | partial: no per-box limit |
| 28 | Export / import rewards as JSON | - | none | missing |
| 29 | "Beautiful Rewards" text summary | - | the Review panel lists rewards with shares | present |

### Quest Strings

| # | Pax control | Pax offset | Ours | Status |
|---|---|---|---|---|
| 30 | 8 strings: title, main, sub A, sub B, clear condition, fail condition, client, description | string table (body +0x28) | `texts[0-7]`, Shift-JIS byte counts and room per slot | present |
| 31 | Auto-fill objective lines from the objectives | - | none | missing |
| 32 | Auto-fill clear and fail lines from objective mode and faint count | - | none | missing |

### Equipments

| # | Pax control | Pax offset | Ours | Status |
|---|---|---|---|---|
| 33 | Legs: piece id, deco 1-3 | 0x11c | `body.equipment[]` (+0x5c): not in the model | missing |
| 34 | Weapon: piece id, deco 1-3 | 0x124 | (+0x64) | missing |
| 35 | Head | 0x12c | (+0x6c) | missing |
| 36 | Chest | 0x134 | (+0x74) | missing |
| 37 | Arms | 0x13c | (+0x7c) | missing |
| 38 | Waist | 0x144 | (+0x84) | missing |

### Misc Params › Quest Params, Rank and Quest Restrictions, Reward Mats

| # | Pax control | Pax offset | Ours | Status |
|---|---|---|---|---|
| 39 | Time Limit (minutes) | 0xe0 | `body.timeLimit`, in minutes | present |
| 40 | Quest File ID | 0xee | `body.questId`: the server assigns it (65000 + submission id, Erupe `withQuestID`) | present (server-owned on purpose) |
| 41 | Stars | 0xc4 | `body.level` (+0x04): carried | missing |
| 42 | Min / Max Post Rank, Min / Max Join Rank | 0x10a-0x111 | `body.rank` (+0x4e, join minimum) carried; the other three not in the model | missing |
| 43 | Quest Requirements (137 named restrictions) | 0xec | `body.conditionNote` (+0x2c): carried | missing |
| 44 | Reward 1, 2, 3 (item ids "in the quest listing") | 0x170, 0x172, 0x174 | `body +0xb0`, `+0xb2`, `+0xb4`: not in the model | missing |

Our "Item needed to enter" (`body.iconLabelId` / `iconLabelCount`, +0x94 / +0x96) is a restriction Pax
reads but has no input for. It is ours only.

### Misc Params › Events (the quest list entry)

| # | Pax control | Where | Ours | Status |
|---|---|---|---|---|
| 45 | Max Players | `event_quests.max_players` | the file's `body.maxHunters` is edited; the row is always written with 4 | partial: row not set |
| 46 | Counter ID (quest type) | `event_quests.quest_type` | always 18 (`EVENT_QUEST_TYPE`) | missing |
| 47 | Appeal Mark: None, Recommended, New | `event_quests.mark` | always 0 | missing |
| 48 | Time of day: Day, Night, Any | Pax: entry byte 24 = body +0x02 | `body.seasonFlags` bit 3: carried | missing |
| 49 | Season: Breeding, Warm, Cold, Any | as row 48, bits 0-2 | carried | missing |
| 50 | Export a quest list binary | - | Erupe builds the entry from the row and the file | not needed |

### File

| # | Pax control | Ours | Status |
|---|---|---|---|
| 51 | Open any decompressed quest file and edit it | the builder starts from the blank only (owner, 2026-10-30); a finished `.bin` can be uploaded as a submission on the account page | present as far as the owner wants it |
| 52 | Save single file; save three copies (`...0`, `1`, `2`) | Download (`GET /api/account/quest-drafts/{id}/file`); Erupe serves a custom quest's one stored file for every `d`/`n` and season name (`sandboxQuestID`), so the copies are not needed | present |

## Ours only

Start areas, map picker limited to maps the server has area tables for, supply box (40 items), item needed to
enter, quest class (both copies), quest card monster icons, Zenith forms with their rules, named reward
conditions, slot room and Shift-JIS checks, server-side range checks, drafts with revisions, test-before-publish
and expiry. Pax has none of these.

## Each missing or partial field in detail

"Risk" is what can go wrong in the game client or on the server. "API" and "Erupe" say what must change
there. Every model change also needs the codec round-trip test (every file in the sample directory byte for
byte) and `dev/check-quest-fields.js` updated with the new fields.

### Listing: counter, type, mark, players, time of day, season (rows 45-49)

| Field | Where | Values | Risk | API | Erupe |
|---|---|---|---|---|---|
| Counter / quest type | `event_quests.quest_type`, entry byte 10 (RE: entry +0x0a, read by the client in 5 places) | Pax names and live rows (count): 8 Festa winners (26), 9 Campaign (18), 13 VS (8), 16/22/40/50/51 Raviente normal/violent/berserk/extreme/small berserk (3/1/11/11/11), 18 HR Event (76), 24 Series (22), 26 Daily (2), 28 G Event (69), 30 G Daily (0), 31 G Urgent (1), 38 HR Exotic (4), 39 G Exotic (6), 43 "Superior/Zenith?" (44), 46/47/48 Interception, branch, urgent (73/5/1), 52 Superior, 53 G Superior, 54 G Armor (0 each) | Raviente types make Erupe replace max players with the Raviente config and put the quest in the Raviente event; 9 changes a flag byte (Erupe writes `false`); 13, 46-48 and 8 are event modes (VS, Interception, Festa). What the client does with a type it has no counter for is not traced (likely: the quest is not listed). Low for the safe list below | new submission column; `publishSandboxQuest` writes it; refuse types outside the list | none |
| Appeal mark | `event_quests.mark`, entry bytes 14-17 (Erupe writes it big-endian; Pax sets byte 17, the same byte) | 0 none, 1 Recommended, 2 New (Pax). Live: 0 (233 rows), 1 (95), 2 (49), 4 (5), 9 (10); 4 and 9 have no name | low | new column; refuse other than 0-2 | none |
| Max players | `event_quests.max_players`, entry byte 9; the file's `body +0x0b` (low 3 bits, 0 = 4) | 1-4 | which of the two the client enforces for an event quest is not traced; writing both the same is safe | write the row from `body.maxHunters` (0 means 4) instead of always 4 | none |
| Time of day | `body +0x02` bit 3 (1 = day: the client picks the `d` file name, else `n`) | Day, Night | the same stored file is served for both names, so only the client's day/night state changes (lighting, which monsters are active). Low | none: `body.seasonFlags` is a model field already. Edit that field only: `body.flags` (u32 at +0x00) covers the same byte and the codec refuses a save where the two disagree | none for Day/Night |
| Season | `body +0x02` bits 0-2 | Pax: Breeding (bit 0), Warm (bit 1), Cold (bit 2). RE: the client reads bit 0 as season 2, else bit 2 as season 1, else season 0; bit 1 is not read there. Sample: bit 1 with day (value 10) in 1,831 of 5,000 files | what a season changes beyond the file name is not traced. Low to medium; test in game | none | none |
| "Any" time or season | entry byte 7 bits 0x20 (current season) and 0x10 (current time of day) (RE `0x10aa593f`, `0x10aa59a6`) | on / off | Erupe writes the byte as 0 | none | yes: a column (or the `flags` column fixed to mean this) and write the two bits. Also fix `flags`, which overwrites body +0x03 instead of +0x02 |

Safe counter list for authors (chosen here): **18 HR Event (default), 28 G Event, 24 Series, 26 Daily, 31 G
Urgent, 38 HR Exotic, 39 G Exotic, 43**. All have rows on live today. Left out: Raviente, VS, Festa, Campaign
and Interception (event systems with their own rules) and 30, 52-54 (no live row, untested). An admin can
change the type at approval.

### Monster tuning (rows 18-21)

| Field | Where | Values | Risk | API | Erupe |
|---|---|---|---|---|---|
| Size | `header +0x44` u16, percent, 100 = normal; multiplied by a random factor into each spawn (RE `0x10ab1e60`) | sample: 70..150, 100 in 69% | model scale; extreme values untested. Low within 70..150 | in the model; tighten `QuestModelRanges` from 1..65535 to 70..150 | none |
| Size spread | `header +0x46` u8 | 0 = 100-100%, 1 = 100-105%, 2 = 95-110%, 3 = 87-114%, 4 = 85-125% (RE) | low | in the model, range 0..4 already | none |
| Difficulty (monster level) | `header +0x48` u8; picks the stat table row | Pax names: 1-10 Low rank, 11 Low/High, 12-20 High rank, 26/31/42 HR5, 53 G rank, 54/55 Musou 1/2, 64-67 Zenith 1-4, 71-73 Interception. Sample: 59 distinct values, 53 (982), 26 (560), 6 (537), 12 (460) most | a row the monster has no data for plays at base strength (as on the Road). Must agree with the quest class (G rank levels with class 7/9) and the Zenith rule (64-67 only with a Zenith monster, which the API enforces) | in the model; add the class/level consistency check | none |
| Monster flags 1-5 | `body +0x91`, `+0x92`, `+0xb6`-`+0xb8`, one per slot of the first large list | 0 normal, 16 Zenith (RE: loads `em%03d_e.pac`). Sample also has 10 (1,071), 1 (307), 3 (138), 9 (82), 2, 6, 15, 12, 11, 8: not traced | an unknown variant may load a model file that does not exist for that monster: crash risk. Keep Zenith only until RE names the others | none | none |
| Exact coordinates | spawn record `+0x20`, `+0x24`, `+0x28`, f32 x, y, z (RE: kept as data, no reader traced) | Pax's table: x and z up to about 25,000, y near 0 | a spot outside the area: monster stuck, falling or unreachable. Not a crash in Pax's experience | yes: `QuestMaps.withPositions` replaces every position on each save; keep a position the author set (a flag per spawn, for example `positionSet`), check finite and inside the bounds of the positions known for that map, "use the usual spot" resets it | none |

### Flags and restrictions (rows 8-13, 41-43)

| Field | Where | Values | Risk | API | Erupe |
|---|---|---|---|---|---|
| Flags 1 | `body +0x97` | bit 0 Hiden, 1 Fix HC (forced Hardcore), 2 HC to UL, 3 G Rank, 4 SR, 7 UL Fixed (names: Pax and Erupe comments). RE: bit 3 tested 80 times, set in every class 7 and 9 file, makes `+0x14` the faints allowed; `body +0xa0` (list tab 5) equals it in every file | bit 3 must follow the quest class (derive it, no checkbox). Others: client only, untested one by one | in the model; derive bit 3 and `+0xa0` from the class on save | none |
| Flags 2 | `body +0x98` | bit 0 Low Conquest, 1 No Halk Pots (the owner's "no alk": Halk, the pet), 2 No Cuff, 3 Timer, 4 No Active Feature, 5 Fixed Difficulty, 6 High Conquest, 7 Road. RE: bit 7 swaps the large spawns for a client table (`0x10aa5c27`) | bit 7 would replace the author's monsters: hide it. Conquest bits: what the client does with them is not traced; Erupe's weekly conquest does not read quest files | in the model; refuse bit 7 | none |
| Flags 3 | `body +0x99` | bit 0 No Reward Skills, 1 GSR to GR, 2 No Easy Drink, 3 No GP Skills, 4 Zenith (derived, done), 5 Interception, 7 No Sigils | Erupe clears bit 5 in every event entry, so it does nothing for us: hide it | in the model | none |
| Hardcore | RE part 75: class 3 (HR 100+) with condition note 109-113 or 118 gives the monsters' Hardcore data; Pax and Erupe call Flags 1 bit 1 "Fix HC" | sample: Flags 1 bit 1 in 636 files, note 109 in 208 | which of the two (or both) makes a quest Hardcore is not settled: test both in game | a "Hardcore" switch that sets what the test shows | none |
| Stars | `body +0x04` u8 | 1..8 (sample: all 8 used) | compared with the player's level (RE `0x10aadd30`). Low | in the model; range 1..8 | none |
| Rank limits | `body +0x4a` post min, `+0x4c` post max, `+0x4e` join min, `+0x50` join max, u16 each | 0..999; 0 max = no limit. Sample: max 0 in 4,985 of 5,000; post min equals join min almost always | RE traced only `+0x4e`. Low | add three u16 fields to `QuestCodec.Body` (round-trip test), ranges | none |
| Quest restriction | `body +0x2c` u8 (Pax reads a u16; `+0x2d` is 0 in every sampled file); indexes the condition message on the info page, some ids switch client rules (RE `0x10aeae10`, `0x10b0c170`) | Pax names 137 values: HR minima, weapon type limits (40-58), gender, item rules (59 ammo and bottles only, 60 no items, 94 no capture items), armour rules (62, 149-154), weapon classes (131-148), G rank only (138), GR guild requests (155-162), tickets and proofs consumed (99-108, 115-121, 171-176, 187), event code (95), Rasta/Partner/Partnya (182-186), no NPCs (189), once per character, departure and success limits (193-195). Pax has 239 for Light Bowgun, likely a typo for 47; it lists no name for 109-113 and 118 (Hardcore, above). Sample: 45 distinct values, 26% of files set one | ticket, proof, event-code and per-character limits depend on items or server counts we have not checked: leave them out. The rest are client rule checks | in the model; refuse ids outside the offered list | none for the offered list |
| Death count | `body +0x14` u32: zenny taken from the reward money per faint; with Flags 1 bit 3 the number of faints allowed (RE `0x10aa86c0`) | sample: 3 (1,467), 100, 2000, 3000 ... | tied to the reward money question (finding 1) | in the model | none |
| Map variant | `body +0x93` u8: a row of a client table, compared with 1 and 4 for special modes (RE) | sample: 0 in 4,829 of 5,000 | special modes not traced: do not offer yet | none | none |
| Mandatory objectives | `body +0x48` objective mode, with `body +0x02` bit 6 | 2 = clear on the main target (or a sub-target, by Pax's text), 3 = main + sub A, 4 = main + A + B; RE: 3 and 4 occur only with two or three objectives and bit 6, which folds the sub-target rewards into the main one (`0x10b126c0`) | low if kept consistent | in the model; check mode against the objectives in use and set bit 6 with modes 3 and 4 | none |

### Equipment restrictions (rows 33-38): arena quests and forced loadouts

| Field | Where | Values | Risk | API | Erupe |
|---|---|---|---|---|---|
| 6 records of 8 bytes | `body +0x5c`..`+0x8b`: u16 piece, u16 word 1, u16 word 2, u16 word 3. Order (Pax): legs, weapon, head, chest, arms, waist; RE confirms record 1 (+0x64) is the weapon | weapon (+0x64): low 14 bits weapon id, bit 15 weapon type, bit 14 off; word 1 bit 15 = record active (RE `0x10376ffc`); `body +0xc0` bit 1 becomes weapon id bit 14. Pax writes 0x8000 in the three words when a piece is set. Sample: 599 of 5,000 files force equipment, 324 all six slots, 65 the weapon only; word 1 is 0x8000 in most, 0x8000 plus another number (decoration or sigil, not traced) in the rest | **highest risk here**: the client looks the ids up in its equipment tables, so a wrong id can show the wrong piece or crash; Pax's README warns that forced equipment sometimes does not apply. Needs a short RE check (do the site catalog's ids, `/api/public/catalog/equipment`, match the file's ids and type bit?) and an in-game test | add `equipment[6]` and the u32 at `+0x8c` (Pax "unk", 0 or 1 in the sample) to the model; refuse an id not in the catalog for that slot; first version: no decorations (0x8000) | none |

Arena-style quests combine this with the supply box (present), a condition note such as 60 "No Items
Allowed" (chunk 3) and fixed rewards.

### Rewards and text extras (rows 5, 6, 24, 27, 28, 31, 32, 44)

| Field | Where | Values | Risk | API | Erupe |
|---|---|---|---|---|---|
| Reward 1/2/3 preview | `body +0xb0`, `+0xb2`, `+0xb4` u16 item ids (Pax: "in the quest listing"; RE has not traced a reader) | item ids, 0 = none. Sample: 70% of files set all three | low. But `withNoRewards` leaves them, so a custom quest would advertise items it never pays (owner question) | add `previewItems[3]` to the model; strip or keep per the owner's answer | none |
| Reward flag | `body +0x90` u8 | Pax: 0 first main item fixed, sub random; 1 first main and first sub fixed; 2 fixed rewards; 3 unknown, fixed; 4 no fixed rewards. Sample: 0 (3,246), 4 (766), 2 (691), 1 (262), 3 (35) | no effect while rewards are stripped | add to the model | none |
| Sub-target money | `body +0x18`, `+0x1c` | 0..999,999 | as finding 1 | in the model; same stripping rule as `+0x10` | none |
| Points | `header +0x4c`, `+0x50`, `+0x54`, `+0x58` | u32 | zeroed at submit already | none | none |
| Per-box slot limit | reward table | Pax: 24 for the first box, 4 for the others | what the client does past the limit is not traced | refuse more than the client's limit once RE confirms it | none |
| Reward JSON export/import | - | - | none | none | none |
| Text auto-fill | text slots 1-5 | objective lines from type, count and target; clear line from the objective mode; fail line from faint mode and time | none (text only) | none | none |

## Implementation plan

Five tasks, each one UI + API + tests, each shippable on its own. Recommended order is the numbering. Every
task: site check under `dev/` against a fake API (as `dev/check-quest-zenith.js`), API unit tests plus the
codec round-trip over the sample directory, `dev/check-quest-fields.js` and `docs/quest-fields.md` updated,
and the changelog when it goes live. API deploys and the one migration need the owner's go as usual.

1. **Listing: counter, mark, players, time of day, season, stars, mandatory objectives.** The owner's longest
   list and the lowest client risk. UI: a "Where it is listed" section (counter from the safe list, mark, the
   existing players control), Day/Night and Season pickers writing `body.seasonFlags` (keeping bit 6),
   Stars 1..8, and an "Objectives required" picker writing `body.objectiveMode` and bit 6. API: an additive
   migration (`quest_draft.listing jsonb`, `quest_submission.quest_type`, `mark`), the draft carries the
   listing, submit copies it, `publishSandboxQuest` writes `quest_type`, `mark` and `max_players` from it
   (upload path: defaults 18, 0, the file's players), validation of the lists, admin can change type and
   mark when approving. Tests: publish writes the row's values (Testcontainers), refused types, mode/bit 6
   consistency. Erupe: none.
2. **Monster tuning: size, size spread, difficulty, exact coordinates.** UI: size % 70..150, spread 0..4 with
   its percentages, a level picker (values the live files use, named where Pax and the class agree, others as
   numbers), X/Y/Z per large monster with "use the usual spot". API: tighter ranges, a level/class check,
   `QuestMaps.withPositions` keeps an author's position, bounds check per map. Monster variants other than
   Zenith stay out. Tests: positions kept and refused, range errors, round trip.
3. **Flags and restrictions: the quest flags, Hardcore, conquest, no Halk, rank limits, quest restriction,
   death count.** UI: the three flag bytes as named checkboxes (Flags 1 bit 3 and `+0xa0` derived from the
   class, Zenith derived as now, Road and Interception hidden), a Hardcore switch, rank limits, a quest
   restriction picker from a new `data/quest-condition-notes.json` (our own names, Pax as the cross-check,
   "(unconfirmed)" where one source), death count. API: add the three rank fields to `QuestCodec.Body`,
   refuse Flags 2 bit 7 and notes outside the list, derive the class-bound bits. Before shipping, test in game
   which of "Fix HC" and note 109 makes a quest Hardcore, and one conquest quest.
4. **Equipment restrictions (forced loadouts).** First a short RE step (one Ghidra run, `hvmhfz_re`): the
   six records' slots, the weapon id encoding, word 1 and `+0xc0` bit 1, and whether the catalog ids are the
   file's ids. Then UI: one picker per slot from `/api/public/catalog/equipment?slot=`, "No forced piece" by
   default. API: `equipment[6]` and `+0x8c` in the model, ids checked against the catalog. Tests: round trip,
   refused ids. Mark the section "test in game before submitting".
5. **Rewards and text extras.** Depends on the owner's answers below. Reward 1/2/3 pickers (auto-filled from
   the main reward group), reward flag, sub-target money, per-box limits, text auto-fill buttons, and the
   stripping fix: `withNoRewards` (or a sibling) zeroes the money per the owner's answer, after an RE or
   in-game check of what a zero faint pool does (fails at the first faint, or at once).

## Open questions for the owner

- Reward money: custom quests pay it today although the account page says they grant no zenny (finding 1).
  Zero it in the served copy (if a zero faint pool still lets players faint normally), cap it, or keep paying
  it and change the page?
- Reward 1/2/3 preview: show the author's items in the quest list even though custom quests pay no item
  rewards, or clear them in the served copy like the rewards?

Not in the chunks: the Erupe change for "any time of day / any season" (entry byte 7 bits 0x20 and 0x10)
and the `event_quests.flags` offset fix. A small Erupe task on its own, needing a live restart; only worth it
if authors ask for "Any". Reward JSON export/import: low value, skipped.
