# Database section review (2026-11-11)

The owner (2026-11-11 13:50): "Can you do a look over of the database pages and see if we should reorganize
that section of the site. Also making any of the pages more intuitive on mobile and desktop."

Phase 1 is this review and a proposal. Phase 2 built only the low-risk fixes that keep the structure
(section "Built in this branch"). The restructure waits for the owner's pick.

How it was looked at: the page scripts read page by page; every page and its main states (search, filter,
empty, not found, a deep link) opened in headless Chromium at 375, 768 and 1280 px against the local files and
the live public API (GET only), with the page's JSON sizes, sideways overflow, tap targets under 24 px,
tables and their scroll wrappers, unlabelled fields and page errors recorded. Screenshots and the numbers:
`/srv/devbot/.bot-logs/database-review/shots/` (`<state>-<width>.png`, `metrics.json`).

## What is there today

The Database menu: Monsters, Quests, Catalog, Weapons, Balance changes, Set builder, Quest builder.
"Database" in the breadcrumbs is plain text: there is no Database page.

| Page | What it is | Data loaded | Links out | Gaps |
|---|---|---|---|---|
| Monsters `/monsters.html` | Grid of 166 monster cards, search, species, size, sort | 51 KB index + hunt counts API | each card to its page | no link to a monster's quests from the card |
| Monster `/monster.html?m=` | Key stats, map, game data tabs (hitzones, status, drops, attacks, stats), rank chips | 50-100 KB | "Quests with X" button; drops to item pages | rank chip not in the link; no quest count |
| Quests `/quests.html` | 9,152 quests, 40 a page, search + rank, type, area, monster | **3.2 MB** `quests.json` | quest page, monster pages | no sort; only Previous/Next over ~230 pages |
| Quest `/quest.html?id=` | Facts, description, rewards, monster HP, tracked runs | **11.4 MB** (`quests.json` + `quest-details.json`, for one quest) | items, monsters, category search | no "more quests with this monster" |
| Catalog `/catalog.html` | 16,701 items + 7 equipment sections (API), 30 a page | 751 KB item index | item page | equipment rows have no page and don't link to Weapons; "Sources" column off-screen on phones |
| Item `/item.html?id=` | Dropped by (monster, rank, how, chance), quests needing it | 751 KB index for one item | monsters, quests | **no "Rewarded by" quests**: 14,298 of 16,701 items end with "not mapped" though `data/quests/rewards/` has the data |
| Weapons `/weapons.html` | Type chips, list of every weapon, weapon detail with moves per style, damage calculator; Usage tab | ~10 KB index + one type file (33-148 KB) | Balance changes | calculator sits far below; no marker for weapons the server changed |
| Balance `/balance.html` | The server's published changes to weapons and moves, with reasons | API + weapon files | weapon rows to Weapons | move rows and type groups not linked |
| Set builder `/set-builder.html` | A third-party tool in a frame | none of ours | none | a tool, not data |
| Quest builder `/quest-editor.html` | Sign-in tool to write quests | catalogs for pickers | - | a tool, not data |
| Site search (Ctrl/Cmd+K, every page) | Monsters, items, guilds, hunters, equipment | lazy | - | **no quests, no weapons** |

How you move between things today:

- monster → its quests: yes (button on the monster page); monster → drops → item: yes; item → where it
  drops: yes; item → quests that reward it: **no**.
- quest → rewards → item: yes; quest → monster: yes; quest → back to the list: lost the filters (fixed here).
- weapon → moves: yes, in the detail; weapon → calculator: filled silently, far below (link added here);
  weapon ↔ balance change: one way only.
- catalog equipment → weapon page: no.

What the screenshots showed (the pages hold up well; nothing scrolls sideways at any width):

- Phone, Quests: four full-width filter boxes push the first quest ~950 px down; Category and later
  columns are off to the right; monster icons 30 px.
- Phone, Weapons: the list's sort buttons are 13 px tall and weapon names ~22 px (128 targets under 24 px
  on one screen); the page is 16,000 px long with the calculator at the bottom.
- Phone, Catalog: the Sources column (the reason to open an item) is off-screen.
- Every list (Monsters, Quests, Catalog, Weapons) forgot its search, filters, sort and page on reload, on
  Back from a detail page and in a shared link.
- Quest pages load 11.4 MB to show one quest (about 1.2 s on the VM, much longer on a phone network).
- The Monsters cards said "0 on the server" while the hunt-count API had not answered or failed.
- Tables keep their header row in place (no sticky header or first column) on all pages except the
  admin grid; with 40 rows a page this matters least on Quests and most on Weapons (100 rows).

## Recommended structure

Option A, recommended: **a Database landing page plus a Tools split.**

```
Database                     Tools (new menu, or under Database after a divider)
  Search everything (/database.html)   Set builder
  Monsters                             Damage calculator (weapons.html#calc)
  Quests                               Quest builder
  Items (was "Catalog")
  Weapons
  Balance changes
```

- `/database.html`: one search box over monsters, quests, items and weapons (results grouped, each to its
  page), then a card per section with its count and two or three popular links. The breadcrumb's
  "Database" links to it. The site search (Ctrl/Cmd+K) gets the same quest and weapon groups.
- "Catalog" renamed "Items" in the menu (the page keeps its address); its equipment rows link to the
  weapon in Weapons.
