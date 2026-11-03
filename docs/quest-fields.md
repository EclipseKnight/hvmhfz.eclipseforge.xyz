# Quest builder: every field, its bytes and how sure we are

Owner (2026-11-02): "quest class and shit like that are just a number, use all the information we know and
anything from RE to verify everything in the builder is right. also bytes for each field".

This page and `data/quest-fields.json` list every quest-file field the builder (`quest-editor.html`,
`js/quest-editor.js`) or the API's `QuestCodec` reads or writes: where it sits (struct and byte offset), how
many bytes it is, its type, the range that is safe, and the names of its values. The JSON is the one to
build on: the builder can take labels, ranges and value names from it instead of showing bare numbers. The
table below is the same data in a readable form. The second half lists what the builder gets wrong today,
with the evidence and the fix.

Edit `data/quest-fields.json` by hand, keep the table here in step, and run the check:

```
node dev/check-quest-fields.js          # exit 0 = all good, else one FAIL line per problem
```

It checks that every byte `QuestCodec.java` reads or writes is a field in the JSON with the same struct,
offset and size (it needs the API repo on this machine; `QUEST_CODEC=<path>` points it elsewhere, and it
says so when it skips that part), that every model property `js/quest-editor.js` assigns is a field, that
every bytes label the builder shows is right (each control names its field with `F("key")`; the check
makes sure the control then assigns that field, that every field marked `edits` has a label, and that
`bytesText` in `js/builder-ui.js` prints each field's struct, offset and size as the JSON has them), that every map, area, item and monster id the catalog
data uses has a name or is listed as a known gap, that the monster table has no id outside 1..176, that the
objective type names agree with `data/objective-types.json`, and that this page's table has a row for every
field with the JSON's offset and size.

## How to read it

- **struct** and **offset**: offsets are hex, counted from the start of the struct. Where each struct sits
  is in the JSON's `structs`: the header is the first 0xc0 bytes of the (decompressed) file, the body is the
  0x140 bytes the first header pointer names (0xc0 in every quest file), and the tables (start areas, start
  items, rewards, spawns, map record, text table) sit where their header pointer says. All values are
  little-endian.
- **bytes**: the whole field. An array shows its count and the size of one element.
- **range**: what is safe to write. Where the client code gives no limit it is the range the quest files
  use, and the JSON's `seen` says so; outside it is untested, not known to break.
- **builder**: `edits` (an input exists), `shows`, `carried` (in the model, round-trips untouched),
  `should edit` (must follow a field the builder edits, and does not), `not in the model` (the codec keeps
  these bytes raw).
- **confidence**: `confirmed` = offset, size and meaning agree in two or more independent sources;
  `one source` = offset and size are certain (the codec reproduces every quest file byte for byte and the
  client trace reads them there) but the meaning rests on one source; `guess` = no source shows the meaning.
  Value names can be less sure than the field: the JSON says so in `valuesConfidence` (quest class).
- Every entry in the JSON names its sources as file and line.

### Sources

| Short name | What | Where |
|---|---|---|
| RE | client trace of every quest field (83 fields, decompiled readers) | `hvmhfz_re` `docs/quest-files.md`, `data/quest_fields.tsv` (private repo) |
| client reward routine | the decompile of `0x10ab79e0`, which pays reward groups | `/root/work/re-mhfz/raw/quest-fields/dec/10ab79e0.c` |
| codec | the API's parser and writer | `hvmhfz_rest_api` `QuestCodec.java`, `QuestTables.java`, `QuestBlank.java` |
| Erupe | `loadQuestFile`, `makeEventQuest` and the flag-bit comments | `Erupe` `server/channelserver/handlers_quest.go`, branch `erupe-target-upgrade` |
| ReFrontier | FrontierDataTool's reader of the client's built-in quest table, same body layout | `frontier_tools/ReFrontier-master/FrontierDataTool/Program.cs:505-551`, `Structs.cs:11-70` |
| 010 template | the ENUMERATE_QUEST template; its full-decode branch names body fields | github.com/Mezeporta/010Templates `Build/BuildEnumerateQuest.bt` (GPL-3; names only, nothing copied) |
| overlay | MHFZ Overlay 0.3.0's ObjectiveTypeList and RanksBandsList, where `data/objective-types.json` and `data/rank-names.json` came from | `frontier_tools/MHFZ_Overlay_v0.3.0` |
| survey | every field the builder touches, read from the 13,867 local quest files (`frontier_tools/bin/quests`, decoded with `hvmhfz_re` `build/jkr_cli`) on 2026-11-02 | the script is `/root/work/site-quest-fields/survey.py` (reads game files, so it stays out of this public repo); the counts are quoted in the JSON's `seen` and `source` |

Pax's quest editor (`Mhfz-Quest-Editor.exe`) was looked at but gives nothing readable: its interface is
packed inside the binary. Ghidra was not needed; the RE notes and the existing decompiles answered every
question.

## The fields

### Basics

| Key | Label | Struct | Offset | Bytes | Type | Range | Values | Builder | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| `header.questClass` | Quest class (the copy the client uses) | header | 0x5c | 1 | u8enum | 0..9 | 0 = Low rank; 1 = High rank; 2 = Exercise / trial; 3 = HR 100 and up; 7 = G rank; 8 = Hunting Road / Sky Corridor; 9 = Supremacy (names: one source) | edits | confirmed |
| `body.seasonFlags` | Season and day/night | body | 0x02 | 1 | bitfield |  | bits 0, 1, 2, 3, 4, 6 (JSON) | carried | confirmed |
| `body.level` | Quest level (stars) | body | 0x04 | 1 | u8 | 1..8 |  | carried | confirmed |
| `body.monsterGroup` | Monster group (list filter) | body | 0x05 | 1 | u8 | 0..6 |  | carried | one source |
| `body.questClass` | Quest class | body | 0x0a | 1 | u8enum | 0..9 | 0 = Low rank; 1 = High rank; 2 = Exercise / trial; 3 = HR 100 and up; 7 = G rank; 8 = Hunting Road / Sky Corridor; 9 = Supremacy (names: one source) | edits | confirmed |
| `body.maxHunters` | Max hunters | body | 0x0b | 1 | u8 | 0..4 | 0 = 4 hunters; 1 = solo (skips the multi-hunter paths); 2 = 2 hunters; 3 = 3 hunters; 4 = 4 hunters | edits | confirmed |
| `body.timeLimit` | Time limit | body | 0x20 | 4 | u32 | 1800..90000 |  | edits | confirmed |
| `body.conditionNote` | Condition note id | body | 0x2c | 1 | u8 |  | 0 = none | carried | one source |
| `body.questId` | Quest id | body | 0x2e | 2 | u16 | 0..65535 | 0 = new quest: the server assigns the id at submit | shows | confirmed |
| `body.rank` | Minimum hunter rank to join | body | 0x4e | 2 | u16 | 0..999 |  | carried | confirmed |
| `body.iconLabelId` | Required item | body | 0x94 | 2 | u16enum |  | 0 = none; item-ids.json | edits | confirmed |
| `body.iconLabelCount` | Required item count | body | 0x96 | 1 | u8 | 0..255 | 0 = line left out | edits | one source |
| `body.hrBounds` | HR / SR bounds (not in the codec) | body | 0x4a | 16 (8 x 2) | u16 |  |  | not in the model | guess |

### Map

| Key | Label | Struct | Offset | Bytes | Type | Range | Values | Builder | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| `header.randomStartArea` | Random start area list | header | 0x5d | 1 | u8 | 0..255 | 0 = every player starts in the start area (header +0x04) | carried | one source |
| `header.zoneAreaCount` | Areas of the map (zone lists) | header | 0x7d | 1 | u8 |  |  | carried | one source |
| `header.gatheringAreaCount` | Areas of the map (gathering lists) | header | 0x7e | 1 | u8 |  |  | carried | one source |
| `header.triggerAreaCount` | Areas of the map (trigger lists) | header | 0x7f | 1 | u8 |  |  | carried | one source |
| `body.mapId` | Map (stage) | body | 0x24 | 2 | u16enum |  | map-ids.json | edits | confirmed |
| `body.mapIdHigh` | Map id, high half | body | 0x26 | 2 | u16 |  |  | carried | one source |
| `startAreas[].areaId` | Start area | startArea | 0x00 | 2 | u16enum |  | area-ids.json (global area ids); map-areas.json gives the base camp per map | edits | confirmed |
| `map.mapId` | Map record: map id | mapRecord | 0x00 | 4 | u32enum |  | map-ids.json | edits | confirmed |
| `map.areaId` | Map record: base camp area | mapRecord | 0x04 | 4 | u32enum |  | area-ids.json | edits | one source |

### Objectives

| Key | Label | Struct | Offset | Bytes | Type | Range | Values | Builder | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| `header.eventKind` | Extra condition: event kind | header | 0x80 | 2 | u16 |  | 0 = none | carried | one source |
| `header.eventMonster` | Extra condition: monster | header | 0x82 | 2 | u16 |  | monster-ids.json | carried | one source |
| `header.eventThreshold` | Extra condition: threshold | header | 0x84 | 2 | u16 |  |  | carried | one source |
| `body.objective0.type` | Objective type (main target) | body | 0x30 | 4 | bitfield |  | 12 named values (JSON) | edits | confirmed |
| `body.objective0.target` | Objective target (main target) | body | 0x34 | 2 | u16enum |  | monster-ids.json when type bit 0 or bit 2 is set; item-ids.json when bit 1 is set | edits | confirmed |
| `body.objective0.count` | Objective count (main target) | body | 0x36 | 2 | u16 | 0..65535 |  | edits | confirmed |
| `body.objective1.type` | Objective type (sub-target A) | body | 0x38 | 4 | bitfield |  | 12 named values (JSON) | edits | confirmed |
| `body.objective1.target` | Objective target (sub-target A) | body | 0x3c | 2 | u16enum |  | monster-ids.json when type bit 0 or bit 2 is set; item-ids.json when bit 1 is set | edits | confirmed |
| `body.objective1.count` | Objective count (sub-target A) | body | 0x3e | 2 | u16 | 0..65535 |  | edits | confirmed |
| `body.objective2.type` | Objective type (sub-target B) | body | 0x40 | 4 | bitfield |  | 12 named values (JSON) | edits | confirmed |
| `body.objective2.target` | Objective target (sub-target B) | body | 0x44 | 2 | u16enum |  | monster-ids.json when type bit 0 or bit 2 is set; item-ids.json when bit 1 is set | edits | confirmed |
| `body.objective2.count` | Objective count (sub-target B) | body | 0x46 | 2 | u16 | 0..65535 |  | edits | confirmed |
| `body.objectiveMode` | Objective mode | body | 0x48 | 1 | u8enum |  | 2 = main target only (12,924 files); 3 = two objectives (703 files); 4 = three objectives (240 files) | carried | one source |
| `body.fourthObjectiveType` | Fail objective type | body | 0x54 | 4 | bitfield |  |  | carried | one source |
| `body.fourthObjectiveTarget` | Fail objective target | body | 0x58 | 2 | u16 |  |  | carried | one source |
| `body.fourthObjectiveCount` | Fail objective count | body | 0x5a | 2 | u16 |  |  | carried | one source |

### Monsters

| Key | Label | Struct | Offset | Bytes | Type | Range | Values | Builder | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| `header.monsterSize` | Large-monster size (percent) | header | 0x44 | 2 | u16 | 1..65535 |  | carried | one source |
| `header.sizeClass` | Size spread class | header | 0x46 | 1 | u8 | 0..4 | 0 = 100-100%; 1 = 100-105%; 2 = 95-110%; 3 = 87-114%; 4 = 85-125% | carried | one source |
| `header.monsterLevel` | Large-monster level | header | 0x48 | 1 | u8 | 0..255 |  | carried | one source |
| `header.secondMonsterLevel` | Second monster level | header | 0x61 | 1 | u8 |  |  | carried | one source |
| `header.specialFight` | Special fight selector | header | 0x62 | 2 | u16 |  | 0 = off; 2 = monster 0x5c behaviour; 3 = monster 0x5b behaviour | carried | one source |
| `body.iconMonsters[]` | Quest info monster icons (5) | body | 0xb9 | 5 (5 x 1) | u8enum | 0..176 | 0 = end of the list; monster-ids.json | edits | confirmed |
| `smallSpawnGroupOffsets[]` | Small-monster group offsets | smallSpawnSlot | 0x00 | 4 | u32 |  |  | carried | confirmed |
| `largeSpawnAreas[].areaId` | Large spawn record number | spawnArea | 0x00 | 4 | u32 | 1..1 |  | carried | one source |
| `smallSpawnGroups[].areas[].areaId` | Small spawn area | spawnArea | 0x00 | 4 | u32enum |  | area-ids.json | shows | one source |
| `largeSpawnAreas[].reserved` | Spawn area reserved | spawnArea | 0x04 | 4 | u32 |  |  | carried | confirmed |
| `largeSpawnAreas[].monsterIdsOffset` | Monster id list offset | spawnArea | 0x08 | 4 | u32 |  | 0 = none | carried | one source |
| `largeSpawnAreas[].spawnOffset` | Spawn records offset | spawnArea | 0x0c | 4 | u32 |  |  | carried | confirmed |
| `largeSpawnAreas[].monsterIds[]` | Monster id list | monsterIdList | 0x00 | 20 (5 x 4) | u32enum |  | 0 = none (padding); monster-ids.json | carried | one source |
| `largeSpawnAreas[].spawns[].monsterId` | Monster | spawnRecord | 0x00 | 2 | u16enum | 1..176 | 65535 = end of the records; monster-ids.json | edits | confirmed |
| `largeSpawnAreas[].spawns[].count` | Spawn count | spawnRecord | 0x04 | 1 | s8 | 0..99 |  | edits | confirmed |
| `largeSpawnAreas[].spawns[].areaId` | Spawn area | spawnRecord | 0x08 | 2 | u16enum |  | area-ids.json | edits | confirmed |
| `largeSpawnAreas[].spawns[].position` | Spawn position | spawnRecord | 0x20 | 12 (3 x 4) | f32 |  |  | carried | one source |
| `largeSpawnAreas[].spawns[].arrival` | Random arrival spot flag (not in the codec) | spawnRecord | 0x0b | 1 | u8 |  | 1 = start at a random spot of the area (header +0x34) | not in the model | one source |

### Rewards

| Key | Label | Struct | Offset | Bytes | Type | Range | Values | Builder | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| `header.objective0Points` | Points for the main target | header | 0x4c | 4 | u32 |  |  | carried | one source |
| `header.fallbackPoints` | Points when not cleared | header | 0x50 | 4 | u32 |  |  | carried | one source |
| `header.objective1Points` | Points for sub-target A | header | 0x54 | 4 | u32 |  |  | carried | one source |
| `header.objective2Points` | Points for sub-target B | header | 0x58 | 4 | u32 |  |  | carried | one source |
| `body.zenny` | Contract fee (zenny) | body | 0x0c | 4 | u32 | 0..999999 |  | edits | confirmed |
| `body.rewardMoney` | Main reward money | body | 0x10 | 4 | u32 | 0..999999 |  | edits | confirmed |
| `body.faintPenalty` | Faint penalty | body | 0x14 | 4 | u32 |  |  | carried | confirmed |
| `body.objective1Money` | Sub-target A reward money | body | 0x18 | 4 | u32 |  |  | carried | confirmed |
| `body.objective2Money` | Sub-target B reward money | body | 0x1c | 4 | u32 |  |  | carried | confirmed |
| `body.gRankPoints[]` | G rank points (3) | body | 0xa4 | 12 (3 x 4) | u32 |  |  | not in the model | guess |
| `startItems[].itemId` | Supply item | startItem | 0x00 | 2 | u16enum |  | 0 = empty slot; item-ids.json | edits | one source |
| `startItems[].count` | Supply item count | startItem | 0x02 | 2 | u16 | 1..99 |  | edits | one source |
| `rewardGroups[].groupId` | Reward group condition | rewardGroup | 0x00 | 2 | u16enum |  | 14 named values (JSON) | edits | one source |
| `rewardGroups[].reserved` | Reward group reserved | rewardGroup | 0x02 | 2 | u16 | 0..0 |  | carried | confirmed |
| `rewardGroups[].entryOffset` | Reward entries offset | rewardGroup | 0x04 | 4 | u32 |  |  | carried | confirmed |
| `rewardGroups[].entries[].weight` | Reward chance (weight) | rewardEntry | 0x00 | 2 | u16 | 1..100 | 65535 = end of the group (never an entry) | edits | confirmed |
| `rewardGroups[].entries[].itemId` | Reward item | rewardEntry | 0x02 | 2 | u16enum |  | item-ids.json | edits | confirmed |
| `rewardGroups[].entries[].count` | Reward item count | rewardEntry | 0x04 | 2 | u16 | 1..99 |  | edits | confirmed |

### Text

| Key | Label | Struct | Offset | Bytes | Type | Range | Values | Builder | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| `body.textTableOffset` | Text table offset | body | 0x28 | 4 | u32 |  |  | carried | confirmed |
| `texts[].rawOffset` | Text offset | textTable | 0x00 | 4 | u32 |  |  | carried | confirmed |
| `texts[0].text` | Title | text | slot | 192 | string (Shift-JIS, NUL-terminated) |  |  | edits | confirmed |
| `texts[1].text` | Main target | text | slot | 320 | string (Shift-JIS, NUL-terminated) |  |  | edits | one source |
| `texts[2].text` | Sub-target A | text | slot | 96 | string (Shift-JIS, NUL-terminated) |  |  | edits | one source |
| `texts[3].text` | Sub-target B | text | slot | 96 | string (Shift-JIS, NUL-terminated) |  |  | edits | one source |
| `texts[4].text` | Clear condition | text | slot | 320 | string (Shift-JIS, NUL-terminated) |  |  | edits | one source |
| `texts[5].text` | Fail conditions | text | slot | 160 | string (Shift-JIS, NUL-terminated) |  |  | edits | one source |
| `texts[6].text` | Client | text | slot | 160 | string (Shift-JIS, NUL-terminated) |  |  | edits | confirmed |
| `texts[7].text` | Description | text | slot | 768 | string (Shift-JIS, NUL-terminated) |  |  | edits | confirmed |

### Other

| Key | Label | Struct | Offset | Bytes | Type | Range | Values | Builder | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| `header.pointers[]` | Table offsets (17) | header | 0x00 | 68 (17 x 4) | u32 |  | 17 named values (JSON) | carried | confirmed |
| `header.gateMode` | Gate mode | header | 0x5e | 1 | u8 |  | 0 = off; 2 = re-open after header.gateKills kills of header.gateMonster; 3 = re-open at quest state 5 | carried | one source |
| `header.gateMonster` | Gate monster | header | 0x5f | 1 | u8 |  | monster-ids.json | carried | one source |
| `header.gateKills` | Gate kill count | header | 0x60 | 1 | u8 |  |  | carried | one source |
| `header.triggerGate` | Trigger gate | header | 0x74 | 2 | u16 |  | 3 = copy the two trigger records; 4 = copy the two trigger records | carried | one source |
| `header.dropListCount` | Drop list count | header | 0x78 | 2 | u16 |  |  | carried | one source |
| `header.triggers` | Two trigger records | header | 0x88 | 24 | bytes |  |  | carried | one source |
| `body.flags` | Body flags (u32 view of +0x00..+0x03) | body | 0x00 | 4 | bitfield |  | bits 16, 18, 19, 21, 22, 26 (JSON) | carried | one source |
| `body.flagByte` | Quest flag bits | body | 0x03 | 1 | bitfield |  | bits 0-1, 2, 3, 4, 5, 6 (JSON) | carried | one source |
| `body.listFlags` | Quest list row flags | body | 0x06 | 1 | bitfield |  | bits 0, 2, 6, 7 (JSON) | carried | one source |
| `body.variantIndex` | Variant row | body | 0x93 | 1 | u8 |  |  | carried | one source |
| `body.variantFlags1` | Variant flags 1 | body | 0x97 | 1 | bitfield |  | bits 0, 1, 2, 3, 7 (JSON) | carried | one source |
| `body.variantFlags2` | Variant flags 2 | body | 0x98 | 1 | bitfield |  | bits 0, 1, 2, 3, 4, 5, 6, 7 (JSON) | carried | one source |
| `body.variantFlags3` | Variant flags 3 | body | 0x99 | 1 | bitfield |  | bits 0, 1, 2, 3, 4, 5, 6, 7 (JSON) | carried | confirmed |
| `body.specialListTab` | Special list tab | body | 0xa0 | 2 | u16 |  | 0 = tabs 1-4; 1 = tab 5 only | carried | one source |
| `body.infoNumber` | Info page 2 number | body | 0xbe | 2 | u16 |  |  | carried | guess |
| `body.flagsAtC0` | Body flags at +0xc0 | body | 0xc0 | 4 | bitfield |  | bits 1 (JSON) | carried | one source |
| `body.equipment[]` | Forced equipment (6 records) | body | 0x5c | 48 (6 x 8) | bytes |  |  | not in the model | one source |

### Text slot meanings

The RE notes say the client indexes the 8 strings 0-7 but did not trace what each means. The meanings below
come from reading the strings of sampled quest files (one per 1,500) and from ReFrontier's names for the
first four, so slots 0, 6 and 7 are `confirmed` and the rest `one source`:

| Slot | Meaning | Example (quest 12002d0) | Bytes in the files | Room in the blank |
|---|---|---|---|---|
| 0 | title (list line, then name) | ≪密林探索≫ / 青き２つの影 | 17..55 | 192 |
| 1 | main target line | ドスランポス２頭の狩猟 | 6..28 | 320 |
| 2 | sub-target A line, なし when none | 肉食竜の卵４個の納品 | 4..28 | 96 |
| 3 | sub-target B line, なし when none | ランポス１２頭の討伐 | 4..28 | 96 (1 in practice, see below) |
| 4 | clear condition | メインターゲット、もしくはサブターゲットＡかＢの達成 | 16..53 | 320 |
| 5 | fail conditions | 報酬金ゼロ / タイムアップ | 12..53 | 160 |
| 6 | client | 大老殿ギルド | 4..18 | 160 |
| 7 | description | the request text | 6..246 | 768 |

## What the builder gets wrong

Each item: what happens, the evidence, and the fix. Status (2026-11-02, branch `site-builder-ux`): items
1-4 and 6-14 are fixed in the builder as described (item 2 with the API: since `a3aca9a`, live 2026-11-02, the
server gives a new quest the per-area tables of its map, and the builder offers only the maps
`GET /api/account/quests/maps` lists), item 5 by the builder redesign (`data/map-areas.json` now holds every
area of each map), item 15 before. The server-side range check of item 8 is in the API since `a3aca9a`; the
builder shows its 400 messages next to the field they name. The builder also shows every input's offset and
size, and names every value this file names. What is left of "The codec" below is gap 4.

1. **Quest class is written to the copy the client hardly reads.** The builder sets `body.questClass`
   (+0x0a). The client's class getter `0x10aa1520` returns `header.questClass` (+0x5c) to about 400 callers;
   the body copy is compared once (RE body +0xa and header +0x5c). The two are equal in 13,867 of 13,867
   files. Fix: set both, `model.header.questClass = v` next to `b.questClass = v`. The field is also a bare
   number: offer the 7 values 0, 1, 2, 3, 7, 8, 9 with the names from the JSON (Low rank, High rank,
   Exercise / trial, HR 100 and up, G rank, Hunting Road / Sky Corridor, Supremacy). Those names come from
   the quest lists each class appears in and the min-HR values (`one source`); the client code names none.
2. **Changing the map leaves the map record and the per-area tables on the blank's map.** The builder sets
   `body.mapId` only. The map record (`map.mapId`, header pointer 9) is what indexes the client's per-map
   area lists, and equals the body's map id in 13,849 of 13,867 files; the builder never sets it. Worse, the
   per-area tables (trigger zones +0x1c, area rectangles +0x20, gathering points +0x28, area zones +0x2c) and
   their counts (+0x7d..+0x7f) have one slot per area of the map, and they stay those of the blank's map 26
   (Great Forest, day, 9 areas). A map with more areas makes the client read slots that do not exist. Fix,
   in order: until the API has a template per map, offer only map 26 (or warn that other maps are untested);
   always set `model.map.mapId = body.mapId`; longer term the API swaps in the per-area tables of a real
   quest on the chosen map.
3. **The base camp is not kept with the start area.** `map.areaId` (the map record's area, the base camp)
   equals the start area in 12,979 of 13,867 files; the builder changes the four start areas and not it.
   Fix: set `model.map.areaId` with the start area.
4. **New monsters go to "area 1", which is not an area.** `addMonster` creates the large spawn record with
   `areaId: 1` (right: that field is 1 in every file, it is a record number, not an area) and then gives the
   monster `areaId: area.areaId || 1`, so the monster's area is 1. The spawn record's area (+0x08) is a real
   area id in every file (3..449, never 1). The heading "Large spawns · area 1" shows the record number as an
   area. Fix: default a new monster's area to an area of the chosen map, and drop "area N" from the heading.
5. **The spawn area list offers only the base camp.** `areaOptions` takes its list from
   `data/map-areas.json`, which holds one area per map (the base camp, `{"26": [224]}`), so a large monster
   can only be put in the base camp. Fix: a full area list per map. The quest files give one (the areas the
   spawn records of each map use); the client also keeps one (count table `0x11864828`, lists `0x11a3fa28`,
   RE "map and areas"), which an RE task could extract into `map-areas.json`.
6. **Reward groups the builder adds are never paid.** It numbers groups 0, 1, 2 (`groupId:
   model.rewardGroups.length`). The client's reward routine `0x10ab79e0` treats the group id as the
   condition for paying it: 0x8000 is always paid, 0x8001 is the main target, 0x8002 and 0x8003 call the same
   objective check (sub-targets A and B, medium), 0x8004-0x8006 follow the header +0x80 counter, 0x29-0x2f
   are special conditions, and ids 0..10 fall to the default case and are skipped. The quest files use only
   0x8000-0x8005 and 41-47. Fix: a condition picker with the JSON's names, defaulting the first group to
   0x8001 (32769). Submitted test quests are served with rewards emptied, so this shows only once a quest is
   published.
7. **Reward weights are percentages and nothing says so.** The weights of a group add up to 100 in 22,324 of
   22,342 groups. Fix: show the group's sum and warn when it is not 100.
8. **Ranges are too wide everywhere, and the server does not check them.** Every number input has `min=0`
   and no max, and the API writes the model as given, cutting values to the field's width without a message
   (`(byte) value` in `QuestCodec.Writer`). Concretely:
   - spawn count is a **signed** byte: 128 and up becomes negative. Files use 1 or 2 for large monsters,
     0..99 for small ones;
   - max hunters reads only the low 3 bits: 8 means 4 hunters, 9 means solo. Use 1..4 (the files use 0 = 4
     and 1 = solo; the blank writes 4, which no file has);
   - item counts (supply box, rewards) are 1..99 in every file; required item count is a byte (0..255);
   - zenny and reward money are u32; the files stop at 999,999 (shown as "%dz" on the info page);
   - time limit: files use 10..50 minutes; 0 is accepted by the builder and untested;
   - monster ids 1..176 (u16 in spawns, u8 in the icons); item ids are the keys of `item-ids.json`.
   Fix: take `range` from the JSON for each input, and have the API refuse out-of-range values
   (`QuestDraftController` save) instead of cutting them.
9. **Text slot labels 4 and 2-3 are off.** Slot 4 is labelled "Main objective · the line the quest card
   leads with"; it is the clear condition ("Complete the main target"). The main target line is slot 1. Slots
   2 and 3 are sub-target lines, not sub-quests. The API's `QuestModel.objective()` returns slot 4 and
   inherits the same mistake (a name only; no bytes are wrong). Fix: labels from the JSON (`texts[N].text`).
10. **Sub-target B always moves to the end of the file.** In the blank, slot 3 is the last string, and the
    codec sizes the last string by its own NUL, so its room is 1 byte, not the 96 the template reserves
    (`QuestBlank.TEXT_ROOMS`, `QuestCodec.parseTexts`). Any text there is appended. Harmless, but the
    builder shows "0 / 1 bytes".
11. **Three objective types appear in no quest file.** The dropdown offers all 12 names from the overlay;
    16 (Esoteric Action), 131072 (Slay Total) and 262144 (Slay All) are used by none of the 13,867 files and
    what their target means is unknown. Fix: mark them untested or leave them out.
12. **The requirement item hint says the quest consumes it.** The client shows the item and count on the
    info page (`0x10939053`); whether it is taken at the start is not traced. Fix: "required to accept,
    shown on the quest info page". Item and count must be set together: both are 0 or both non-zero in every
    file.
13. **An icon after an empty icon is never shown.** The first 0 ends the list of 5 (`< 1 ends`). Fix: fill
    icons from the left.
14. **Objectives are called 1, 2, 3.** They are the main target, sub-target A and sub-target B, and their
    rewards are body +0x10, +0x18 and +0x1c. Fix: those labels.
15. **The monster list offered a monster called ")".** `data/monster-ids.json` had an id 177 named ")",
    which is not a monster (Erupe's table ends at 176, King Shakalaka). **Fixed here**: the entry is removed.

What the builder gets right, checked: every offset and size it shows (34 labels, checked by the script), the time
limit unit (1,800 ticks a minute, every file a multiple of 1,800), zenny as the contract fee (RE, ReFrontier
`fee`, 010 `Fee`), reward money, the four equal start areas, the 40-slot supply box with 0 = empty, the
monster/item switch of the objective target (bit 1 without bit 0 = item), and Shift-JIS byte counting.

## The codec

No wrong offset or size: every byte `QuestCodec` reads or writes matches the RE notes and this reference
(checked by the script), and it reproduces the quest files byte for byte. The gaps found for new quests,
all in the API repo; 1-3 and 5 are fixed in `hvmhfz_rest_api` `a3aca9a` (live since 2026-11-02 20:03 UTC):

1. **Monster id list for a new large-monster record. Fixed.** The large spawn record's +0x08 points to a list
   of 5 u32 monster ids and a 0xffffffff end (`largeSpawnAreas[].monsterIds[]`). In every sampled file
   (2,774 of 2,774, one in five) the list is exactly the distinct monster ids of the record's spawns, padded
   with 0 to five entries. `QuestTables.pack` now writes that list for every large area of a new quest and
   points `monsterIdsOffset` at it; a sixth monster in one area is refused with 400 ("Large monster area 1
   has 6 different monsters ..."). What the client does with the list is not traced.
2. **Spawn positions. Fixed.** The position (3 f32 at +0x20) is a model field, `spawns[].position`, read and
   written by the codec. For a new quest `QuestMaps` sets each large monster's position to that of a real
   quest's large monster in the same map and area; where none has one it keeps the model's (0, 0, 0 for a new
   monster).
3. **Duplicated fields kept in step. Fixed.** `QuestModelWriter.prepare` copies `body.questClass` into
   `header.questClass`, `body.mapId` into `map.mapId` and the first start area into `map.areaId`.
4. **Overlapping views of the same bytes. Open.** `body.flags` (u32 at +0x00) covers `body.seasonFlags`
   (+0x02) and `body.flagByte` (+0x03). An editor that changes one without the other gets "Two fields
   disagree about byte 0x..." on save. Edit one view only (the bytes, not the u32).
5. **Range validation. Fixed** (builder item 8). `QuestModelRanges` refuses a value outside this file's range
   with 400 and the field's name, for example `Out of range: body.timeLimit is 0; allowed 1800..90000.`; a
   field with no range here is checked against its width.

## Still unknown, or sources disagree

| Field | What is open |
|---|---|
| quest class value names | the client tests 3, below 7, 8 and 9 but names nothing; the names are from the catalog lists |
| `body.listFlags` (+0x06) | RE: bit tests (row colour, two lookups switched off); ReFrontier: an enum `courseType` (6 premium, 18 free?, 19 HLC?, 20 extra). The files hold 18, 19, 20, which fits both |
| `body.faintPenalty` (+0x14) | RE and ReFrontier (`zennyKo`): faint penalty. The 010 template calls it RewardSubA and shifts the next two by one; the template's full-decode branch is for another layout |
| `body.zenny` (+0x0c) | the RE notes left "contract fee or base reward" open; ReFrontier (`fee`) and the 010 template (`Fee`) both say fee, so it is confirmed |
| `body +0x4a..+0x59` | the 010 template: MinHR, MaxHR, MinJoinHR (+0x4e), MaxJoinHR, SR bounds. Only +0x4e is traced (a minimum against the party and the player); +0x54..+0x5b are the fail objective in the trace. Not in the codec |
| `body +0xa4..+0xaf` | ReFrontier reads three G rank point values there in the client's own quest table; not traced for quest files, not in the codec |
| `body.infoNumber` (+0xbe) | printed on info page 2, label is panel art; 0 in every file |
| `body.variantFlags1..3` bit names | Erupe's comments only, except +0x99 bit 5 (Interception), which the client tests 622 times |
| `body.seasonFlags` | Erupe names the bits of this byte (Spring, Warm, Cold, Day, Night) but edits the next byte, +0x03 (RE "Erupe's offsets") |
| objective types 16, 131072, 262144 | overlay names only; no quest file uses them |
| reward groups 0x8002 / 0x8003 | the code calls the same check for both; sub-target A and B is inferred from their place |
| reward weights not adding up to 100 | 18 groups in the files; what the client draws then is not traced |
| `body.rank` vs `data/rank-names.json` | the overlay's rank bands are other numbers (100 is not one of them); `rank-names.json` is not used by the builder and does not name this field |
| `header.monsterLevel`, `header.objective*Points` | what the level rows scale and the unit of the points are not traced |
| monster ids 29, 86, 87, 88, 134, 135, 138 | used by small spawns (29 in 65,993 records) and 86 by 6 objectives; Erupe has only placeholders (Mon29 ...), no source names them |
| map names marked `likely` or `guess` | `map-ids.json` names every map from its areas' names and the quests on it, not from the client's own map name table (not read yet); see `docs/maps.md` |
| area names marked `(guess)` | 126 areas of arenas, towers, forts, Raviente and other stages were named from the overlay's table on 2026-11-02 (`docs/maps.md`, "Area names"); where no table says it, or the overlay looks wrong, the name ends in `(guess)`. The JSON's `unnamedAreaIds` is empty now |

## Catalog data errors found on the way

`data/quests.json` (the quest catalog, not the builder) used to name monsters from the English objective:
other spellings than the field guide (Orugaron, Kuarlusepusu, Espinas Rare Species ...), subspecies lost
(リオレウス希少種 listed as "Azure Rathalos", ゲリョス亜種 as "Gypceros") and two plain errors ("Dahren Mohran"
on 37 Harudomerugu quests, "Gargwa" on 8 Anteka quests); 1,566 quests listed none. Fixed on 2026-11-02:
`dev/make-quest-monsters.py` writes every quest's monsters from its Japanese objective, in the field guide's
names (`data/monsters/index.json`, whose `ids` give each one's monster ids), and
`dev/check-catalog-monsters.js` checks that each has a monster page. The JSON's `monsterNameAliases` is
empty now. Shagaru Magala (id 164, 12 quests) has no guide page yet.
