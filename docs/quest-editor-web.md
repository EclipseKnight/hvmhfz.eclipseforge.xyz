# Quest editor: full web port

Owner decision (2026-10-29): the editor lives entirely on the site, not as a desktop app with an upload
button. Pax's editor is the reference for behaviour, our RE notes are the reference for the format, and the
other session can cross-check the two. This supersedes the "upload a .bin" first step in
`docs/quest-editor.md`.

## The decision that matters: bytes are made on the server

The browser must never assemble a quest binary. Split it:

- **Server (Java, in the API)**: `QuestCodec.parse(byte[]) -> QuestModel` and
  `QuestCodec.serialize(QuestModel) -> byte[]`. One implementation, unit tested, used by upload, by the
  editor's save, by validation and by the test-token service.
- **Browser**: a form and table editor over the JSON `QuestModel`. It posts a model, gets back a model plus
  validation errors, and never sees a byte array unless it downloads the finished file.

Why: Shift-JIS encoding, NUL padding, slot sizes and offset tables are exactly what a browser gets subtly
wrong, and a wrong byte is a client crash rather than a validation message. One serializer also means the
code that validates an upload is the code that produces the deployed file.

## The regression test that makes this safe

Round-trip **every quest file in `bin/quests` and `bin/events`**: parse, serialize, compare byte for byte.
The title rewrite already proved exact slot maths on 52,807 files, so a correct codec should reproduce all
55,323 files exactly. Every file that differs names the field the codec got wrong. Run it in CI and after
every codec change; it is the difference between "the editor probably works" and "it round-trips the live
quest set".

Fixtures for the hard cases: a file whose title and objective share one string, one with multiple
objectives, one with the `d` and `n` variants, one with a large reward table.

## Feature order, each shippable on its own

1. **Metadata and text**: category, title, objective, client, description, fail conditions, time limit,
   zenny and reward money, map and area. The catalog already displays these, so the preview is free.
2. **Monsters and spawns**: large and small spawn records with count, area, size class and level.
3. **Rewards**: groups with weights, item ids and counts, plus start items.
4. **Flags and objectives**: objective modes, required flags, sub-targets.
5. **Script opcodes**: last, since parts of the RE notes are only medium confidence.

Each step moves the codec, the round-trip test and the editor form together. A step is done when the
round-trip still passes and the editor can change that section without touching another.

## Editor UX

- Open from the quest catalog or the account page: "Create a quest" starts a new one. Live quests are not
  opened, copied or edited from this page at all.
- Panels follow the feature order above and the site's existing layout language.
- A preview panel shows how the quest will read in the catalog and on the quest page.
- "Save draft", "Test" and "Publish to events" are three distinct actions; drafts never touch live files.
- Validation runs on every save and shows slot usage for the title and text fields, because overlong text is
  the most common authoring mistake.

## Cross-checking with the RE project

The RE docs (`quest-files.md`, `channel-login.md`, `data/quest_cycle_steps.tsv`) describe header offsets,
body fields, reward groups, spawn records and the script. For each editor section the codec docs should
carry a short table: field, offset, width, the line in the RE notes, and the fixture that covers it. That is
what lets the other session verify a field against the disassembly without re-deriving the layout, and it
turns disagreements into a diff instead of a silent bug.

## Test deployment

Unchanged, and it depends on the room pin built for Roads: a token per account, a reserved quest id block,
token-gated serving, no item rewards (the money is paid; owner, 2026-11-09) and no board entries, automatic expiry.

## Safety

Edited or uploaded quests are client-facing content. Cap sizes, parse strictly, refuse to serialize a model
that fails validation, and only serve a test file to rooms holding a valid token. The quest set itself is ours, written for
this server, so publishing, downloading and editing those files is ours to allow; the token rule is about
unfinished work and privacy, not ownership.

## Shipped (30 Oct 2026)

The first three steps of the feature order are live: text and metadata, monsters and spawns, rewards. Flags,
objectives and script opcodes are not editable yet; the model carries them and they round-trip untouched.

