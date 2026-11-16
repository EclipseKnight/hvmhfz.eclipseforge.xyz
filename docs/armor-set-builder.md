# Set builder (armour set builder, phase 1 lane B)

Design: project home `docs/designs/2026-11-15-armor-set-builder.md`. This file holds the formats the other lanes
use (A: decoded rules in `hvmhfz_re`; C: the API's `/builder` and "missing" endpoints; D: community sets).

## Files

| File | What |
|---|---|
| `set-builder.html`, `js/set-builder.js`, `css/set-builder.css` | The page (see "Page layout"): the set as cards (weapon, five pieces with level pips and decoration sockets, cuffs, hunter filters), the list for the card being edited, the skills panel; the set in the address |
| `js/set-builder-find.js` | The "Find sets" tab: skill grid, filters, kept and excluded pieces, the search engine's worker, result cards, compare (see "Find sets") |
| `dev/fake-armor-search-worker.js` | A stand-in for `js/armor-search-worker.js` with the same messages, for the fast page checks; `dev/check-set-builder.js` also runs the real worker |
| `js/armor-calc.js` | The calculator and the set format (encode, decode, normalize; `calc` = the game's recompute, `compute` = the page's set checked and calculated). No page code; node runs it too |
| `js/armor-rank.js` | The rank the smithy needs (a piece's or weapon's `craft`) and whether the hunter's rank reaches it; the list texts. Page, worker and node (see "Rank needed to craft") |
| `js/armor-rules.js` | The game's rules for one row at a time (activation, weapon gate, Zenith, limit parts, defence and slot growth, gender), read from `data/armor/rules.json` |
| `dev/make-armor-data.py` | Writes `data/armor/` from `hvmhfz_re` `data/armor_rules.json`, `data/armor_builder.json` and `data/armor_craft_rank.json`; stops when their data version is not the patch zip's `mhfdat.bin` |
| `dev/check-set-builder.js` | All 3,000 client answers of `hvmhfz_re` `data/armor_calc_cases.json`, the data rows against `hvmhfz_re`'s, rules, page checks including Find sets (node + headless Chromium) |
| `js/armor-owned.js` | Character import helpers (no page code; node runs it): import pieces to a set, what is owned, the "missing" request body |
| `js/set-builder-mine.js` | The "Your character" panel, the "Only what I own" filter hooks and the "Missing for this set" panel |
| `dev/check-set-builder-mine.js` | Set format cross-check with the API, the helpers, and the page against a fake API (headless Chromium) |
| `js/armor-search.js`, `js/armor-search-worker.js` | The skill search (no page code; node runs it) and its Web Worker; see "Skill search" |
| `dev/check-armor-search.js` | The skill search: known sets, every result checked by the calculator, the query's limits, time budget, the worker in headless Chromium |

Data: `data/armor/<slot>.json` (one per armour slot, about 1.2 MB, 180 KB gzipped, loaded when the slot is first
opened or a link needs it), `data/armor/index.json` (decorations, Road gems, cuffs, weapon Tower sigils, weapon
Zenith skills, Tower flags and automatic skills, skill names, the HR bands), `data/armor/rules.json` (the rules and
the skill trees), `data/armor/weapon-craft.json` (the smithy's rank per weapon, loaded with the first weapon list). Weapons come from `data/weapons/`. Field lists are in the docstring of `dev/make-armor-data.py`.

After a client patch: rebuild `hvmhfz_re`'s armour data from the new patch (its `docs/armor-builder.md`,
"Regenerate and check"), then `python3 dev/make-armor-data.py --zip <patch zip> --version 1.N`, then
`HVMHFZ_RE=<hvmhfz_re checkout> node dev/check-set-builder.js`. The script refuses `hvmhfz_re` files made from
another `mhfdat.bin`. Then rebuild the API's community-sets catalog (`tools/make-armor-set-catalog.py`) and
crafting data (`tools/make-builder-data.py`, from `hvmhfz_re` `data/item_uses.json` of the same patch), so the
page, the API and `hvmhfz_re` name one data version (`dc6615908fef` for v1.29).

## Set format (version 1)

One JSON shape for the address, the API and test fixtures:

```json
{"v": 1, "data": "v1.29",
 "weapon": [7, 31, [], [5100]],
 "armour": [["head", 29, 7, [5100]], ["chest", 0, 1, []], ["arms", 0, 1, []], ["waist", 0, 1, []], ["legs", 0, 1, []]],
 "cuffs": [16161]}
```

- `weapon`: `[class, id, extra levels, decorations]`. Class is the game's weapon class index (0 Great Sword,
  1 Heavy Bowgun, 2 Hammer, 3 Lance, 4 Sword and Shield, 5 Light Bowgun, 6 Dual Swords, 7 Long Sword, 8 Hunting
  Horn, 9 Gunlance, 10 Bow, 11 Tonfa, 12 Switch Axe F, 13 Magnet Spike), -1 none. Id 0 = any weapon of the class.
  Extra levels: reserved for Tower weapon stat levels (empty in phase 1). Decorations: item ids (decorations,
  Road gems, sigils), at most 3.