- Set builder and Quest builder move out of the data list: they are tools (one a third-party frame, one a
  sign-in builder), not reference pages.
- Cross-links added: item → quests that reward it; quest monster → more quests with it; balance ↔ weapons
  both ways; monster cards → their quests.

Option B: keep the menu as it is, add only the landing page and the cross-links.
Option C: leave the structure; only the per-page fixes.

## Ranked fixes

Impact H/M/L, effort S/M/L, risk L/M/H. "Built" = in this branch.

| # | Fix | Impact | Effort | Risk | State |
|---|---|---|---|---|---|
| 1 | Lists keep search, filters, sort and page in the address (Quests, Monsters, Catalog, Weapons); Back from a quest returns to the same list | H | S | L | built |
| 2 | Quest page loads one piece (`data/quests/pieces/<id/1000>.json`, as the rewards are) instead of 11.4 MB: `dev/make-quest-pieces.py` writes them from `quest-details.json` and `quests.json` (`--check` in `dev/check-catalog-monsters.js`; 8.7 MB more in the repo); a phone visit 3.2 MB → 0.3-0.5 MB gzipped | H | M | M | built (quest-split) |
| 3 | Item page "Rewarded by" quests (reverse index of `data/quests/rewards/` in `dev/make-item-data.py`) | H | M | L | built (extras) |
| 4 | Tap targets: weapons sort buttons and weapon names, quests monster icons ≥ 40 px on touch | M | S | L | built |
| 5 | Quests on phones: filters two per row; Clear filters; Previous/Next scroll back to the table top | M | S | L | built |
| 6 | Weapons: "Open in calculator" from the weapon detail | M | S | L | built |
| 7 | Monsters cards: no false "0 on the server"; search finds server names | M | S | L | built |
| 8 | Catalog: header sort disabled (it sorted one 30-row page only); error row with Try again | M | S | L | built |
| 9 | Balance: type groups have anchors and link to Weapons; move rows link to their type | M | S | L | built |
| 10 | Monster page: back/forward and `#drops` style links switch the tab | L | S | L | built |
| 11 | Site search covers quests and weapons (small name indexes, ~300 KB and ~60 KB) | H | M | L | proposed (with the landing page) |
| 12 | Database landing page, menu split (Option A) | H | M | M | owner's pick |
| 13 | Catalog equipment rows link to Weapons | M | M | L | built (extras) |
| 14 | Item page loads its own small file instead of the 751 KB index | M | M | L | proposed |
| 15 | Weapons marks weapons and moves the server changed, linking Balance | M | M | L | proposed |
| 16 | Sticky first column on phones for the Weapons and Quests tables | M | S | M (layout) | built (extras; also hitzones, catalog, item) |
| 17 | Monster page rank chip in the link; quest count on the "Quests with X" button | L | S/M | L | rank chip built (extras); quest count proposed |
| 18 | Quests list sort (name, id, area) | L | S | L | built (extras) |

## Built in this branch

Fixes 1 and 4 to 10 above; no page, address or menu moved. Lists write their state with `replaceState`
(no history entry per keystroke; defaults left out) and read it back on load; every old link
(`?q=`, `?monster=`, `?type=&w=`) still works. The weapon list's style chips also set the calculator's
style. After the fixes, the 375 px weapons screen has 20 tap targets under 24 px instead of 128.
Checks: `dev/check-db-lists.js` and `dev/check-db-catalog.js` (new), `dev/check-weapons.js` and
`dev/check-balance-public.js` (extended). Screenshots after: `shots/after/`.

## Built in database-extras

Fixes 3, 13, 16, 18 and the rank half of 17, none of which depends on the restructure.

- Item page: "Rewarded by" (every quest reward group holding the item: quest, rank, condition, quantity,
  chance) and "Dropped by" filled in from the game's own drop tables where the community tables don't list
  the monster (marked *; placeholder "MonNN" monsters left out). Both show the best 10 rows with Show all.
  Items with a source went from 2,403 to 4,789; `data/items/` grew by about 4.7 MB (85,559 reward rows).
- Catalog melee and ranged rows link to the weapon (`data/weapons/ids.json`, 22 KB); the weapon detail links
  back to the catalog by the API's hex id.
- Sticky first column on phones only (max-width 720px, class `sticky-first`): weapons list, monster
  hitzones, quests, catalog (icon and name), item tables. Desktop is unchanged.
- Quests: a Sort box (`?sort=id|name|area`). Monster page: `?rank=` keeps the rank chip.

Checks: `dev/check-db-lists.js`, `dev/check-db-catalog.js`, `dev/check-monster-pages.js`, `dev/check-weapons.js`
(extended). Screenshots: `/srv/devbot/.bot-logs/database-extras/shots/`.

## Leave alone

- The monster page layout and its game-data tabs: clear at every width, tables already scroll in place.
- The quest page layout (only its data loading needs work, fix 2).
- The Balance page's grouping and history; its empty, not-published and no-answer states are good.
- The weapons Database/Usage tabs (correct tab roles and arrow keys).
- Page addresses: every existing `?m=`, `?id=`, `?q=`, `?monster=`, `?type=&w=` link keeps working; a
  restructure should rename menu entries, not move pages.
