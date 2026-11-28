# Where each quest is taken on Hunsterverse (method and menu tree)

Data: `data/quest-where.json` (and each quest's copy in `data/quests/pieces/`), shown on the quest page as
"Where to take it on Hunsterverse". Generator: `dev/make-quest-where.py`; check: `dev/check-quest-where.js`.
Written 2026-11-25 against the stable patch **v1.30** and the pre-release **v1.32-pre18** (the Test land), live
Erupe `4495146` and the live database; the lists opened by NPC talk and game states and the audit below added
2026-11-28.

Menu words below are our client's own labels (the patch's `mhfpac.bin`, slot 0x108c), with full-width letters
written in ASCII (★１ -> ★1). Cite these, not the community guide's tab names.

## How it is worked out

1. **Counter -> menu.** Talking to a town NPC opens a counter type (talk switch `0x1071ef70`); the type picks a
   root menu (`0x103714a0`); each menu row is an entry of the action table `0x11925340` (label, a sub-list of rows,
   and a list spec of (kind, arg) pairs). hvmhfz_re `docs/progression.md` 3, `docs/tower-npc.md`,
   `tools/quest/menu_lists.py`. NPC names come from the town NPC tables (`0x11a7bb20`, record +0x17).
2. **Built-in lists** (spec kind 1, quest ids below 40000): the list builder `0x1037c730` reads, by list number,
   `mhfinf.bin` header slots (+0x18 .. +0x84: zero-ended u16 lists), `mhfdat.bin` lists (G★ +0x6c8, the HR band
   tables +0xa98, Conquest/Shiten +0xb30/+0xb34, SR Guide +0xb50..) or code (`LIST_SOURCES` comments in the
   script). Decoded from each patch zip.
3. **Server lists** (spec kinds 2-4, ids from 40000): a row shows the live `event_quests` rows whose `quest_type`
   it names (kind 3 adds the Raviente types 22, 40, 50, 51; kind 4 the Diva Defense list). Erupe
   (`handleMsgMhfEnumerateQuest`) sends every row whose rotation window is open (all live rows have
   `active_days` 0: always), plus the Speedrun Cup's quests while it runs (`tournament_quests`) and the VS Bracket's
   round quest to players with an open match (`vs_bracket_quests`). Day/night twins are merged into one row
   (`MergeDayNightQuests`); custom quests (65000+) are not in the site's quest data.
4. **Special systems**: the Series Quest Counter offers the quests named by the steps of the live
   `scenario_counter` series (hvmhfz_re `data/series_quests.tsv`); the Road and Sky Corridor quests are the
   `mhfinf` +0x5c lists (below).
5. **Lists opened by NPC talk and game states** (`TALK_LISTS`, `SCENARIO_GATES` in the script): the counter
   frame `0x10370030` (state 7) shows one list instead of the root menu for some NPC kinds and game states; each
   place carries its condition (`need`, shown as "needs ..."). See "Lists opened by NPC talk and game states".
6. **States the files do not settle** are written as `sure: false` ("Unconfirmed" on the page), never guessed.
   Settled from the code: tune 1046 (`get_hunter_life_cap`, Erupe sends 99) makes the Order Quests family read
   `mhfinf` +0x4c/+0x50/+0x54, not +0x48; tune 1158 is 1 for v1.30 and 0 for pre9+ clients (endless Sky Corridor
   on), which turns the SR Guide list on only for the pre-release; Superior Quests split one list by the record's
   G flag (+0x97 bit 3) between the HR and G counters; G Experience Quests show from HR 100 until cleared; Hunter
   Quests ★N are band N's table rows (all but the urgent one) up to the HR cap.

Rerun: `python3 dev/make-quest-where.py --collect` (needs the patch zips on mhfz-dev, hvmhfz_re with
`build/unpack_cli`, and ssh to hvmhfz-db; read-only SELECTs), then `python3 dev/make-quest-where.py`,
`python3 dev/make-quest-pieces.py`, and the check. `--collect --no-live` keeps the last live snapshot.