- `armour`: always five `[slot, id, level, decorations]` in the order head, chest, arms, waist, legs; id 0 = empty;
  level from 1; at most 3 decoration item ids.
- `cuffs`: skill cuff item ids.
- `data`: the game data version the set was made with; the page says so when it differs from its own.

The API reads this same shape (`hvmhfz_rest_api` `builder/BuilderSet.java`): the weapon class gives the weapon's
kind (1, 5 and 10 ranged, the rest melee), weapon id 0 and armour id 0 are left out. Both repos hold the same
four sets as test strings (`dev/check-set-builder-mine.js`, API `BuilderSetFormatTests`): change them together.

In the address: `set-builder.html#s=<base64url of the JSON, no padding>` (`ArmorCalc.encode` / `decode`; a code
that does not decode starts an empty set and says so). Gender and the "only what players can get" tick are list
filters, not part of the set.

## Rules (`data/armor/rules.json`, `js/armor-rules.js`, `js/armor-calc.js`)

The game's own rules, decoded from the client by `hvmhfz_re` (part 199; format and the rules step by step in its
`docs/armor-builder.md`): `rules.json` is its `data/armor_rules.json` as it is. `ArmorCalc.calc` follows
`hvmhfz_re` `tools/items/armor_calc.py` step by step and must match all 3,000 sets the client's own code answered
(`data/armor_calc_cases.json`; `dev/check-set-builder.js`). In short:

- Points: pieces, their decorations (first four pairs), the weapon's decorations (not a Tower weapon's), both cuffs.
- Activation rows in table order; the skill limit (10; +1 / +2 for 3-4 / 5+ G-rank, Zenith or Tower pieces; +
  Zenith Skill Slots Up; + cuffs, a cuff's slot only while its Tech skill is on; at most 28). Over the limit the
  skills of later table rows drop first, whatever their points; the kept ones are sorted as the game lists them.
- Automatic skills (one per piece and weapon) and a Tower weapon's Road gem skills (the best single gem per tree,
  up to 4) are outside the limit.
- Tech skills give no effect with another weapon class (they still take their place). Zenith skills from the
  weapon, pieces and cuff, per group, with their lit rule (and Guard Up / Reflect Up / Stylish Up / Soul Up cases).
- Defence and slots by level from the growth tables (defence rounded up after each level); resistances as stored.
- Gender is a hard rule (a problem); blademaster / gunner is only a list filter (no client code refuses a piece by
  it). A Tower weapon's first `slots` places take weapon Tower sigils, the rest Road gems; the set lists them
  without gaps, so the page puts sigils first. Sigils go on nothing else.
- Left out: Tower armour plates (and the armour Tower sigils that go in them), sigils of non-Tower weapons (rolled
  per copy, never skill points), defence and resistance from skills, food, songs, buffs, special quest rules.

## Page layout

Owner, 2026-11-15: a wide, game-like page with a skill list, not a column of dropdowns. Every step is a button
(cards, sockets, level pips, list rows, chips), so the page works from the keyboard; only the character panel keeps
its pickers.