### Second pass, same day: the builder makes new quests only

Copying a live quest was removed. A quest file is client-facing content that the catalog and the quest pages
describe, and an editor that hands out a copy of any of them invites drift between a quest and the page that
documents it. The builder now starts from a blank quest the API owns:

- `src/main/resources/quest/blank.bin` in the API jar, parsed once by `QuestBlank`. It is built from the small
  Event quest `40135d0.bin` (`QuestBlank.build`, regenerated by `QuestBlankTemplateTest` when `QUEST_DIR` is
  set): all eight text slots empty, no reward groups, no spawns, no start items, time limit 50 minutes, zenny
  and reward money 0, four players, body quest id 0 (the server assigns the real id at submit).
- The file ends in a reserved region `QuestTables` owns: 1 024 bytes for the reward table, 1 024 for small
  spawns, 2 048 for large spawns. `QuestTables.pack` lays the model's lists out inside it and rewrites the
  three header pointers, so the browser adds rows and never computes an offset. A table too big for its span
  is refused with the size it needed.
- The eight strings sit in a block with fixed room per slot (title 192, objective 320, main objective 320,
  client 160, fail 160, description 768, sub-quest A 96, sub-quest B 96), so ordinary text is written where
  it is instead of being appended on every save.
- `QuestModelWriter.prepare` also clears the byte spans of the three tables out of `raw`, because a table
  that grew now covers bytes that were padding. On an untouched model that removes nothing, which the
  editor-path test over the sample directory asserts.

