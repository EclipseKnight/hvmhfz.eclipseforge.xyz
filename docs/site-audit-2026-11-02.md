# Site audit, 2026-11-02 (branch site-broken-sweep, from origin/main 718b0d0)

The owner (2026-11-02 20:46): many quests in the quest catalog list monsters the monster list doesn't
have, and many links to hunters and monsters open the overall page instead of the one asked for. This is
the whole-site sweep: every page, every script, the data behind them.

## How it was checked

- **Static:** `python3 dev/check-links.py` (from branch site-guide-rebuild, e8a4699, extended here):
  every local link, picture and `#anchor` of every page and stylesheet; now also the query of each
  detail link (the target page's own scripts must read that parameter, and `monster.html?m=` /
  `quest.html?id=` must name something in the data), the links built in `js/*.js`, every file a script
  names, and `sitemap.xml`.
- **Data:** `node dev/check-catalog-monsters.js` (new): every catalog monster resolves to a monster
  page, `data/quests.json` is what `dev/make-quest-monsters.py` writes, and the monster index holds
  together (files, pictures, old link forms, game ids).
- **In the browser:** headless Chromium on all 32 pages and 364 detail URLs (every monster slug and old
  slug, quests, hunters and guilds by id and by name, list pages with `?q=`), signed out against the live
  API's public GETs only; and the signed-in pages against a fake API built from the API's Java response
  records (section "Signed in"). Page errors, console errors, failed requests, visible
  "undefined"/"NaN"/"null". The crawl scripts are not in the repo (they need Playwright and, signed out,
  the live API).
- **API:** every `/api/...` path the site calls against the controllers of `hvmhfz_rest_api` at
  `a3aca9a` (the live build): all 70 exist. Field mismatches are below.
- The other checks in `dev/` (all pass, see the end).

## Problems found