- **Wide screens (1200 px and up), three columns.** Left: the set as cards: weapon (class, weapon, sockets or a Tower
  weapon's sigil and Road gem places), head to legs (icon, name, defence, skills, owned badge, level pips, one socket
  per decoration and one empty socket per free slot), skill cuffs (two sockets), hunter filters (gender, "Only what
  players can get", "What I can get", the rank: see "Rank needed to craft"). Clicking a card's name or a socket opens its list in the centre. Centre: that list, searchable
  (name or skill; a skill tree's whole name, a skill's whole name such as "Attack Up Large" or "Evasion+2", or the
  start of one tree's names such as "attack up" lists only rows with that tree's points and sorts by them; spaces and
  case do not count; weapons have no skill points, so their list searches names only), sortable by its
  headers, paged by 80; a "Yours" column with a character loaded; pointing at or tabbing to a row shows what it
  changes against what you have (defence, skills gained and lost, points per tree). Right: defence and resistances,
  the skill limit as boxes, active skills (automatic, Road gem and over-the-limit skills in their own groups), Zenith
  skills, one bar per tree with points (ticks at its thresholds, filled to its points, "N more for ..."; "All skill
  trees" lists every tree), problems, share. The list and the skills stay in view with their own scroll.
- **Below 1200 px** the skills are their own tab (Equipment / Skills / Find sets); **below 760 px** the list sits
  under the cards with its own scroll, its headers a row of sort buttons and each row one card.
- The character panel ("Your character", `js/set-builder-mine.js`) is a strip above the tabs, so "Only what I own"
  filters every list and Find sets can send the import to the search.
- A new piece keeps the decorations that still fit; a lower level drops the ones that no longer fit. Filling a socket
  moves on to the next free one.
- The list's preview box has a fixed height: rows must not move under a still pointer (that previewed the next row,
  and so on). The tables are not `.table-wrap`, whose swipe hint (`js/tablesort.js`) came and went as the phone
  layout reflowed.

## Find sets

The "Find sets" tab (`js/set-builder-find.js`). Owner, 2026-11-15 (twice): more intuitive, no dropdowns, use the width,
a skill list, find sets by the skills you want. Layout from other builders (wiki-db's skill grid, Game8's "room for
more", fix and exclude pieces, honest caps, which skill blocks a search):

- **Top, full width**: the wanted skills as chips (× removes one), the room counter (ten boxes, "Room for N more": the
  game's limit before G-rank, Zenith pieces and cuffs add places, and the engine's 10 wanted skills at most), Find
  sets / Cancel / Clear skills, progress; then the filters, folded on screens below 1200 px with a one-line summary:
  weapon class (defaults to the builder's), gender, hunter type (set by the class when there is one), "What I can
  get" and the rank (the Hunter card's, shared: see "Rank needed to craft"), only what I own
  (with a character), Zenith pieces, Tower decorations; then the pieces: "+ Keep <piece>" for the builder's weapon and
  pieces, and a chip for each piece kept or left out (× undoes it).
- **Left (1200 px and up; below it under the top)**: every skill tree as a tile in a category grid (Attack, Defence,
  Resistance, Gunner, Weapon Tech, Other; chosen by tree name since the game has no categories; and Zenith: one tile
  per Zenith group of `rules.json` `zenith`, a chip per Zenith skill at the fewest Zenith points that give it), one chip per
  level labelled by what its name adds ("Large 25" for Attack Up Large; the whole name and points in its label), a
  name search over trees and level names (it looks in every category), its own scroll. One level per tree; Tech trees
  of another weapon class are left out; thresholds of 1000 and more (the game's Zenith markers for Reflect+3 and
  Encourage+2) are not offered.
- **Right**: the sets found, 12 cards at a time ("Show more"), sortable by best match (the engine's order), defence,
  free slots and extra skills. Each card: rank, defence, free slots, "All N skills" or "Misses X" (the engine's
  `missing`), resistances; the pieces on a dark panel in their rarity colours (the client's equipment colours) with
  level and decorations; a bar per wanted skill (points / needed, the calculator's); the other skills; Load into
  builder and Compare (up to three beside the builder's set). On each armour piece "Keep" fixes it and × leaves it
  out, a decoration's chip leaves it out; each searches again at once.
- **Messages**: a skill the engine cannot search (`stats.impossible`, e.g. a Tech skill of another class) or, when
  nothing met every skill (`stats.relaxed`), the skill(s) the results miss: "Nothing matches all N skills. X blocks
  it" with "Search without X". No result at all: "Nothing gives X with these filters" (one skill) or "No set reaches
  these N skills ..., not even with one of them left out", with what to try. Caps said plainly: 50 results shown when
  the engine found more, the 10 s time limit (`truncated`), the engine's notes. Cancel ends the worker at once (the
  engine sends nothing more for a cancelled search) and says the search stopped.

Every result is recalculated with `ArmorCalc.compute` for what the cards show; each card carries its set in
`data-set` (the `#s=` code). Without the worker file the tab says the search is not on the site and searches nothing.

The Equipment tab's empty set opens on "Start a set": build piece by piece (the weapon class tiles below) or Find sets
for skills, with one-skill searches for six common skills (Attack Up Large, Critical Eye +3, Razor Sharp +1,
Evasion+2, Guard+1, Health+30) that open Find sets and search.

Messages (the interface agreed with the armor-search lane):

| Direction | Message |
|---|---|
| page to worker | `{type: "search", query}`; `{type: "cancel"}` to stop (the page ends the worker at once) |
| worker to page | `{type: "progress", done, total}` ..., then `{type: "done", result: {results: [{set, skills, extraSkills, defence, res, freeSlots, score, met, missing}], stats, truncated}}`; `{type: "error", message}` is shown as it is |

`query`: `wanted: [{skill, level, tree}]` (skill = the skill id of the level picked, level = its points threshold,
always 10 or more so the engine reads it as points, tree = its tree; a Zenith skill is `{zenith, level}`: its id and
Zenith points; on the page its keys are `"z" + id` and `"z" + group`), `weaponClass` (null = any), `weaponId` (0 unless
the builder's weapon is kept), `gender` (`""`, `male`, `female`), `hunterType` (`blade`, `gunner`, `any`), `rankMax`
(`{band, gr, gsr}` or null), `ownedOnly`, `owned` (the character's `/builder` import when one is loaded, else null),
`allowZenith`, `allowTowerDecos`, `fixed` (`{slot: id}` of the pieces kept), `exclude` (`"slot:id"` of pieces and
`"item:id"` of decorations left out), `maxResults` 50, `timeLimitMs` 10000. The cards take each result's `set` and
`missing` and show what the calculator gives for the set (defence, free slots, skills), so they agree with the
builder and the compare table.

Checks: `dev/check-set-builder.js` runs Find sets against the stand-in (the query, cards, compare, load, cancel, no
engine) and then against the real worker at 1600 and 390 px: Attack Up Large + Razor Sharp +1 + Evasion+2 for a Long
Sword and Attack Up Large for a Bow, each card confirmed by the calculator; sort, Show more, Keep and × on a card;
PwrSwd+3 added blocks the search, every card misses it, "Search without" it finds full sets; HR100-299 (no G-rank,
GX, Zenith or rarity 8+ piece, no G-rank decoration, no cuff); the Zenith category and Skill Slots Up+2, lit in every
card. The list part checks skill names as the search, G-rank rows per rank and "What I can get";
`dev/check-set-builder-mine.js` checks that a character ticks it and fills the rank.

## Rank needed to craft

hvmhfz_re part 200 (its `docs/armor-builder.md` "Rank needed to craft", `data/armor_craft_rank.json`) decoded the
rank at which the smithy offers every armour piece and weapon. `dev/make-armor-data.py` adds it as each piece's
`craft` (the last field of `data/armor/<slot>.json`) and per weapon in `data/armor/weapon-craft.json`: 0 = never
offered (event, transmog-only, unused), else `[rank "hr"|"gr", value, band 1-7, how, (GSR class, GSR level)]`; `how`
r rank, m materials, o open, g GSR gate, u upgraded from a piece of that rank. `index.json` `rank` holds the HR bands
(HR1, HR2-30, HR31-50, HR51-99, HR100-299, HR300-998, HR999) and the GSR classes' names.

The rule (hvmhfz_re "Site filter"), in `js/armor-rank.js` for the lists, Find sets and the search engine: a hunter
with HR band b (G Rank = band 7) and GR g reaches a piece when it is `hr` with band <= b or `gr` with value <= g; a
GSR gate also needs the GSR (one number for every class: the page does not know a hunter's GSR per class).

- **"What I can get"** (Hunter card and Find sets, one state; player request 16 Nov): only what players can get, at
  the hunter's rank. A loaded character ticks it the first time and fills the band and GR from its HR and GR
  (ticking it again refills them); without one it uses the rank picked. Unticking it clears the rank to Any;
  unticking "Only what players can get" or picking Any unticks it. It is not "Only what I own" (the character's boxes).
- **Hunter card** "Rank (up to)": band chips (Any, HR1 ... HR300-998, HR999 / G Rank), GR, GSR. Any = no filter.
  A GR above 0 picks the G Rank band. Find sets shows the same controls (one state). A loaded character fills the
  band and GR when no rank is set (its shown HR's band: an HR30 hunter past the HR31 Urgent gets band 2, one band
  low).
- **Lists**: armour and weapon rows outside the rank are left out, except what the loaded character owns; a Rank
  column says "HR band 5", "GR 100", "GSR 300 Long Sword" (its tooltip: the band's HRs and how the smithy lists it),
  sortable. A GSR row is marked while no GSR is given.
- **Find sets**: the query's `rankMax`; a result card with a GSR piece says what it needs while no GSR is given.
- Upgrades read no rank in the client (only material conditions), so a G-rank upgrade of an HR piece (6,016 obtainable
  armour pieces, e.g. Barioth GX Helm from the HR100 Barioth line) carries the HR band of its line in the data. Their
  materials drop only in G rank, so `ArmorRank.pieceCraft` (page and engine) gives them **GR 1** (how `G`): pieces with
  the client's G-rank flag (`limitKind` bit 0) or rarity 8 and up (no HR armour is rarer than 7), and **GR 200** to
  Zenith pieces (`limitKind` bit 1 or rarity 12, how `Z`; the Zenith menu's own need). Before this an HR299 search
  returned GX pieces (player report, 16 Nov). A GSR gate also needs G Rank.
- Decorations and cuffs have no smithy rank in the data. `ArmorRank.itemFits`: an HR hunter (a band, no GR) gets no
  cuffs, no Zenith decorations and no G-rank decorations, known by name ("... G", "... GF", "... GX", "... GX1" to
  "GX5"), in the lists and the engine; what the character owns still counts.

## Not built yet

Upgrade lines on this page (each piece links to its equipment page, which shows the line and materials).
d0t-execute's Frontier Set Searcher stays linked under the builder as another search.

## Skill search (phase 2b)

Pick the skills you want; the search finds armour sets that give them within the limits you set. `js/armor-search.js`
is the engine (no page code; node runs it), `js/armor-search-worker.js` runs it in a Web Worker so the page never
freezes. Every set it returns is checked by `ArmorCalc.compute` with the game's rules: no problem (gender, slots,
kinds), every wanted skill active (not dropped by the skill limit) and working with the weapon class.

**In a page**: `new Worker("/js/armor-search-worker.js")`, then post `{type: "search", query}`; it answers
`{type: "progress", done, total}` now and then and `{type: "done", result}` at the end. `{type: "cancel"}` drops the
running search (nothing more is sent for it); a new `search` also drops the old one. The worker loads
`data/armor/*.json`, `data/weapons/index.json` and the query's weapon class once (about 7 MB, 1 MB gzipped). When a
search cannot run (data did not load, unknown weapon, "only what I own" without an import) the answer is still
`done`, with no results and `stats.error`. **In node**: `ArmorSearch.setData({rules, index, pieces: {head, ...},
weaponTypes, weapons: {class: json}})` (or `loadData(getJson, query)`), then `ArmorSearch.search(query, onProgress)`.

Query (every field but `wanted` optional):

| Field | Meaning |
|---|---|
| `wanted: [{zenith, level}]` | A Zenith skill (`rules.json` `zenith.skills` id): met when the calculator lists it lit at that or a higher skill of its group. `level` 1-7 = Zenith points (default: the fewest that give it). Zenith points come from the weapon, the five pieces and the first cuff with one; in the data every armour piece with a Zenith skill is a Zenith piece and no cuff has one, so the search picks Zenith pieces (a kept weapon's points count). A skill that needs a tree to be lit also aims for that tree's lowest positive skill (`stats.wanted` `implicit`, not counted as met or missing on its own). Impossible (`stats.impossible` `{zenith, problem}`): Guard Up / Reflect Up without a weapon that guards, Stylish Up without a blademaster weapon, Zenith pieces left out, or a rank below GR 200. A result names a missed one as `"z" + id` in `missing` |
| `wanted: [{skill, level}]` | `skill` = a positive skill id (`rules.json` `skills`); met by it or a higher level of its tree. `level` (optional): 1-7 = the tree's n-th positive skill (1 = lowest), 10 or more = a points total (no positive skill needs fewer than 10 points). The higher of the two needs counts; two wanted skills of one tree become one. At most 10. Unknown skills, negative skills and Tech skills of another weapon class come back in `stats.impossible` and the search returns nothing |
| `weaponClass`, `weaponId` | The set format's class (-1 or absent = none). `weaponId` 0 = any weapon of the class (no weapon slots used); a weapon with slots gets decorations; a Tower weapon gets Road gems (below) |
| `gender` | `"male"`, `"female"` or `""` (any): a hard rule |
| `hunterType` | `"blade"`, `"gunner"` or `"any"`: the pieces' blademaster / gunner marks, a list filter as on the page |
| `rankMax: {band, gr, gsr}` | The hunter's rank (`js/armor-rank.js`, "Rank needed to craft"): pieces the smithy does not offer at it are left out (with "only what I own" the owned pieces count whatever their rank); G-rank and Zenith upgrades of HR pieces need GR 1 / GR 200. `band` 1-7 (an older `{hr}` is turned into its band), 0 = no band; a `gr` means band 7. A band with no GR (an HR hunter): no cuffs, no G-rank or Zenith decorations, no GSR pieces. `gsr` null = GSR gates not checked |
| `ownedOnly`, `owned` | Only pieces in the character's equipment box (at the level owned) and decorations and cuffs it has (box, pouch, warehouse and set in gear; never more of one than it has). `owned` is the `/builder` import ("Character import" below) |
| `allowZenith` | false = no Zenith pieces, decorations or cuffs (default true) |
| `allowTowerDecos` | false = no Road gems on a Tower weapon (default true) |
| `fixed: {slot: id}` | That piece in that slot whatever the filters (id 0 = leave the slot empty) |
| `exclude: [...]` | A number = that piece id in every slot; `"head:123"` = one slot's piece; `"item:5803"` = a decoration or cuff |
| `maxResults` | Default 50, at most 200 |
| `timeLimitMs` | Default 8000; a search that hits it returns what it has with `truncated: true` |

Result: `{results: [...], stats, truncated}`. Each result: `set` (the set format above, `data` = the page's data
version), `skills` (the active skills as `ArmorCalc.compute` lists them, dropped ones left out), `extraSkills` (the
positive working ones of other trees), `defence` (pieces + weapon), `res` (`{fire, water, thunder, dragon, ice}`),
`freeSlots` (decoration slots left on the pieces and the weapon), `score` (one number in the ranking order, for
display), `met` (every wanted skill met), `missing` (wanted skill ids not met). `stats`: `ms`, `wanted` (each skill's
tree and points needed), `impossible`, `notes`, `relaxed`, `timedOut`, `gems` (Road gems chosen), `invalid` (sets
the calculator refused; always 0 unless the search has a bug) and per pass the pieces kept per slot, decorations
tried, nodes, sets checked and rejected. `truncated` = the time limit was hit (or a decoration search gave up early),
so better sets may exist.

Ranking: all wanted skills met, then defence, free slots, fewer negative skills, more other skills (automatic ones
too). Pieces are used at their highest level (the owned level with "only what I own"); only pieces players can get
(`obtainable`) unless owned.

How it works (the comment at the top of `js/armor-search.js` has the same in short):

1. **Pieces per slot**: the ones the query allows, then only those no other piece beats: a piece beats another
   when it has at least its points in every wanted tree (points above the need count as the need), as many slots,
   as many skill limit pieces (G-rank / Zenith) and as much defence. This keeps 20 to 60 pieces per slot of about
   8,000.
2. **Branch and bound** over the five slots (fewest pieces first), each slot's pieces by defence: a branch stops
   when even the best pieces left plus the best decoration in every free slot and the best two cuffs cannot reach a
   wanted total, or when its defence cannot reach the worst kept result.
3. **Decorations and cuffs** per complete set: the fewest slots (then cuffs) that reach every wanted total, an exact
   search over the best few decorations per wanted tree and size plus any that help two wanted trees, packed by slot
   size (3-slot decorations in 3-slot pieces, 2-slot in 2-slot first). Answers are cached by the missing points and
   free slots, so most sets cost one lookup. Then `ArmorCalc.calc` decides: a set whose wanted skill is dropped by the
   skill limit, or does nothing with the weapon, is rejected.
4. **Tower weapon**: a wanted skill one Road gem reaches on its own takes a gem place (hardest skills first, as many
   as the weapon has gem places); Tower sigils are not chosen (they give no skill points).
5. **Nothing meets every skill**: it searches again without one wanted skill at a time (sharing the time left)
   and returns the best of those with `met: false` and `missing`.

Limits it accepts: a piece that another one beats is never tried, even when its other skills would have kept a set
under the skill limit; decorations' negative points outside the wanted trees only count in the ranking; automatic
and Zenith skills are not aimed for (they show when a set has them); a cuff is used at most once per set.

Speed (node, `dev/check-armor-search.js`): 3 to 8 wanted skills take 50-250 ms; in headless Chromium the worker
loads the data and answers a 5 skill search in about half a second.

Check: `NODE_PATH=/root/work/pw-tools/node_modules node dev/check-armor-search.js` (`BUDGET_MS`, default 3000, is the
node budget per search; `BROWSER_BUDGET_MS`, default 8000, the worker's with the data load).

## Character import (phase 2, lane C)

Signed in, the builder's "Your character" panel loads one of the player's characters from the API (read-only; the
API never writes a save; only the account's own characters):

- **Character**: from `GET /api/account/characters`; the choice is kept in `localStorage` `hvmhfz.sb.char`.
  Picking one loads `GET /api/account/characters/{id}/builder` (the import: `hunting`, `town`, `mySets`, `owned`,
  `items`, `inEquipment`, `zenny`, `online`, `hasSave`; pieces are `[slot, id, level, [decorations], boxIndex]`,
  slot `melee`/`ranged`/armour slot, level null for weapons, id null for a My Set piece that left the box). The
  hunter's gender filter follows the character. "From the last save", Refresh asks again; when `online` the panel
  says changes since the last save are not shown yet.
- **Load**: the worn set (`hunting`), the town set, or a My Set (with its cuffs) replaces the set shown. A weapon's
  class comes from `data/weapons/ids.json`. Pieces that left the box leave their slot empty, and the page says so.
- **Only what I own**: every picker lists only what the character has: armour pieces from the equipment box (hint
  "yours: Lv N"; picking one takes that level), weapons of the class, decorations, Road gems, sigils and cuffs
  counted from the items (box + pouch + warehouse) and those set in equipment (hint "yours: 3 in boxes · 1 set in
  gear": set in other gear counts as in use). With a character loaded each piece shows "yours: Lv N" or "not
  yours", and each class its count of owned weapons.
- **Missing for this set**: "What am I missing?" posts the set to `POST .../builder/missing` and shows each piece's
  status and cheapest path (owned, level up, upgrade from an owned piece, craft, not craftable with its sources)
  with every step's materials and zenny; decorations, sigils and cuffs (need, in place, from boxes, in other gear,
  missing, the recipe or sources); materials (need, have, missing, sources; each links to `item.html?id=`); zenny
  with "Not complete" when the API's `zenny.complete` is false; the API's notes. When the set changes after a check
  the panel says to check again. Refusals are `{"error"}` and shown as they are.
- The body is the set format with two changes (`ArmorOwned.missingBody`): `data` = the first 12 hex digits of the
  page's `mhfdat.bin` SHA-256 (`data/armor/index.json` `source.mhfdatSha256`, the API's `dataVersion`), so the
  API's "made with game data ..." note is real; armour levels are capped at the piece's highest. A set with no
  weapon, piece or cuff is not sent.

Checks: `NODE_PATH=/root/work/pw-tools/node_modules node dev/check-set-builder-mine.js` (`SHOTS=<folder>` saves
pictures). It also checks that Find sets fills the rank from the character and sends the import with "Only what I
own". Its fake API answers with the DTO shapes of `builder/BuilderDtos.java` and refuses what
`BuilderSet.parse` refuses (a port in the check).

## Community sets (phase 3, lane D)

Players post a set from the Set builder; everyone can browse, filter and upvote; staff hide reported sets. Sets
show as soon as they are posted. The author's hunter name shows only if the player ticked it; a character's
inventory is never public. API side: the lead's work in `hvmhfz_rest_api` (`/api/public/armor-sets`,
`/api/account/armor-sets`, `/api/admin/armor-sets`, `/share/set/<id>`).

| File | What |
|---|---|
| `community-sets.html`, `js/community-sets.js` | Browse (filters in the address), one set (`?id=N`), "My sets" (edit details, delete, link back to the builder) |
| `js/community-api.js` | The sign-in token, one `request()` function, the options answer (bands, stages, limits; a fallback if the API is down), the account's characters, the sign-in link |
| `js/set-post-form.js` | The details form (title, notes, band, stage, character, "Show my hunter name"), used by the builder's post panel and by "My sets" edit |
| `js/set-builder.js`, `set-builder.html` (`#sb-post`) | "Post to Community Sets" panel under the editor; `&edit=<id>` in the address edits one of the player's sets |
| `js/admin-sets.js`, `admin.html` (`tab-sets`, `panel-sets`, `#sets`) | Admin tab: queue (Reported / Hidden / All), one set with reports and log, Hide, Unhide, Dismiss; badge = open reports |
| `css/community-sets.css` | Styles of all of the above (the builder and admin pages load it too) |
| `js/share.js` | The "Copy link" button on `community-sets.html?id=N` copies `https://api.hvmhfz.eclipseforge.xyz/share/set/N` |
| `dev/check-community-sets.js`, `dev/check-admin-sets.js` | Headless checks with a fake API (page, post form, admin tab) |

Address of the list: `community-sets.html?band=hr4&upTo=gr50&stage=zenith&weapon=7&skill=12&skill=40&match=all&sort=new&page=1`
(only non-default values are written; `page` counts from 0; bad values are dropped). A band and `upTo` do not combine
(choosing one clears the other). `?id=N` opens one set. `set-builder.html#s=<code>&edit=<id>` is the builder
editing set `<id>`.

What the page sends with a post: the current set normalized (`ArmorCalc.normalize`, `data` = the page's data
version) and `skills` = the active skill ids the calculator shows that work with the weapon (not idle, negative or
dropped skills). The character select is always sent (staff see which character posted); the name shows publicly only
with `showAuthor`. The band defaults from the character's rank (`SetPostForm.bandFor`), stage to Any.

Endpoints used (errors are `{"message"}`, shown as they are):

| Call | Used for |
|---|---|
| `GET /api/public/armor-sets/options` | bands, stages, `maxTitle` 60, `maxNotes` 1000, `maxReason` 300 (page falls back to built-in values) |
| `GET /api/public/armor-sets?band&upTo&stage&weapon&skill&match&sort&page&size=20` | the list; sent with the sign-in header when there is one so `voted` is right |
| `GET /api/public/armor-sets/{id}` | one set |
| `GET /api/account/armor-sets`, `POST`, `PUT /{id}`, `DELETE /{id}` | my sets, post, edit, delete |
| `GET /api/account/characters` | the character select |
| `PUT` / `DELETE /api/account/armor-sets/{id}/vote` | upvote, remove vote |
| `POST /api/account/armor-sets/{id}/report` | report with a reason |
| `GET /api/admin/armor-sets?status=reported\|hidden\|all&page&size=50`, `GET /{id}`, `POST /{id}/hide` (`{reason}`), `/unhide`, `/dismiss` | admin tab; tool key `sets`, actions `view` and `act` |

Names on a set's page come from `data/armor/` (pieces by slot, decorations and skills from `index.json`) and
`data/weapons/<type>.json`; weapon class names and slugs are fixed lists in `js/community-sets.js` (the classes of
the set format above). Titles, notes, author names and report reasons are only put in with `textContent`.
Signed out, vote, report and post show "Sign in to ..." links that come back to the page (`js/signin-next.js`).

Checks: `NODE_PATH=/root/work/pw-tools/node_modules node dev/check-community-sets.js` and `dev/check-admin-sets.js`;
`SHOTS=<folder>` on the first saves pictures.