| Endpoint | Does |
|---|---|
| `GET /api/account/quests/model` | the blank quest as the `QuestCodec` model: 8 empty text slots with their room, header, body, empty reward and spawn tables, plus `raw`. Any `questId` parameter is a 403 with a message saying live quests are not opened here |
| `POST /api/account/quest-drafts` `{}` or `{blank:true}` | stores a draft of the blank model, returns `{id, revision, blank:true}`. A body with `questId` is a 403 |
| `GET /api/account/quest-drafts` | the account's new-quest drafts, newest first, each with `title`, `revision` and `updatedAt` (`source_quest_id = 0` only) |
| `GET /api/account/quest-drafts/{id}` | `{id, sourceQuestId, variant, revision, model}`; another account's id is a 404, a draft seeded from a live quest is a 403 |
| `PUT /api/account/quest-drafts/{id}` `{model}` | validates by packing and writing it with the codec (400 with the codec's message), stores it, bumps `revision` |
| `GET /api/account/quest-drafts/{id}/file` | the `.bin` as `application/octet-stream`, attachment `new-quest.bin` |
| `POST /api/account/quest-drafts/{id}/submit` | the testing copy via `QuestFile.withNoRewards` (no item rewards, no Reward 1/2/3; money kept), a `quest_submission` row with status `testing`, the sandbox quest published by `QuestSubmissionController`'s own method; `{submissionId, sandboxQuestId}` |

`quest_draft(id, account_id, source_quest_id, variant, model jsonb, revision, created_at, updated_at)`,
DDL in the API repo at `src/main/resources/db/quest-draft.sql`. `source_quest_id` is 0 for every draft the
builder makes; rows from the copy era keep their quest id and are refused by every draft route.

**How a string is written.** `QuestModelWriter.prepare` encodes each slot's text to Shift-JIS. A slot whose
text still reads as its original bytes is left byte-for-byte alone, which is why an untouched model
serializes identically to the live file. A shorter string is written in place and padded with NULs; one that
does not fit its room is appended at the end of the file and the slot repointed, so nothing is cut. The
result is refused past the client's 32 KB quest buffer, and text Shift-JIS cannot hold is refused with the
character named.

**Page.** `quest-editor.html` with `js/quest-editor.js`, laid out in the order a quest is built (2 Nov 2026):
Your drafts (links to `?draft=<id>`), Basics (name, time limit, contract fee, reward money, item
needed to enter; quest class under "More settings"), Quest board listing (counter, mark, players, stars; 9 Nov
2026, below), Map and start area (with time of day and season), Objectives (with the targets required to clear
and the quest card's monster pictures), Monsters and their areas, Rewards and supplies (supply box, reward groups with each item's
share of the group's weight), Quest text, then Review and submit (a summary, the problems the page can see,
and save, download, submit). Choosing a map refreshes every area list to that map's areas
(`data/map-areas.json`, the client's own per-map lists, written by `dev/make-builder-data.py`): a start area
outside the new map moves to the map's first area, and monsters left outside it are marked and listed, with
the reason in words. The controls (pickers with icons, number inputs, add and remove buttons) come from
`js/builder-ui.js`, shared with the Road builder. Fields are bound straight onto the model, so what is posted
is the model the server sent; the layout change was checked by building the same quest before and after and
comparing the posted JSON byte for byte. The map picker writes `body.mapId` and the map record
(`model.map.mapId`), the start area also the map record's base camp (`model.map.areaId`), and the quest
class both its copies (body +0x0a, header +0x5c). Every input shows its offset and size, and every value
`data/quest-fields.json` names is offered by name, with "(unconfirmed)" where the name rests on one source
(`docs/quest-fields.md`). The map picker offers only the maps `GET /api/account/quests/maps` lists (the
server has their area tables); the others are listed, muted, as "not available yet". If that call fails,
only map 26 is offered. A save the server refuses with 400 shows its message next to the field it names. The time limit is edited in minutes (the body field counts 1 800 ticks a minute).
"Create a quest" on `quests.html` and on the account page's Custom quests tab opens it; the quest page no
longer carries an edit action, and `?id=` shows the server's refusal instead of a form.

**What Pax's editor has that the builder lacks** (counter and mark, flags, restrictions, forced equipment,
monster size, level and coordinates, reward preview) and the plan for it: `docs/quest-builder-gap.md`
(2026-11-09). All five tasks are built; how they ship together and what to test in game:
`docs/quest-builder-release.md`.

**Listing options (gap plan task 1, 9 Nov 2026).** "Quest board listing": Counter (the eight event counters
the API takes for authors: 18 HR Event by default, 24, 26, 28, 31, 38, 39, 43) and Mark (none, Recommended,
New) are not file fields: they are the draft's `listing`, saved beside the model (`PUT {model, listing}`) and
copied into the submission, whose `event_quests` row the API writes with them and with the file's player cap
(API README "Custom quest listing"; an admin can change counter and mark when publishing, in the admin Custom
quests tab). Players (`body.maxHunters`) moved here from Basics; Stars edit `body.level` (1..8). Under Map,
Time of day (Day or Night, `body.seasonFlags` bit 3 or 4) and Season (warm, cold or breeding, bits 1, 2, 0):
set in the file because Erupe's `event_quests.flags` writes the wrong byte. Under Objectives, "Targets
required to clear" (`body.objectiveMode` 2, 3 or 4; the two-target choices open once the sub-targets are set)
also sets `seasonFlags` bit 6. Every `seasonFlags` change keeps the u32 view `body.flags` in step, and the API
does the same. The review shows the quest list row ("★★★ · New · name — G Event counter, ...") and time and
season, and lists a required sub-target that is not set. Only three fields have a quiet "?" with more text
(Counter, Season, Targets required; `BuilderUI.helpTip`), the owner's preference for few help buttons. Check:
`dev/check-quest-listing.js`.

**Monster tuning (gap plan task 2, 9 Nov 2026).** Under Monsters, "Strength and size": Difficulty
(`header.monsterLevel` 0..78, Pax's names, the one quiet "?" here; levels from 53 are offered in a G rank quest
only, and while a monster is Zenith the Zenith rank picker takes its place), Size (`header.monsterSize`, 70..150 %)
and Size spread (`header.sizeClass`, 0..4 with its percentages). Each large-monster row has a Position: "Usual
spot" (with its x, y, z when the server knows one) or, after "Set exactly", x, y and z inputs held to the map's
bounds. "Use the usual spot", a new area or a new map send an empty position, which the API fills with the usual
spot; any other position is kept. Both come from `GET /api/account/quests/maps` (`spots`, `bounds`; API README
"Monster tuning"); with an older API the inputs take -50,000..50,000. The builder has no map pictures, so the usual
spot and the allowed range are the coordinate help. Pax has no facing angle, and neither do we. Monster forms
other than Zenith stay out (an unknown form may load a model file that does not exist). The review shows strength,
size and how many monsters stand at an exact spot. Check: `dev/check-quest-monsters.js`.

**Rules and restrictions (gap plan task 3, 9 Nov 2026).** A section after the listing:
- **Hardcore**, a switch (with a quiet "?"): it writes restriction 109 (`body.conditionNote`) and is offered in an
  HR 100 and up quest (class 3) only. Evidence: the client sets its Hardcore state from notes 109-113/118 and the
  monsters take their Hardcore data in class 3 (`hvmhfz_re` `docs/quest-classes.md`, part 75); in the 5,000 live
  files 240 class 3 quests have such a note, while Pax's "Fix HC" bit (`variantFlags1` bit 1) is in 636 files, 410
  not class 3, so it is not what makes a quest Hardcore. Leaving class 3 turns Hardcore off.
- **Restriction** (with a quiet "?"): `body.conditionNote` from `data/quest-condition-notes.json`, our own names for
  the 136 ids of Pax's list, grouped (rank, items and money, weapons, armour, party, unlocks, then the untested
  groups that take tickets or proofs or need the server to count). 22 names match the live quests that use them;
  the other 114 rest on Pax alone and are marked "unconfirmed". The API takes exactly these ids
  (`QuestCodec.CONDITION_NOTES`; `dev/check-quest-fields.js` compares the two).
