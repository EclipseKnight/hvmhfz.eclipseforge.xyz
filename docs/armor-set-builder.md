# Set builder (armour set builder, phase 1 lane B)

Design: project home `docs/designs/2026-11-15-armor-set-builder.md`. This file holds the formats the other lanes
use (A: decoded rules in `hvmhfz_re`; C: the API's `/builder` and "missing" endpoints; D: community sets).

## Files

| File | What |
|---|---|
| `set-builder.html`, `js/set-builder.js`, `css/set-builder.css` | The page: weapon, five pieces with levels, decorations, sigils, cuffs; summary with active skills, points per tree, defence, resistances; the set in the address |
| `js/armor-calc.js` | The calculator and the set format (encode, decode, normalize, compute). No page code; node runs it too |
| `js/armor-rules.js` | Every game rule the calculator needs, read from `data/armor/rules.json` |
| `dev/make-armor-data.py` | Writes `data/armor/` from `hvmhfz_re` `data/skills_db.json` and the live patch's `mhfdat.bin` |
| `dev/check-set-builder.js` | Calculator, rules, data and page checks (node + headless Chromium) |

Data: `data/armor/<slot>.json` (one per armour slot, about 1.2 MB, 180 KB gzipped, loaded when the slot is first
opened or a link needs it), `data/armor/index.json` (decorations, Road gems, cuffs, Tower sigils, weapon automatic
skills, skill names), `data/armor/rules.json`. Weapons come from `data/weapons/`, skill trees from
`data/skills/index.json`. Field lists are in the docstring of `dev/make-armor-data.py`.

Rerun `python3 dev/make-armor-data.py` after a client patch changes `mhfdat.bin` or `skills_db.json` is rebuilt
(defaults: patch v1.29 zip in `/root/backups/client-patch/`), then the check.

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

In the address: `set-builder.html#s=<base64url of the JSON, no padding>` (`ArmorCalc.encode` / `decode`; a code
that does not decode starts an empty set and says so). Gender and the "only what players can get" tick are list
filters, not part of the set.

## Rules file (`data/armor/rules.json`)

Until lane A decodes the rules from the client, the file is a fallback (`"exact": false`) and the page marks every
answer that depends on it with `*`. Lane A: write the decoded rules in this shape, then
`python3 dev/make-armor-data.py --rules <file>`; if a rule needs another shape, change `js/armor-rules.js` only.

| Key | Meaning | Fallback today |
|---|---|---|
| `version`, `exact`, `source` | data version, true once decoded, where it comes from | patch version, false, "fallback ..." |
| `skillLimit` | `{base, max, raises: [{skill, add}], exact, note}`: limit = base + the raises of active skills, capped at max | base 10, no raises |
| `overLimit` | `{known, order: [tree ids]}`: the game keeps the first `limit` active skills in this tree order | unknown: nothing dropped, the page warns |
| `weapon` | `{treeClasses: {tree: [classes]}, blademasterTrees, gunnerTrees, gunnerClasses, exact}` | the skill list's categories: Hiden trees work only with their class, Blademaster/Gunner trees with that kind |
| `zenith` | `{known, pieceSkills: {"slot:id": [skill ids]}}`: skills Zenith pieces add | none |
| `levels` | `{defencePerLevel: {rarity: [added at level 1..N]}, topSlotsAt: "max", exact}` | defence = level 1 value; top-level slots only at max level |
| `cuffSlots` | cuff slots | 2 |
| `bonuses` | `{skills: {skill id: {defence} or {res: [fire, water, thunder, dragon, ice]}}, exact}` | read from the skill names (Defense+20, Fire Res+10, All Res Up +5) |

Armour data not yet exact (from the record, medium confidence in the design): resistances (+0x14..+0x18), the
wear bits (+4: male, female, blademaster, gunner), top-level slots (+0x1c).

## Not in phase 1

Character import, "what I own" and missing materials (phase 2, lane C), search by wanted skills (phase 2b: until
then the page links to d0t-execute's Frontier Set Searcher), community sets (phase 3), upgrade lines on this page
(each piece links to its equipment page, which shows the line and materials).
