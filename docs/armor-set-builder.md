# Set builder (armour set builder, phase 1 lane B)

Design: project home `docs/designs/2026-11-15-armor-set-builder.md`. This file holds the formats the other lanes
use (A: decoded rules in `hvmhfz_re`; C: the API's `/builder` and "missing" endpoints; D: community sets).

## Files

| File | What |
|---|---|
| `set-builder.html`, `js/set-builder.js`, `css/set-builder.css` | The page: weapon, five pieces with levels, decorations, sigils, cuffs; summary with active skills, points per tree, defence, resistances; the set in the address |
| `js/armor-calc.js` | The calculator and the set format (encode, decode, normalize; `calc` = the game's recompute, `compute` = the page's set checked and calculated). No page code; node runs it too |
| `js/armor-rules.js` | The game's rules for one row at a time (activation, weapon gate, Zenith, limit parts, defence and slot growth, gender), read from `data/armor/rules.json` |
| `dev/make-armor-data.py` | Writes `data/armor/` from `hvmhfz_re` `data/armor_rules.json` and `data/armor_builder.json`; stops when their data version is not the patch zip's `mhfdat.bin` |
| `dev/check-set-builder.js` | All 3,000 client answers of `hvmhfz_re` `data/armor_calc_cases.json`, the data rows against `hvmhfz_re`'s, rules, page checks (node + headless Chromium) |
| `js/armor-owned.js` | Character import helpers (no page code; node runs it): import pieces to a set, what is owned, the "missing" request body |
| `js/set-builder-mine.js` | The "Your character" panel, the "Only what I own" filter hooks and the "Missing for this set" panel |
| `dev/check-set-builder-mine.js` | Set format cross-check with the API, the helpers, and the page against a fake API (headless Chromium) |

Data: `data/armor/<slot>.json` (one per armour slot, about 1.2 MB, 180 KB gzipped, loaded when the slot is first
opened or a link needs it), `data/armor/index.json` (decorations, Road gems, cuffs, weapon Tower sigils, weapon
Zenith skills, Tower flags and automatic skills, skill names), `data/armor/rules.json` (the rules and the skill
trees). Weapons come from `data/weapons/`. Field lists are in the docstring of `dev/make-armor-data.py`.

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

## Not built yet

Search by wanted skills (phase 2b: until
then the page links to d0t-execute's Frontier Set Searcher), community sets (phase 3, see "Community sets" below), upgrade lines on this page
(each piece links to its equipment page, which shows the line and materials).

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
pictures). Its fake API answers with the DTO shapes of `builder/BuilderDtos.java` and refuses what
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