Status: **fixed** in this branch, **left** (why), **API** (needs an API change, described under "API
changes needed"), **out of bounds** (files of another task).

### Detail links that opened the list page or "not found"

| # | Problem | Where | Cause | Status |
|---|---|---|---|---|
| 1 | Hunter names in the quest log's party column, the weapon board and the Worlds page's recent quests open the hunter list, not the hunter | `js/questlog.js:106`, `js/weapon-board.js:55`, `js/worlds-quests.js:85` | they link `/hunters.html?name=`; `js/hunters.js` read only `?id=` and `?q=` | fixed: `hunters.js` reads `?name=` and opens the one hunter of that exact name (two or none: the list, searching). API: send the character id (A1, A2): done, see "API changes needed" |
| 2 | A hunter profile's guild badge opens the guild list | `js/hunters.js:604` | linked `/guilds.html`; the profile has no guild id | fixed: `/guilds.html?name=`, which `js/guilds.js` now resolves like 1. API: `guildId` (A3): done |
| 3 | 9 monster pages say "That monster is not in the database": Hypnocatrice, Breeding Season Hypnocatrice, Silver Hypnocatrice, Kamu and Nono Orugaron, Lolo and Ray Gougarf, Berserk Laviente, Rusted Kushala Daora; their cards, the search and every link to them landed there | `data/monsters/index.json` | the 29 Oct rename (60fc0d7) gave the index new slugs but left the data files under the old ones (`hypnoc.json` ...) | fixed: files renamed to the index slugs; the short slugs of 28 to 29 Oct still open them (`formerSlugs`, `js/monster.js`) |
| 4 | "Shogun Ceanataur" in the guide was Ceanataur's page (the small crab, "Small monster", no hunt count); the real Shogun Ceanataur page (3 forms) was unlisted, `?m=syougun` said not found | `data/monsters/index.json` | the same merge renamed the Ceanataur entry (yao) instead of keeping both | fixed: both entries, each with its own file |
| 5 | "Duremudira (Musou)" in the guide was Musou Bogabadorumu's page with its icon; the real Musou Duremudira page had Bogabadorumu's icon | `data/monsters/index.json`, `data/monsters/duremudira-musou.json` | same merge | fixed |
| 6 | Hermitaur, Musou Bogabadorumu, Musou Deviljho, Musou Nargacuga and Musou Zerureusu were missing from the guide (pages existed; links `?m=gami`, `joeK`, `nalgaK`, `zeruK` said not found) | `data/monsters/index.json` | dropped by the same merge | fixed: listed again, named in full, files `musou-<monster>.json` |
| 7 | Quest page and catalog monster links were made from the name ("Orugaron" -> `?m=orugaron`), so every name the index spelled differently went to "not found" | `js/quests.js:124`, `js/quest.js:133` | name-to-slug guessing | fixed: `js/monster-links.js` resolves by guide name, server name or game id; a name without a page is plain text |
| 8 | A quest's category link opens the whole catalog | `js/quest.js:55` | `?category=`, which `js/quests.js` never read | fixed: `?q=`; `quests.js` reads `?q=` and `?monster=` |
| 9 | Item links from monster drop tables and from the site search open the whole catalog | `js/monster.js:150`, `js/search.js:114` | `js/catalog.js` never read `?q=` | fixed: it does |
| 10 | "Monster hunt counts" in the site search and the quest page's fallback open the whole field guide | `js/search.js:117`, `js/quest.js:133` | `js/monsters.js` never read `?q=` | fixed: it does; the search's counts go to the monster's page by id |
| 11 | A hunter or guild link with an id that doesn't exist left a dead page (empty table, search box doing nothing) | `js/hunters.js`, `js/guilds.js` | the page returned before wiring the list | fixed: the list works, with "not found" |
| 12 | Monster names on the leaderboards' "Most hunted", a hunter's top monsters, the account hunt log and the Worlds page's top monsters were not links | `js/leaderboards.js:80`, `js/hunters.js:729`, `js/account.js:716`, `js/worlds.js:61` | none made | fixed: each links its monster page by id |
| 13 | Event quest ids on the Events page were not links, and the note said quest names live in the client | `js/events.js:165` | written before the quest catalog | fixed: each id opens its quest page (all 200 live event quests are in the catalog) |

### Quest catalog monsters

| # | Problem | Where | Cause | Status |
|---|---|---|---|---|
| 14 | 2,273 quests listed the wrong monsters or none: 1,566 named one in the objective but listed none; subspecies lost (Silver Rathalos quests as "Azure Rathalos" 51, Gold Rathian as "Pink Rathian" 35, Azure Rathalos as "Rathalos" 56, Zerureusu as "Rathalos" 30, Pink Rathian as "Rathian" 68, Breeding Season Hypnocatrice as "Hypnocatrice" 64, Blue Yian Kut-Ku 51, Purple Gypceros 49, Gureadomosu as "Mosswine" 25, Ashen Lao-Shan Lung 4, Red Volganos as "Lavasioth" 42); other spellings (Orugaron 112, now Kamu 74 / Nono 38; Espinas Subspecies 56; Kuarlusepusu 48; Hypnocatrice Rare 34; Espinas Rare Species 33; Eruzerion 15); wrong names ("Dahren Mohran" on 37 Harudomerugu quests, "Gargwa" on 8 Anteka quests) | `data/quests.json` | the lists came from the English objective; there was no generator in the repo | fixed: `dev/make-quest-monsters.py` writes every list from the Japanese objective (a table of 150 Japanese names), in the guide's names; `docs/quest-fields.md` and `data/quest-fields.json` updated (the aliases are gone) |
| 15 | Shagaru Magala (12 quests) has no monster page | `data/monsters/` | the guide's data (Ferias tables) has none | left: listed by name without a link; `dev/check-catalog-monsters.js` names it as the one known gap. Mi Ru (game id 113) has no page either (no quest lists it) |
| 16 | Hunt counts on the field guide showed 0 for 14 monsters the server has hunts of (Akura Vashimu and Jebia, Volganos and Red Volganos, Orange and White Espinas, Silver and Breeding Season Hypnocatrice, Lolo and Ray Gougarf, Elzelion, the three Duremudiras) | `js/monsters.js:13-30` | matched by name through a table keyed by the old slugs, which the rename made dead | fixed: matched by the game's monster id (`ids` in the index, from `data/monster-ids.json`) |

### Everything else

| # | Problem | Where | Cause | Status |
|---|---|---|---|---|
| 16b | King Shakalaka showed as a small monster, without its hunt count | `js/monsters.js:15` | kept apart by its old slug `cyacyaKing` | fixed: `king-shakalaka` |
| 17 | Fatalis and Rathian pages showed a broken picture next to the title | `data/monsters/index.json`, their data files | `render` named `blackfatalis.webp` and `rathian.webp`, which don't exist | fixed: Fatalis uses `fatalis.webp`, Rathian has no render |
| 18 | The sitemap listed every monster by its old slug (each opened through a 404 first) and 6 that no longer opened (gami, dolem, joeK, nalgaK, zeruK, syougun); Hunting Road guide and Report page missing | `sitemap.xml` | not updated with the renames | fixed: the 158 current slugs, plus guide-roads.html and report.html |
| 19 | The Linux guide's "Appendix: English text and language" link went nowhere | `guide-linux.html:106` | `#english` exists only in the Windows guide | fixed: links the Windows guide's appendix |
| 20 | The quest page's share preview pointed at the catalog | `quest.html:12` | `og:url` was `/quests.html` | fixed |
| 21 | No Search button on 7 pages | `guide-linux.html`, `guide-roads.html`, `guide-windows.html`, `quest-editor.html`, `quest.html`, `quests.html`, `road-data.html` | `js/search.js` not loaded | fixed |
| 22 | No Search button on the 5 Frontier handbook pages | `guide-frontier*.html` | `js/search.js` not loaded | out of bounds (task site-guide-rebuild): add `<script src="/js/search.js" defer></script>` before `</body>` |
| 23 | Old monster links log a 404 before they open | `js/monster.js` | it tries `data/monsters/<old slug>.json` first, then the index | left: it works, and the sitemap and the site's own links use current slugs now |

### Signed in (fake API built from the API's Java records)

24 signed-in URLs (every account and admin tab, the Road builder with an entry and a draft, the vote page
open and closed, the quest builder, monsters, report, a hunter, the Road board), also as a new account with
nothing and with a closed rotation. No JavaScript exception, and no call to an endpoint the API lacks.

| # | Problem | Where | Cause | Status |
|---|---|---|---|---|
| 24 | The account page's "Custom quests" tab never opens (click or `#quests` falls back to Overview), so the upload form and the submissions list can't be reached; the quest catalog's "Upload a quest file" links there | `js/account.js:7` | `TABS` lacked `"quests"` | fixed |
| 25 | Admin, Custom quests: Publish and Reject never show | `js/admin-quests.js:62` | shown for status `pending` only; the API creates every submission as `testing` (`QuestSubmissionController.java:128`, `QuestDraftController.java:240`) and its decide accepts both (`:204`) | fixed: shown for both |
| 26 | The hunter share card's "WEAPONS USED" is always 0 | `js/hunters.js:419` | read `hunter.weapons`; the API sends `weaponTime` | fixed |
| 27 | The report page's "link it" (Discord) goes to the Account tab, which has no link command | `js/report.js:92` | the command is on the Overview tab | fixed: `#overview` |
| 28 | The quest builder opened with `?id=` says "Loading your drafts." forever under the refusal | `js/quest-editor.js:1310` | returned before loading the drafts | fixed |
| 29 | Hunt log of an account with no characters: empty stat cards, no note | `js/account.js:775` | only the storage tab was reset | fixed: zeros, "No hunts recorded", "no characters" |
| 30 | Gift tag line "Gift list: Normal up to 1 take each" | `js/account.js:834` | joined with a space | fixed: " · " |
| 31 | A refused quest upload or Road draft save shows a generic message (or "Unexpected end of JSON input") instead of the API's reason | `js/quest-submissions.js:69`; API `quest/QuestSubmissionController.java:85-118`, `road/RoadDraftController.java:44-110` | the API throws `ResponseStatusException` with no handler there; its own comment (`QuestDraftController.java:250-254`) says that becomes a bare 401 | fixed: API 5b6d085 answers with status and message (A5); `js/quest-submissions.js` and `js/road-drafts.js` show that message, and a plain sentence for a bare 401/413 or an answer that is not JSON |
| 32 | The Road builder's points cap (4x) is a site default only; the API neither sends `maxPoints` in the policy nor checks it (allows up to 100) | `js/road-rules.js:94`; API `road/PolicyRules.java:29-39`, `:62-67` | not built on the API side (the README already says so) | API (A4): `maxPoints` sent and checked from API 5b6d085; the site already read it; harmless while `points` is not in `road.edit.floor-fields` |
| 33 | A moderator (not admin) probably can't reach the admin Server and Audit tabs: `js/admin.js` asks the admin-only `/api/admin/distributions/options` first | `js/admin.js` start | not tried (the fake token is an admin) | left: unverified, read only |

## API changes needed

API repo `hvmhfz_rest_api`, files at `a3aca9a`. A1 to A3 make links exact (the site falls back to a name
search until then); A4 and A5 come from the signed-in sweep.

**Status (2026-11-03): all five are in API main 5b6d085** (additive only, about to be deployed), and the site
uses them: `worlds-quests.js` and `questlog.js` link the row's `charId` and each `partyMembers` entry,
`weapon-board.js` the top hunter's `charId`, `hunters.js` the guild badge's `guildId`
(`/hunters.html?id=`, `/guilds.html?id=`); each keeps the `?name=` link when the field is missing, so the site
works before and after the deploy (`dev/check-exact-links.js` runs both against a fake API;
`dev/check-links.py` fails a script that links `?name=` without `?id=`). A4: the site already read
`maxPoints`. A5: the quest upload note and the Road draft note show the API's message. Original text:

- **A1.** `GET /api/public/quests/recent` and `GET /api/public/quests/hunter/{charId}`
  (`activity/QuestLogController.java`): add `charId` to each row (`recent` selects `qs.char_id` already,
  line 50, but doesn't send it), and send each party member as `{"charId": n, "name": "..."}` instead of
  a bare name (`partyOf`, line 266: select `c.id` too). Then `js/worlds-quests.js:85` and
  `js/questlog.js:106` link `/hunters.html?id=`.
- **A2.** `GET /api/public/weapons/leaderboard` (`activity/WeaponTime.java:39`): add `charId` to
  `TopHunter(String hunter, long seconds)`. Then `js/weapon-board.js:55` links `?id=`.
- **A3.** `GET /api/public/hunters/{id}` (`payloads/responses/PublicDtos.java:65`, `HunterProfile`): add
  `guildId` (next to `guildName`). Then the guild badge (`js/hunters.js:604`) links `/guilds.html?id=`.

- **A4.** Road policy (`road/PolicyRules.java`): send `maxPoints` in `describe()` (lines 29-39) and refuse a
  floor's `points`/`points2` above it in `check()` (lines 62-67). The site already reads it (`js/road-rules.js:94`).
- **A5.** `quest/QuestSubmissionController.java` and `road/RoadDraftController.java`: add the same local
  `@ExceptionHandler(ResponseStatusException.class)` that `QuestDraftController` has (lines 250-254 explain
  why), so a 400/413/409 reaches the page with its `message`.

Until then a name shared by two hunters (or guilds) opens the list searching for it, which is the honest
answer.

## Checks at the end

| Check | Result |
|---|---|
| `python3 dev/check-site.py` | site shell OK |
| `python3 dev/check-links.py` | 32 pages, the scripts and the sitemap: no broken links |
| `node dev/check-catalog-monsters.js` | OK: 6,586 mentions in 9,152 quests, 158 guide entries; known gap Shagaru Magala |
| `node dev/check-quest-fields.js` | quest fields OK |
| `node dev/check-activity.js`, `check-builder-icons.js`, `check-road-monsters.js`, `check-road-policy.js`, `check-road-rewards.js`, `check-road-summary.js` | all pass |
| `python3 dev/check-road-data.py` | road data OK |
| `node dev/check-nav-mobile.js`, `node dev/check-quest-maps.js` (headless) | pass |
| `node dev/check-road-rules.js` | not run: needs the decoded live Road base (game data); no Road code changed |

Both new checks fail on the old data and code (check-links: 15 problems, check-catalog-monsters: 167).