## The menu tree a player sees (v1.30; pre18 differences marked)

Rows with nothing in them are hidden by the game, so an empty row below is not on screen.

**General Quest Counter** (Mezeporta; also the "Free Quest Counter" NPC; a guild hall counter opens the same rows)
- G Experience Quests (from HR 100, each until cleared)
- Event Quests (event type 18)
- Daily Quests (type 26 + a built-in list)
- Hunter Quests: Urgent Quests (after the band's Key Quests), ★1 .. ★6, ※ Exotic Quests (type 38 + list)
- Other Quests: Gear Acquisition Quests, Hunting Skill Quests, Returning Clan Quests (type 41), Special Clan Quests (type 44)
- Special Quests: Promotional (type 9), HR Ranking Rewards, Paw Coins/Yearly Benefits, Weapon Souls & Hiden,
  Superior Quests, Premium Quests, Luxury Quests
- Clan Quests: Quest Orders, Training Support Quests (both need a Guild Ticket), Add Request
- Caravan Quests: ★ Rank Quests, G Rank Quests, Pioneer Quests, Pioneers List (screens, no quest ids),
  Great Slaying Quests (Raviente, types 16, 22, 40, 50, 51)
- VS. Quests: Quest Orders (type 13), Tournament Board, Tournament Quests (type 17 + Diva Defense)
- Hunting Competition (type 7), Winners Quests (type 8; festival winning team only)
- My Missions Quests, Navi Recommended Quests, Favorites, Quest History, Quest Search

**G Rank Quest Counter** (needs G Rank)
- New Weapon Type Quests (empty here), Event Quests (type 28), Daily Quests (type 30 + list)
- Zenith Quests > Zenith Monster Quests (type 43 + list)
- G Hunter Quests: ※ Gathering Quests, ※ Musou Quests, ※ G Monster Farming, ※ Legend Quests (these three are
  empty in our client data), G★7 .. G★1 Quests, ※ Burst & Origin Quests, ※ G Exotic Quests (type 39 + list)
- G Urgent Quests (type 31)
- Conquest・Shiten Quests: Lv1, Lv200, Lv1000, Lv9999, Shiten Quests, Adv Shiten Quests, About Shiten Quests
- Gear Acquisition Quests, SR Guide Quests (**pre18 only**: one of three lists in turn; empty on v1.30)
- Special Quests: Promotional, Ribbon, Merit & Armor, Superior Quests
- My Missions Quests, G Special Clan Quests (type 45), Favorites, Quest History, Quest Search
- A second G-counter menu (the ≪GRP/GSRP≫, ≪G Zenny≫, ≪Weapons≫, ≪Armor≫, ≪Decorations≫, ≪Hunter Navi≫,
  ≪Diva≫ My Missions rows) is picked by a guild/mission state not traced: its quests are "unconfirmed".

**H.Road/Sky Corridor** (our patch, counter type 16)
- Hunting Road > Hunting Road Quests: the Road; on v1.30 also the Sky Corridor quests
- Tower: **pre18**: Tower Quests (the Sky Corridor quests; 2nd-4th District need Tower Rank 51/100/200),
  Tower Info, District Progress; both: Contribution Rewards, Daily Rewards, Tower Expedition, Guild Medal Exchange

**Caravan Quest Counter**: ★ Rank Quests, G Rank Quests, Great Slaying Quests, Pioneer Quests, Pioneers List.
**Winner Quest Counter**: Winners Quests, Use Bond Points > Great Slaying.
**Series Quest Counter**: Beginners / Veteran tabs, one series at a time (the quests its steps name).
**Guild Master** (Mezeporta): Goocoo Quests, by garden progress (below).
**G Rank Quest Counter at GR 0**: Clan Requests (unconfirmed, below).
**New character's opening** (Mezeporta): Hunter Quests, one quest (unconfirmed, below).
**Diva Defense** (its own screen, during Diva Defense): Int. Quests (type 46), Split Route Quests (47),
G Rank Int. Quests (48, 46).
**Rookie counter** ("Accepting the first quest", the rookie areas): Starter Quests (Hunter Life Basics, Melee
Usage, Ranged Usage, Start with a minion, Destroy the large monster!, Delivery is also important!) and Hunter
Quests (HR1-30, HR31-99, HR100+, then one row per map). Its area being open to our players was not checked in game.

### Lists in the client that no counter shows

- **Order Quests** > Gou Quests, Gou Qualification, Training Quests, Special Quests, Memo Quests, **G Deco
  Quests**, Skill Cuff Quests, Long Term Quests (the guide's "G Deco Quests" tab). The Order Quests menus
  (actions 0x59-0x5c, 0x75) are in no counter's tree; only Gear Acquisition and Hunting Skill of that family are
  under General Quest Counter > Other Quests.
- The alternate Order-family lists (`mhfinf` +0x48, used only while tune 1046 is 0): e.g. the 58 "Special
  Material" quests are only in its Gear Acquisition list.
- SR1-30 / SR31-99 / SR100+, ≪Hunter Training Quest≫ (≪HR1-30≫ ≪HR31-99≫ ≪HR100+≫), the HR ≪...≫ My Missions
  rows, Ultimate Conquests, Level Reset, Welcome! MHF-Z!.
- Event types with no row: none of the live ones (type 24 Series is found by quest id by the Series counter).

## Lists opened by NPC talk and game states (2026-11-28)

The counter frame `0x10370030`, state 7, picks the root menu (`0x103714a0`) and then, for some NPC kinds and game
states, replaces it with one list under one action row (`[frame+0x15c8]` = the action, `+0x560` the count, `+0x598`
the ids). In the script:

| Place | Opened by | List | Condition (`need`) | Sure |
|---|---|---|---|---|
| Guild Master (Mezeporta) > Goocoo Quests | NPC kind 0x40 (areas 200, 210, 282): talk `0x1071ef70` case 0x40 -> `0x1047f990` -> talk menu `0x1047f5f0`, row type 3 labelled mhfpac `[0xbbc]+0xc` ("Goocoo Quests" in v1.30 and pre18); row handler `0x1047fa40` case 3 -> counter type 9 | action 0x40; `0x1083e010`: mhfdat `[+0x474]` list k for each bit k of `0x1083df20` | bit 0 (26590-26592, 26597, 26598): garden progress 3, 0x17, 0x1d (HR 2+, a yes to the Felyne Caretaker); bit 1 (26593): garden record +0x2d = 2 (a Gu-ku ran away); bit 2 (26594): progress 6; bit 3 (26595): progress 0x10; bit 4 (26626-26630): `0x1078fa10(3)` = byte `0x118e19ac[progress]` bit 3: progress 0x13, 0x14, 0x1b-0x22 (no bound in `0x1078fa10`; the steps run to 0x22, `0x10776a10` takes progress < 0x23; read from each patch's DLL, the collect stops if it changes) | yes (hvmhfz_re part 286 emulated the list and the egg; bit 4 read from code and table) |
| G Rank Quest Counter > Clan Requests | kind 0xf3 at GR 0: talk case 0xf3 opens type 0xe only when `0x1071ea70`: GR 0, HR 999, `0x10b39140()` = 999, save +0xc2 bit 0x20 clear; frame: kind 0xf3, `0x1068a180` and GR 0 | action 0x49; one quest, u16 at `0x118e5d2c + 4 x GR` = **23001** "Legend Soaring the Skies" (Repel Shantien) | HR 999, before G Rank | no: `0x10b39140` and the frame's earlier exits (`0x1036f830` not read; `0x1036fc50` exits only on a My Mission: "Not available during Mission.") were read, not run |
| New character's opening (Mezeporta) > Hunter Quests | game mode 0x8e (`0x10400180` case 5: `[0x1e73e508]` = 3, counter type 0 with kind 0x4f), started by `0x103ff830` (first arrival in areas 200/0x101, save +0xc0 / +0xc2 flags) and by NPC kind 0xf1's talk (`0x103ffc90`, `0x103ffdc0`) | action 2; one quest: mhfdat `[+0x1b8]` word 0 (**26687** "Just Give It a Try!") or word 1 when an event flag is set (**26688** "Let's Try Again!") | (the opening) | no: which save flags start the opening on our server is not traced |
| General Quest Counter > Diva Story | a story chapter's quest gate: chapter-script opcode 0x04 sub-type 4 (+0x16c quest, +0x170 counter 0 = kind 0x28, 2 = kind 0xf3); the frame reads the gate records at `0x1e8955d4`/`0x1e8955d8` (opcode 4, sub-type 4, not yet met by `0x107c1270`) | action 0x76 (0x77 at the G counter); one quest | while that chapter waits for it. Scan of all 109,652 live scenario files of the 154 `scenario_counter` series (2026-11-28, read-only copy, hvmhfz_re `src/files/chapter.c`): only **21122** (Rajang), Veteran series 73 【Adept Hunter: Inagami】 chapter 3 | no: which record list holds the waiting gate was not traced |

**Garden progress in plain words** (the page shows only the words; `GUKU_STATES` / `GUKU_NEED` in the script, the
states also in `dev/quest-where-inputs.json` as `garden_progress`). Progress is save byte +0x22c32; its writers in
the v1.30 DLL: 1 at the garden setup `0x10792950` (your own garden, HR band >= 2); 3, 6, 0x10, 0x17 and 0x1d each
written by two of the Felyne Caretaker's yes steps (`0x10776b78`/`0x10776c4e` ... `0x10777ba8`/`0x10777c7e`); 8, 0xa,
0xc, 0x12, 0x14, 0x19, 0x1f, 0x21 by single Caretaker steps; 0xd, 0xe at `0x10798f56`, `0x10799075`; **0x1f when a
Gu-ku hatches** (`0x10792dc0` -> `0x10792ea9`); the setup moves 0x1b-0x22 to **0x14 when 5 grown Gu-ku are kept**
(slot state 6-11, `0x10792700`) and sets 0x13, 0x1a, 0x20, 0x22 from its jump table (not read further).

| Kind | States | Shown as |
|---|---|---|
| 0 eggs | 3 (first yes), 0x17, 0x1d (later yeses) | HR 2+, and say yes to the Felyne Caretaker in your own My Garden (the list shows again after a yes to two of his later requests) |
| 1 runaway | garden record +0x2d = 2 | after a Gu-ku runs away from your garden |
| 2 | 6 (a yes) | after you say yes to the Felyne Caretaker's blueprint request (quest "The Stolen Blueprints") |
| 3 | 0x10 (a yes) | after you say yes to the Felyne Caretaker's second blueprint request ("Stolen Blueprints Again") |
| 4 food | 0x13, 0x14, 0x1b-0x22 | once your first Gu-ku has hatched (shown at most of the later Gu-ku steps, not all): 0x1f is the hatch, 0x14 a full garden; 0x13 and 0x1b-0x22 other states after it (order not fully traced: medium) |

### Audit: other ways the client opens a quest list (2026-11-28)

Checked, nothing new for the site:

- **Every counter type the talk switch opens** (`0x1071ef70`, via `0x10395940` -> `0x1036e7c0`): type 2 (NPC kinds
  0x88, 0xc6), 3 (0x98), 4 (0xb6), 5 (0x86), 6 (0x28, 0x38, 0x85), 8 (0x77), 9 (0x40), 0xb (0xb2), 0xc (0xa1), 0xe
  (0xf3), 0xf (0x4f); the Road (kind 0x26, `0x101d1e70`). `0x103714a0` gives types 5, 9, 0xb, 0xc (and 0, 1, 0x14,
  3 outside a guild hall) the default root `0x11998b3c`; type 3 in a guild hall `0x11925334` (default rows minus a
  few); type 0xf `0x119251d4` (★ Rank / G Rank Quests, the caravan's lists, and the Pallone Festival screens). No
  list that the walked roots lack.
- **Every other caller of `0x1036e7c0` / `0x10395940`** (call graph `raw/questcycle/callgraph.tsv`): `0x10400180`
  (the opening, above), `0x1048d430` (HR Tests, open below), `0x10480c40` (type 4, kind 0xd3), `0x106dbcb0` (type 0,
  kind 0xf0, the house), `0x106dbaf0` (type 0), `0x106dec80` (type 1), `0x107338d0` (type 0x14), `0x101d2940` (type
  0x12, the Road), `0x107a6880`/`6a70`/`6bd0` (Diva Defense 0x11/0x13/0x15), `0x11351aa0` (types 6/0xe, guild),
  `0x10b75680` (type 6, kind 0x38), `0x10424fe0`, `0x1034b0c0`, `0x10393610`, `0x10420b30` (open the stored type
  again). All reach roots the script walks.
- **The frame's other direct lists**: kind 0xf6 Diva Defense and kind 0x26 / 0x98 in type 0x12 (the Road): already
  walked; `[frame+0x20]` = 1: Special Series Quests (action 0x41, `0x106e3b30`, the Series Quest Counter);
  `[0x1e76af56]` (Hunting Skill training): the quest in progress again, action 0x3f.
- **The Guild Master's other talk rows** (Hiden Book Menu, Transcend Menu, Koryo Menu, Use My Missions Tickets,
  Complete with Gacha Coins): `0x1047fa40` opens a counter only for row type 3.
- My Tore (kinds 0xee/0xef, `0x1035d590`), Rasta (0xce-0xd2, `0x1035cff0`), Diva (0xf6/0xf7) and the other talk
  cases do not reach `0x1036e7c0`.

Open (not in the script):

- **HR Tests** (21887, 21889-21897: HR100-HR999 Breakthrough): game mode 0x70 (`0x1048d430` case 5) offers one at
  the Guild Master (`0x1036e7c0(0, kind 0x40)`, action 0xae "≪HR Tests≫", quest = u16 table `0x11921bd4`
  [`0x1048c870()`]: HR thresholds at `0x11921be8`, stride 0x20, when save +0xa2 bit 0x200 is set). Nothing found that
  enters game mode 0x70 (`FindStores` on `0x1ee268e0`: no immediate 0x70; register stores not followed), and the
  Guild Master's "Trial Menu" row (type 2, `0x106e90a0`) is never added by `0x1047f5f0`. Left not offered.
- **Clan Quests and Caravan Quests under the General Quest Counter**: `0x10372000` shows rows 0x04, 0x16, 0x17
  (Clan Quests, Quest Orders, Add Request) only at counter type 3 and row 0x05 (Caravan Quests) only at type 4. So
  "General Quest Counter > Clan Quests > ..." (the only place of 85 Guild Ticket quests) is really the type-3
  counter (talk case 0x98; its NPC name not read), and "General Quest Counter > Caravan Quests > ..." repeats the
  Caravan Quest Counter's rows. Paths not changed: the type-3 NPC's name is not known, and our patch rewrites some
  of these conditions (hvmhfz_re `docs/tower-npc.md` 3), so the patched bytes must be read first.
- A quest taken without the counter frame (an item, a Hunter Navi screen, an NPC that accepts a quest without
  `0x1036e7c0`) was not searched for. Every list found goes through `0x1036e7c0` and the frame's accept `0x1037b670`.

## Counts (2026-11-28)

9,152 quests on the site: 1,952 offered (37 of them only on the pre-release / Test land: SR Guide Quests; 6 only
on v1.30: the Sky Corridor short maps pre18 drops), 110 unconfirmed, 7,090 not offered (5,773 of those are
event-range files that are not in the live `event_quests`; 380 are in a client list no counter shows; the 2026-11-25
figure of 316 was stale, the same file gives 380). Before the talk lists (2026-11-25): 1,939 offered, 107 unconfirmed, 7,106 not offered; moved: the 13 Goocoo Quests (26590-26595,
26597, 26598, 26626-26630) to offered, 23001, 26687 and 26688 to unconfirmed.
