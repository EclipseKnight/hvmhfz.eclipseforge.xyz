# Where each quest is taken on Hunsterverse (method and menu tree)

Data: `data/quest-where.json` (and each quest's copy in `data/quests/pieces/`), shown on the quest page as
"Where to take it on Hunsterverse". Generator: `dev/make-quest-where.py`; check: `dev/check-quest-where.js`.
Written 2026-11-25 against the stable patch **v1.30** and the pre-release **v1.32-pre18** (the Test land), live
Erupe `4495146` and the live database.

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
5. **States the files do not settle** are written as `sure: false` ("Unconfirmed" on the page), never guessed.
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

## Counts (2026-11-25)

9,152 quests on the site: 1,939 offered (37 of them only on the pre-release / Test land: SR Guide Quests; 6 only
on v1.30: the Sky Corridor short maps pre18 drops), 107 unconfirmed, 7,106 not offered (5,773 of those are
event-range files that are not in the live `event_quests`; 316 are in a client list no counter shows).