- **Death count** (`body.faintPenalty`): "Faints allowed" 1..9 in a G rank or Zenith quest, "Money lost per faint"
  0..999,999 zenny otherwise; crossing that line with the class resets it (3 faints, or a third of the reward money).
- **Hunter rank limits**: lowest and highest rank to post (`body.postRankMin`, `postRankMax`) and to join
  (`body.rank`, `joinRankMax`); 0 as a highest is no limit; a highest below its lowest is marked and refused.
- **Quest flags**: 17 checkboxes over `body.variantFlags1-3`, Pax's and Erupe's names (No Halk pots = the owner's
  "no alk", Low and High conquest, ...), with one note that none was traced or tested in game. G rank (flags 1 bit 3,
  with the special list tab) follows the class and Zenith the monsters; Road and Interception are not offered and the
  API refuses them; the unnamed bits are kept.
A draft from before these fields (no rank limits or flags in its model) shows neither block and saves as before. The
review gains a Rules line. Not tested in game yet: the Hardcore switch, a conquest flag and the restrictions the
game may enforce. Check: `dev/check-quest-rules.js`.

**Forced equipment (gap plan task 4, 9 Nov 2026).** A section "Forced equipment (arena)" after the rules, with a red
"Untested in game" note at its top: no forced set made here has been tried in the game.
- **What the client does** (`hvmhfz_re` `docs/quest-files.md`, "Forced equipment", part 79): `body.equipment` is six
  8-byte records at body +0x5c, in file order legs, weapon, head, chest, arms, waist. When the quest starts the game
  replaces each hunter's piece by the record's (`0x10812fe0`), looking the id up in its equipment tables **without a
  bounds check**. The weapon's id is 14 bits with bit 15 for the gunner table; `body.flagsAtC0` bit 1 is its id bit
  14 (melee ids 16,384 and up). The three other words hold decoration item ids (low 15 bits).
- **Ids**: the site's equipment ids (`data/equipment-icons.json`, the API catalog) are the game's table rows: every
  row's rarity matches the client's `mhfdat.bin` tables, the five armour slots and both weapon tables. The tables
  hold placeholder rows (ダミー, 使用禁止, 欠番, blank), so the builder offers only `data/forced-equipment.json`'s pieces
  (`dev/make-forced-equipment.py`, from the same dumps; the API keeps a copy and refuses anything else). Every piece
  forced in Capcom's quest files is in it (254 sets in the local files, 470 in the live sample).
- **Per slot**: "Not forced" (all four words 0) by default; "Choose" searches the API catalog by name or id (game
  icons from `js/game-icons.js`), placeholder rows left out and said so; armour also has "Force no piece" (id 0, the
  slot forced empty, as Capcom's arena quests do); "Clear" stops forcing it. A blademaster-only piece cannot join a
  gunner set or the other way round (no Capcom file mixes them; the API refuses it).
- **Decorations**: three pickers per forced piece, from the 224 decorations Capcom's quest files force. The game was
  not seen to check a piece's slots, so this is not limited by slot count. No sigils: the format has none.
- **Not in the format**: a pouch or ammo of its own. An arena quest is forced gear plus the supply box (Rewards) and a
  restriction such as "No items" (Rules and restrictions).
A server refusal naming `body.equipment[N]` shows in that slot's row. The review gains a "Forced equipment" line
("... — not tested in game") and lists a placeholder piece, a blademaster/gunner mix or a stray weapon bit. A draft
from before the field (no `body.equipment`) shows six "Not forced" rows and saves without it until a slot is set.
Not tested in game: any forced set, a piece for one gender only, decorations beyond a piece's slots, and the client's
gate that skips forcing in some party states (`0x10a827b0`, not traced; Pax's README says forcing sometimes does
not apply). Check: `dev/check-quest-equipment.js`.

**Rewards and text extras (gap plan task 5, 9 Nov 2026).** Owner decisions (2026-11-09): custom quests keep paying
their reward money; the testing copy has no item rewards and lists no Reward 1/2/3; an approved quest pays the author's
rewards and lists their items (Erupe branch `erupe-approved-rewards`, `85d282f`, serves `data` once approved and
`data_stripped` in testing, for the file and the list entry alike). API README "Reward extras".
- **Sub-target money**: under Objectives, each used sub-target has its own "Reward money" (`body.objective1Money`,
  `objective2Money`, body +0x18, +0x1c; 0..999,999 as the main reward money). The review lists a sub-target that is
  not used but still pays money.
- **Quest list rewards** (Rewards and supplies): Reward 1, 2 and 3 (`body.previewItems`, body +0xb0, +0xb2, +0xb4),
  three item pickers with the game's icons. "Use the main target's rewards" fills them with the three items the main
  target reward groups (0x8001) weigh most, else the first group's (as 2,585 of the 3,501 live quests that list items
  do). The review names them, "shown once approved", and lists one no reward group pays.
- **Fixed rewards** (`body.rewardFlag`, body +0x90): Pax's five modes, 0..4; not traced in the client, so marked
  unconfirmed. The review shows it with the reward count.
- **Text auto-fill** (Quest text): "Write the target lines" writes the main and sub-target lines from the objectives
  ("Hunt a Tigrex", "Slay 3 Velociprey", "None" for an unused one); "Write the clear and fail lines" writes the
  clear line from the targets required and the fail line from the faint rule ("Faint 3 times / Time runs out" in G
  rank, else "Reward money hits zero / Time runs out", or "Time runs out" with no money lost per faint). Both write
  over the texts; "Undo" puts back the last fill.
- **Wording**: the account page, the builder, the admin page and the quest list now say the testing copy pays no
  items (the money is paid) and an approved quest pays its rewards.
- **Older drafts and the blank**: the API's blank listed the source quest's three items (Capcom's); it lists none now.
  A draft saved before these fields opens with Reward 1/2/3 empty, so it stops listing those items when saved.
- **Not done**: Pax's per-box entry limits (24 in the first group, 4 in the others): 1,187 live reward groups have
  more, so they are not the client's limit. Reward JSON export and import: skipped, as the plan says.
Check: `dev/check-quest-rewards.js`.

**Still open.** The `quest_submission` queue, MAX_ACTIVE and the sandbox id block are unchanged; a draft is
never a submission until Submit. Nothing here deletes drafts (the API caps an account at 50), and the private
API docs have no entry for these routes yet.
