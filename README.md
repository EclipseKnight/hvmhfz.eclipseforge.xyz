# hvmhfz.eclipseforge.xyz

Hunsterverse account portal, community pages and setup guides for Monster Hunter Frontier Z.

## Pages

| Path | What it does |
|---|---|
| `/` | Home: a hero with two buttons ("New here? Start playing" to `/play.html`, "Already playing? Sign in" to the form), the sign-in form beside it (after the tiles on screens below 1160px; its "Create an account" link, or `/#signup`, swaps it for the sign-up form, `js/signup.js`: `POST /api/auth/signup` with Turnstile, rules as the API's, the API's refusal shown as it is, then signed in like the sign-in), one row of tiles per audience (New here, Play, Community, Tools, Account; each tile a guide card picture or monster icon that is already on the site) and "What's new". After a successful login it hands over to `?next=` when that is a path on this site (`js/signin-next.js`: starts with `/`, no `//`, no backslash, scheme, space or control character, not the home page itself; the form then says why, e.g. "Sign in to use the Quest builder"), else to `/account.html`. |
| `/account.html` | Signed in view: overview (with the Hunting Road rewards and a character picker to claim them), characters, hunt log, guild, custom quests, backups, transfer, game options (Road you play and the game options, with Keys, Viewer options and the pre-release options in folds), client patch, diagnostics and account (details, session). The tabs are sub-tabs (`js/subtabs.js`, see Sub-tabs below); old links keep working: `#storage`/`#details` open Characters, `#account` the Account tab, and the short `#qol`, `#options`, `#settings` (Game options), `#patch` (Client patch), `#diag` (Diagnostics; `#live-reports` is the "Live reports from your game" box on it, `js/account-telemetry.js`), `#discord`, plus any id inside a tab (`#diag-panel`, `#game-options-keys`). Characters: the list (each name links to its public hunter card, `/hunters.html?id=`, and "View" opens it below) and the character view (`js/account-details.js`), one character at a time in seven sections: Overview (ranks, playtime, money, stamps, guild, lifetime hunts, the account's gacha coins, house, a link to the hunter card), Equipment (the six worn slots with names, or the kind and id when the name is unknown, weapon class, rarity, armour levels, decorations and sigils), Loadouts (the in-game equipment My Sets: pieces, decorations, cuffs; a piece no longer in the box says so), Item box (the 6,000 slots as in game, pages of 100 with a preview, or as a list; search jumps to the page; a phone opens the list), Pouch, Warehouse (icon, name, count, search) and Equipment box (a table with class, rarity, level and decorations, slot chips and search); counts on the section chips. Every item, weapon and armour piece shows the game's own icon in the game's colour (`js/game-icons.js`, see "Game icons" below; the placeholder `assets/builder/no-icon.svg` for anything unknown). It reads `GET /api/account/characters/{id}/details` (API README "Character details") and `/storage` (own characters only), both when the tab is first shown; while the API answers 404 on details the equipment parts say "coming soon" and the boxes still show; an admin gets a box to open any character id (no item lists for another account's character). Old `#storage` and `#details` links land on the Characters tab (the item box or the overview). Custom quests (`js/quest-submissions.js`; up to five waiting or in testing at a time, approved quests never count): the submissions with each testing quest's expiry date (14 days without activity) and Keep testing, Resubmit for an expired quest while its file is kept (30 days), the quest drafts with their deletion date (90 days untouched) and Keep, and the deleted drafts with Restore (30 days); a reminder 3 days before either shows at the top of the page whatever tab is open (API README "Custom quest expiry"). Backups: download a character's backup zip, import a file into a character (preview, then confirm) and the account's imports; "coming soon" until the API has the account endpoints (`docs/character-backup-web.md`). Transfer (`#transfer`, `js/account-transfer.js`): the transfer wizard in six steps (account, file, what is in it, where it goes, confirm, "Now install and play"): it reads our backup zip, another server's zip, a newer Erupe export JSON or a bare save file, previews it with `POST /api/account/characters/import-new/preview`, and makes it a new character (`import-new`) or imports it into a character already on the account (the Backups tab's preview and older-file warning); a signed-out visitor goes to `/?next=/account.html#transfer`, where they sign in or create an account and come back; "coming soon" until the API has `import-new`. Without a valid session it sends the visitor to `/?next=/account.html...#login-form`, and back after sign-in; signing out goes to `/`. |
| `/balance.html` | Balance changes (`js/balance-public.js`), public: what the server changes in the game's weapon and move values, from `GET /api/public/balance` (API README "Server balance"; off until the owner sets `balance.public-enabled`). The live version, its date (UTC) and note; the changes grouped by weapon type and style (all types and all styles first, a weapon's stat rows after its type's moves), each with the move (name, confidence badge and `k0 #165`, how it is used, what it is on a tap, as on the weapons page) or weapon (linked to `/weapons.html?type=&w=`), the field, the game's value → the new one (from `data/weapons/`, `js/balance-fields.js`: every field, coded ones such as element, status, shell or phial by the game's names, "Fire → Thunder"; a factor shows `×1.1` and the result when the value is known, `?` when the data has none) and the reason with its http(s) links clickable (Discord links read "Discord thread"); then the history of versions, newest first, with notes and roll backs. An empty table says "No balance changes: the game's own values"; a 404 or no published version says "Not published yet"; no answer offers Try again. In the Database menu after Weapons, linked from the weapons page. `dev/check-balance-public.js`. Each weapon-type group has an anchor (`#great-sword`, `#great-sword-extreme`), and its heading and move rows link to that type on the weapons page. |
| `/monsters.html` | Monster field guide: search by name or species, cards link to full hitzone, HP and drop pages. `?q=` opens it searching. Hunt counts match the server's by monster id (`ids` in `data/monsters/index.json`). Search also finds the server's names; the search, species, size and sort stay in the address (`?q=`, `species=`, `size=`, `sort=`), and a hunt count shows "-" until the server has answered. `dev/check-db-lists.js`. |
| `/monster.html?m=slug` | One monster. With the game's own data (`data/monsters/game/<id>.json` for the entry's first `ids`, `js/monster-game.js`, labelled "from the game's data"): Key stats beside the map (base HP, HP range, weak elements and best cut/impact/shot/element spot at the highest rank) and a panel with rank chips (Low rank, High rank, HR100+/Hardcore, G rank, Zenith; identical ranks merged) and five tabs (`#hitzones`, `#status`, `#drops`, `#attacks`, `#stats`): Hitzones (a heat-coloured table per monster state, the best part of each column outlined, a part name with * matched from the community table by its values, then the stagger and break values), Status (threshold, increase and how many times, most, duration, recovery, damage; immune), Drops (per drop rank: carves with their count, tail carves, extra carves, shiny drops, capture, part breaks, Zenith tiers; items link `/item.html?id=`), Attacks (every monster with mapped records: the game's attack file for 99 and up, the older monsters' linked DLL rows; power, KO, element, the damage to a hunter for a quest level and defence, a certainty badge per line (game file, confirmed on HD + SD, HD only), a "guess" badge on community names, a family note where several monsters share the rows, "Not mapped yet" for the rest; the community attack list folded below) and Stats (class values, HP and multipliers per level). The community tables (status text, HP labels, stagger notes, the Form picker) stay in a labelled fold; community hitzones and drops show only where the game's data has none. Without game data: hitzones normal and enraged, HP by level, stagger limits, maps, every carve table, Henshu/GR/Zenith forms. A link to its quests. `slug` is `data/monsters/<slug>.json`; older links with the entry's `oldSlug` or `formerSlugs` still open it. An entry made from our own data instead of the field guide's tables (Shagaru Magala, id 164, Mi Ru, id 113, Unknown, id 100, and the five Musou versions without ids of their own, `musou-pariapuria`, `-zinogre`, `-guanzorumu`, `-mi-ru`, `-elzelion`: name, quests, a short `about` note, optional `questsHref`/`questsLabel` for the quest link; `"ferias": false` drops the Ferias credit) shows empty tables. Back/forward or a changed hash (`#drops`, `#attacks`, ...) switches the tab. The rank chip stays in the link (`?rank=low-rank`, from the chip's label; the highest rank, the default, is left out). |
| `/events.html` | What is running: one card per event (Diva Defense, MezFes, event campaigns, Speedrun Cup, VS Bracket, Hunter Festival, then Raviente, Caravan rankings, Sky Corridor, the Hunting Road vote and event quests, which are always shown) that opens on a tap (a button with `aria-expanded`; Enter, Space and Escape work) to say what the event is, how to take part, what you get, when, tips and links (the text of every card is one entry per event key in `js/event-info.js`: edit it there), and with its state, from `/api/public/events/current` (the schedules Erupe writes: phase in words, when it ends and the content; an event with no row is off and its card is left out; a stale row says so) or, while that endpoint is missing or empty, from the static schedule kept in `js/events.js` (update it when a schedule changes; the Hunter Festival card reads `/api/public/festa`, the API's old 2023 `diva` event row is not shown), the event quest pool and the Festa prize table (`/api/public/events`; when that does not answer the cards still show). |
| `/tournaments.html` | Tournaments (`js/tournaments.js`): the Speedrun Cup standings from `/api/public/tournament/standings` (this week's quest, phase and closing time, last week's results, a table per weapon class picked with chips, plus the Guild board; "No clears yet" for an empty board) and the VS Bracket from `/api/public/vs-bracket/current` (phase, entrants, sign-up end, the rounds as columns, stacked on phones, with names, Bye, Hidden hunter, cleared ticks, times once decided, the winner and the champion). An endpoint that 404s, fails or answers null shows a "not running yet" note for its section. Linked from the Events page and the Server menu. |
| `/guilds.html` | Guild directory: search, sort by RP, members, newest or name. `?id=` opens a guild with roster and board; `?name=` opens the one guild of that exact name (else the list, searching). |
| `/hunters.html` | Hunter rankings: search, sort by HR, GR, recent or name. `?id=` opens a hunter profile; `?name=` opens the one hunter of that exact name (else the list, searching), for pages the API gives no character id; `?q=` opens the list searching for a name. |
| `/leaderboards.html` | Timed hunt boards: top hunters, top guilds (hunts by current members) and most hunted monsters for this week, last week, this month, last month and all time (UTC; weeks start Monday), from `/api/public/leaderboards/hunts`; plus guild RP. `#<board>-<period>` picks one (`#hunters-week`, `#guilds-month`, `#monsters-all`, `#rp`); the old `#hr`, `#gr` and `#guilds` links still land on a board. Tied scores share a rank. The Sky Corridor board (`#tower`) ranks tower points; its chips switch to the Duremudira kills, floors or tower clears board for all districts or one (`#tower-kills-all`, `#tower-floors-3`; `/api/public/sky/leaderboard`, all time, the API's order and ranks). |
| `/database.html` | The Database page: one search over monsters, quests, items, weapons, sources and skills as you type, the results grouped by kind (up to 6 each; a kind chip shows up to 50 of one kind), each to its page, with "Search in Monsters/Quests/Items" to the list; then a tile per section (Monsters, Quests, Items, Sources, Skills, Weapons, Balance changes) and per tool (Set builder, Damage calculator, Quest builder). `?q=` and `?kind=` stay in the address. Keys: Down from the box into the results, Up/Down between them, Up from the first or Esc back, Enter in the box opens the first hit, `/` focuses the box. It loads only the small indexes (`data/monsters/index.json`, `data/items/index.json`, `data/search/quests.json`, `data/search/weapons.json`, `data/sources/index.json`; about 420 KB gzipped together, loaded on the first focus), through `js/search.js`'s `HvSearch`, the same engine as the header search. The Database crumb of every Database page links here. `dev/check-db-search.js`. |
| `/items.html` | Items (called Catalog until 2026-11-11; `/catalog.html` forwards here with its query and #anchor, `js/page-moved.js`, and is noindex): every item and the equipment sections, with section chips and search. `?q=` opens it searching (monster drop tables link here). The section, the search and the page stay in the address (`?slot=`, `?q=`, `?page=`); the paged table has no header sort; a failed load shows a Try again row. Melee and ranged rows link to the weapon on `/weapons.html?type=<slug>&w=<id>` (`data/weapons/ids.json`, the API's id byte-swapped; the API's "Dummy" rows stay plain). On phones the icon and name columns stay in place when the table is swiped. `dev/check-db-catalog.js`. |
| `/item.html?id=N` | One item (`js/item.js`, data from `dev/make-item-data.py`: `data/items/index.json` and `data/items/<id>.json`): first **Where to get it** (from `dev/make-source-data.py`: every source players can use, grouped as Shops, Gacha, Events and gifts, Sky Corridor, Crafting, Exchanges and other rewards, Monsters, Quests; each line the source linked to `/source.html?id=` with quantity, price and currency, chance, tier or condition, rank gate and limit; recipes with their materials linked to their items; monster drops in quests players can start linked to the monster; the number of quests players can start that reward it (to Rewarded by) or let you gather it (Show the quests); "No known source" when nothing gives it; the 8 first lines of a group, then Show all), then Dropped by (community drop tables, plus the game's own tables `data/monsters/game/` for a monster they don't list, marked *), Rewarded by (the quests whose reward groups hold it, from `data/quests/rewards/`: quest, rank, condition, quantity, chance; a quest file no quest list offers is marked "not offered") and Needed to enter. The two tables show their best 10 rows (by chance) with Show all, rank chips and a filter box. `?name=` (an exact name) still works. `dev/check-monster-pages.js`, `dev/check-source-pages.js`. Then **Used for** (`dev/make-use-data.py`, `data/uses/<id>.json`; a 404 means no use): every recipe, piece of equipment, Tower upgrade, exchange and quest that takes the item, grouped as Crafting (item combining, the Combiner), Weapons, Armour (smithy create and upgrade steps, transmog unlocks), Decorations (smithy decorations, skill cuffs), Tower (Tower smithy sigils and gems, the gem mixer, Tower weapon upgrades to the maximum), Exchanges (Series Quests) and Quests (deliver objectives, and "Needed to enter" linked to its panel); each group counted, 8 lines shown, then "Show all" (200 at a time) and a filter box over more than 8; pieces link to `/equipment.html`, results and other inputs to their items, systems to their source page. `dev/check-uses.js`. |
| `/equipment.html?slot=<head\|chest\|arms\|waist\|legs\|melee\|ranged>&id=N` | One weapon or armour piece (`js/equipment.js`, `js/equipment-materials.js`, data `data/equipment/` from `dev/make-use-data.py`): name, rarity, a weapon's type linked to its stats on `/weapons.html?type=&w=`; Upgrade line (the pieces it is upgraded from, first made one first, each linked, and what it upgrades into); Materials (every way to make it: at the smithy from scratch with its list, upgrade from a piece with the zenny, transmog unlock; each material linked to its item); a Tower weapon's upgrade costs per stat. The Items page's armour rows link here when a recipe names the piece, the Weapons page's detail lists the same materials. `dev/check-uses.js`. |
| `/sources.html` | Sources (`js/sources.js`, `data/sources/index.json`): every place items come from, by group (Shops: the Hunting Road shop by tab, the Diva GCP item shop, Diva shop, Diva limited shop, Diva Defense coin exchange, Frontier points shop, town zenny shop; Gacha: each gacha; Events and gifts: each campaign, Hunter Festival prizes, Diva Defense lists, weekly conquest, Speedrun Cup, VS Bracket, gifts; Sky Corridor: treasure by district and the present box; Crafting: smithy decorations, Tower smithy, Tower decorations, gem mixer, Combiner, cuff workshop, armour refinement, item combining; Exchanges: merit-point lottery tiers, guild treasure hunts, stamp card, weekly stamp exchange, Raviente claim, quest supplies, weapon ammo; Quests: quest rewards and gathering), each with its item count and currency; a box filters them (`?q=`). In the Database menu after Items, in the Database page's tiles and the search ("Sources" kind). `dev/check-source-pages.js`. |
| `/source.html?id=<id>` | One source (`js/source.js`, `data/sources/<id>.json`): every item it gives in a sortable table (item with icon linked to its page; the columns it uses of quantity, price with currency, chance, quests, when, rank gate, limit, materials linked, note; `*` marks the Road shop rows of the game's own list), a filter box (`?q=`); an unknown id says so. Crumbs Database › Sources › name. `dev/check-source-pages.js`. |
| `/skills.html` | Skills (`js/skills.js`, `data/skills/index.json` from `dev/make-skill-data.py`, from the game's own tables via hvmhfz_re `docs/skills-db.md`): the 196 armour skill trees (category, levels with points and skill names, how many armour pieces players can get, decorations, Road gems and automatic skills give each), the 35 Road skills and the 73 Tower sigils; category chips (the community Armor Skill List's sections, plus Road skills and Tower sigils) and a search box, both kept in the address (`?cat=`, `?q=`). In the Database menu, on the Database page (tile, chip) and in the site search. |
| `/skill.html?id=<tree>` | One skill tree (`js/skill.js`, `data/skills/<id>.json`): its levels (points, skill, what it does as the game says, or that the game has no text; a level at 16,384 points is shown as never turning on), then Decorations and Road gems (item linked, points, slots, whether players can get it), Automatic skill (equipment with it on by itself, linked), Armour (every piece with the tree's points, most first, 100 at a time with Show more, a name filter and "Only pieces players can get", on at first; pieces with an equipment page linked). `?road=<id>` a Road skill (levels, where it works), `?sigil=<item>` a Tower sigil (effect, its item page). Share pages `s/skill/<id>.html`. Item and equipment pages show a "Skills:" line under the name (`js/skill-links.js`: a decoration's, Road gem's or piece's points and a piece's automatic skill, each linked; a Tower sigil's effect). |
| `/weapons.html` | Weapon database and damage calculator, static: pick a weapon type (chips), then a sortable, searchable list (element/status and rarity filters, 100 a page) with attack as shown and true, affinity, element, status, slots and the sharpness bar drawn (gunners: charge levels and arc shot, or recoil and reload). A weapon opens its stats and the move list of its type (MV per hit, element/status, KO, Charge Attack Up bonus; styles E/H/S/X). Each move shows its plain name first, a confidence badge (confirmed, likely, guess; an unknown move shows its id and "unnamed") and its id small (`k0 #165`); a tap opens what it is, its input and its sources (Wycademy, the Japanese MHF-Z wiki linked; the game's data and our record study named only), with a legend of the badges (`js/move-names.js`, shared with the Balance grid and `/balance.html`; data from hvmhfz_re `data/move_names.tsv`). Under each move a line says how it is used (hvmhfz_re `data/move_usage.tsv`, `docs/weapons.md` 7.8: a kind badge, own input, combo, part of <move>, charge/state, not used or not identified, the how and how sure); later hits sit under their move behind "+N later hits" (in the calculator each shows its own damage when opened, not added to the move's); the moves the game never uses are left out until "Show unused and unknown moves" is on (`?unused=1`, remembered in localStorage `hv-moves-unused`; the admin Balance grid has the same toggle). The calculator (blademasters) shows per move no crit, crit and expected damage from the game's formula (hvmhfz_re `docs/weapons.md` sections 4-5: crits do nothing below green sharpness), with Critical Eye, Starving Wolf+2, Ceaseless, Fencing+2, Charge Attack Up, weapon technique, Adrenaline+2/Worry, DS demon mode, LS spirit, hitzones typed in or picked from the game's data per monster, rank, state and part (`data/monsters/game/`; a monster without it uses its page's community table, marked "(community)"). `?type=<slug>&w=<id>` opens a weapon. Data: `data/weapons/` from `dev/make-weapons-data.py`. A Usage tab (`#usage`, `js/weapons-usage.js`) reads `GET /api/public/weapons/usage` (API README "Weapon usage") when first opened: 7 or 30 days, a bar per weapon type with the hunters by current weapon and their share, the hunters who played it, a stacked bar of their styles, a rank band filter (played and styles are not split by band, so they hide), the hunter total and when it was worked out; a 404 says the stats are not published yet, no answer offers Try again. The list's search, element and rarity filters, sort and page stay in the address next to `?type=&w=` (`q=`, `elem=`, `rarity=`, `sort=`, `dir=desc`, `page=`); a weapon's detail has an Open in calculator button and a Find in the catalog link (`/catalog.html?slot=melee|ranged&q=<the API's hex id>`), and the move style chips set the calculator's style. On phones the list's first column stays in place when the table is swiped. On touch screens the sort buttons, weapon names and chips are 40 px tall. |
| `/quests.html` | Quest catalog from `data/quests.json`: every quest file, search and filters, monster icons linking to their pages. `?q=` opens it searching, `?monster=<guide name>` filtered to one monster. A Sort box: id highest first (the default), id lowest first, name (the game's "？？？？？" names last) or area. The search, the four filters, the sort and the page stay in the address (`?q=`, `rank=`, `type=`, `area=`, `monster=`, `sort=`, `page=`), so a reload, a shared link or the quest page's way back opens the same list; Clear filters resets them; Previous/Next go back to the top of the table. On phones the filters sit two to a row and the quest column stays in place when the table is swiped. `dev/check-db-lists.js`. |
| `/quest.html?id=N` | One quest: category, area, objective (the quest file's main objective, then its sub-objectives A and B), time, rewards money, monsters (each to its page), description, tracked runs, Rewards (the quest file's reward groups with their condition, items linking `/item.html?id=`, count and chance per draw) and Monster HP (each monster at the quest's level, linked to its page), both from `data/quests/rewards/<id ÷ 1000>.json`. Everything else comes from its own piece, `data/quests/pieces/<id ÷ 1000>.json` (`dev/make-quest-pieces.py`), asked for together with the rewards piece: one visit downloads about 300-530 KB gzipped instead of 3.2 MB; a piece that fails to load says so with Try again (`dev/check-quest-page.js`). Back to the quest catalog (and the Quests crumb) returns to the filtered list it was opened from; a rewards file that fails to load says so. |
| `/worlds.html` | Live world status, the live board (who is online, in town or on a quest and which quest, and who is questing together, from `/api/public/activity`; each name links to its hunter profile by `charId`, or to the Hunters page searching for it when the answer has no `charId`) and server wide hunt totals, refreshed every 30 seconds. |
| `/play.html` | Play: three cards, each a numbered checklist with one download per step: New on Windows, Linux / Steam Deck (marked not tested yet) and Bringing a character from another server (a "where to get your file" table per source type, then the account page's Backups tab or Discord `/link` and `/import`). The Windows and Linux account steps ("Make your account, then log in") link to the sign-up form (`/#signup`) and keep REGISTER in the launcher as the other way. Ticks are kept in this browser (`localStorage` `hvmhfz.play`, `js/play.js`, listed in `privacy.html`); Copy buttons for the server settings (name, host, launcher and game port, from `docs/launcher.md`) and the Discord commands. Marked slots for the one-click installer and our own full download stay hidden until `SLOTS` in `js/play.js` has the flag on and a URL. Every route for a new player ends here: the home page (main button, sign-in box, "Start playing", "New on Windows", "Linux / Steam Deck" and "Bringing a character" tiles, to the card anchors `#windows`, `#linux`, `#transfer`), the Frontier guide, the 404 page, the Guides menu and the footer. Each card ends with collapsible "More help" sections (`<details>`, ids `windows-patch`, `windows-trouble`, `linux-packages`, `linux-patch`, `linux-prefix`, `linux-wrapper`, `linux-trouble`), and a last panel holds `#language` (English and Japanese text) and `#discord` (linking and bot commands); `js/play.js` opens the one a link or address points at. Last, `#patches` "Client patch versions": the current patch (version, date, size, full SHA-256 with Copy, download from `client_patch`) and a table of the older ones (date, what changed, known problem, size, short SHA-256 with Copy, download from each version's own release `client-patch-v<version>`; one card per version on a phone), from `data/patch-versions.json` (`js/play.js`; the patch size in the steps, `[data-patch-size]`, follows the current one). Versions are `v1.N`, one step per public patch; add one with `hvmhfz_ops` `hunsterverse/mezeporta/release-patch.sh`, which prints the entry. The setup guides that used to hold this text are now only redirect pages (see below). |
| `/guide-windows.html`, `/guide-linux.html` | Redirect pages for the old Windows and Linux guides (the setup guides were folded into the Play page, 4 Nov 2026). Meta refresh to `/play.html#windows` / `#linux`, canonical, noindex, a visible "This guide moved to Play" link, and a small inline script that maps the old `#anchors` (`#patch`, `#trouble`, `#prefix`, `#english`, `#discord`, ...) to the matching Play card or "More help" section. Not in the nav, the footer or the sitemap. |
| `/guide-frontier.html` | Frontier guide, landing page: one card per section (picture and one line), grouped in five chapters (`#start`, `#gear`, `#reference`, `#progression`, `#activities`), plus links to our own guides, the comparison page and the credit to the original guide's author. In the nav under Guides ("Frontier guide"), and a card and a step on the home page. |
| `/guide-frontier-<section>.html` | One guide section each, 18 in reading order: `basics`, `guild`, `house`, `menus`, `items`, `item-box`, `weapons`, `armour`, `transcend`, `monsters`, `tools`, `hunter-rank`, `g-rank-start`, `g-rank`, `zenith`, `quests-food`, `events`, `hunters-road`. Each has breadcrumbs, a side column with "On this page" and "All sections" (sticky on wide screens, folded above the text on phones), the text with its pictures, previous/next links and the credit. Rewritten from Fist's guide (saved as a PDF in January 2022; owner: credit the author by name, don't link the original or its resources). Every section ends with an "On Hunsterverse" note comparing it with our server. |
| `/guide-frontier-hunsterverse.html` | Hunsterverse vs the old servers: a short summary of the differences, the course perks every account has, and one table row per section note (generated by `dev/make-hv-summary.py`). Linked from the landing page and every page's credit. |
| `/guide-frontier-equipment.html`, `-activities.html`, `-reference.html` | Old handbook addresses: a short notice listing the pages that replaced the chapter, and a redirect to its chapter on the landing page. `noindex`, not in the sitemap. |
| `/changelog.html` | Rolling player changelog: "Coming next" (finished, not live), then the released updates by month, day and topic, newest first (contents by month and day; anchors `#d-YYYY-MM-DD` and `#d-YYYY-MM-DD-<topic>`), each change with its release time in UTC in the page, rewritten with JavaScript to the visitor's own time zone with UTC on hover (`js/changelog-times.js`, `js/time.js`), then known issues. Linked from the footer. Update it at every live deploy (below). |
| `/road-vote.html` | Hunting Road rotation: phase and dates, the entries, vote or take a vote back during the vote window, results after it closes, with the saved sign-in. Signed out (or expired) it shows the Road live now from the public `/api/public/road/versions` (the rotation itself, `/api/road/cycle`, needs the sign-in), how a rotation runs, links to Past winners, Road data and Roads in game, and a "Sign in to vote" button that comes back here. The nav's "Hunting Road › Rotation and vote" link. Needs the saved sign-in; API `/api/road/**`. |
| `/road.html` | Hunting Road builder: per floor its table and two Road points multipliers (capped by the policy's `maxPoints`, default 4x), per table its entries (monster, second monster, weight, forced, level: a picker of any level 0 to 83, the rows of the game's stat table, the ones the live Road uses with that monster first and the others marked "may play at base strength"), add an entry, reset to the base. The monster pickers (`js/builder-ui.js`, with each monster's icon and a search box) offer all 176 monsters the game knows (ids as Erupe's `common/mhfmon`, kept in `js/road-rules.js`; shown under the monster pages' names, its `GUIDE_NAMES`): first the ones the live Road uses, then the Zenith forms ("Zenith Rathalos", first monster only, for the 20 monsters the base Road has a Zenith entry for; the edit sends `"zenith": true` or `false` only when the monster would otherwise come out in the other form, and the server copies the base's own Zenith or normal entry; `dev/check-road-zenith.js`), then those new to the Road. An "Also change the solo Road" box (off by default) shows the solo Road (mode 1) to edit when the policy allows mode 1; unticking it drops those changes. Lists every change from the base in words ("Changes from the base", `js/road-summary.js`), for the Road being built and for an entry opened from the vote page. Checks the rules live with `js/road-rules.js`, asks `POST /api/road/check` before submitting (POST) or saving (PUT), and won't submit while the page itself lists a problem. A "?" circle on every field, button and column says what it does in the game (`js/road-help.js`; hover or focus shows it, a tap keeps it open; on a phone a key above the tables stands in for the hidden column headers). `?entry=<id>` opens an entry (yours to edit during submissions, others read-only). A "Test in game" panel (`js/road-test.js`, shown only while the live setting `road_test` is on) builds the Road being edited with the submission rules (`PUT /api/account/road-test`) and has the game server serve it to the player's account and the quest rooms they host for a set number of hours, as practice (nothing of the runs is saved; Erupe `docs/hvmhfz-road-test.md`); Stop ends it (`DELETE`). Everything about the Road itself (base, tables, policy) comes from `GET /api/road/pool` at run time; the builder holds no game data itself. Signed in only (signed out it sends the visitor to `/?next=/road.html...` and back after sign-in), `noindex`. |
| `/road-data.html` | Hunting Road data, public and static: every Road the server has run (number, name), per floor its Road points multipliers, monster table and monsters with their chance, open and solo Road. No script: `dev/make-road-data.py` writes the tables into the page from the decoded Road files (see that file); run it again when a new Road goes live. |
| `/sky-corridor.html` | Sky Corridor (the Tower), public, from `/api/public/sky/*` (`js/sky.js`, `js/sky-corridor.js`): the town's Duremudira progress per district as bars toward the goals (districts 3 and 4 counted but not shown in town), totals and the last clear; each district card with its party runs, tower clears, hunters and a link to its board (`#district-N` opens that district's board); the hunter boards (floors, Duremudira kills or tower clears, all districts or one, all time or this week: hunters with a clear since Monday 00:00 UTC, still with their all-time totals); the 33 guild missions by page and the guilds with their page's three missions; the present box milestones with how many reached and received each; what the Tower is and how to get in, with links to the Frontier guide. An API without these endpoints (404) or without the tables (`tracking: false`) shows "Sky Corridor stats are coming soon". The hunter profile's Sky Corridor tab (`#sky`) comes from `/api/public/sky/hunter/{id}`: totals, each district with its kills, clears, floors and its ranks on that district's boards (each district links to its board), the present box (floors, tower clears and each district's Early Reward, "First Duremudira kill in District N"), guild missions; and stays hidden on a 404 or when the hunter has nothing there. |
| `/road-history.html` | Past Hunting Road winners (number, name, character, votes, live from and until), public, from `/api/public/road/history`. |
| `/admin.html` | Admin panel: gifts (Erupe distributions) and the Hunting Road rotation (rotations with entries and votes, create, change dates, close now, approve, override the winner, hide/unhide/disqualify, pause). Lists every gift with its items, claims and end, creates a gift (for everyone or one character, with rank limits, a deadline and items picked from the catalog) and ends one. Admin accounts only: the API checks `ROLE_ADMIN` on every `/api/admin/**` request; the account page links here for admins. Its Users tab (`js/admin.js`) is a compact table, one row per account: Account, Discord (the Discord name with the @username, the id in the hover text and a Copy id button, only the id when the API has no name), Roles (badges), Characters (the count and up to three chips), Last login, Status (a `pre: <slot>` badge, `op`, `timer`) and one Manage button (a click on the row also opens it). Manage opens one drawer under the row (Esc or Close shuts it; it stays open after a save): a checkbox per role from `GET /api/admin/roles/available` (a fixed list on an older API) saved with one Save (`PUT /api/admin/roles/users/{id}`; an older API's 404/405 falls back to `POST /api/admin/roles` once per changed role; removing admin, moderator or helper takes a second click; admins only, others see the roles read only), the Discord Link/Change and two-click Unlink, the chat flags, the patch channel select, every character and the Logins button. The search finds an account, a character, or a Discord name, @username or id (`match=discord` for Discord only) and highlights the match. Character chips show the client patch (the version the game sent at its last login, from client patch v1.19; `js/admin-patches.js`) and a line counting played characters on the current patch (the one marked current in `data/patch-versions.json`), an older one, or unknown (v1.18 or older, or not seen since the recording started); `dev/check-admin-patches.js`. Its Custom quests tab (`js/admin-quests.js`) shows "N of CAP event quest slots used" (`GET /api/admin/quest-submissions/event-slots`; approved quests share the in-game event quest list) and the API's reason when a publish is refused because the list is full. Its Balance tab (`js/admin-balance.js`; `GET/POST/PUT /api/admin/balance/**`) edits the draft of the server-side balance table, mostly through a grid (`js/admin-balance-grid.js`): move sets (a weapon type and style, one line per move, a column per attack field, an "All moves" multiplier line) or weapons (one line per weapon of a type, searched and paged), each move with its name, confidence badge and id, what it is on a tap or hover (`js/move-names.js`), the find box searching names, descriptions, inputs, entries and ids; each cell the game's value (every attack field: a move's own record values, data/weapons `rec`; `js/balance-fields.js`), tapped to edit (Enter down, Tab right, Esc cancels; `x1.05` multiplies; the game's value, nothing or the reset button deletes the row; element, status, special (GL shell, SAF phial, HH note set), bow arc shot and charge row and a move's element flags show the game's names and edit with a list of them, sending the API's code), each change saved to the draft at once with the session reason (asked once); the Changes table edits a row's reason; the form under "Other rows" makes rows the grid cannot show: attack move (weapon type, style, entry and record id, each possibly any), melee weapon or ranged weapon, field, set or multiply, with a required reason; names and the game's current values come from `data/weapons/` (type files, from the weapon database; without it the tab works with numbers typed by hand and says so); the draft against the published version, Publish with a note (two steps, sends the draft's fingerprint), versions with Roll back; moderators read only; `dev/check-admin-balance.js`.  Its Flags tab (`js/admin-flags.js`, `css/admin-flags.css`; `/api/admin/flags/**`) is the review queue of odd accounts (a lot of GCP or other points, saves that cannot be real): flags as cards by severity with the numbers (value, threshold, cap, current value), the why text, dates, source, status and reviewer; status (Open default) and rule filters; a flag's detail with its history and the account's other flags; Approve, Cheat (value prefilled with the suggested value, editable; a rule without a currency only marks) and Undo on history entries ("Undo anyway" after a 409 with `canForce`), each behind a confirm showing old -> new; bulk Approve / Cheat on ticked flags with per-id results; a collapsible Rules table (the 12 rules with the live check text and "refuses imports"; enabled, threshold, severity and, for rules with a currency, the ceiling; an empty ceiling is not sent because the API keeps the current one) and Scan now with the last scan line; a badge with the open and critical counts on the tab button (`GET /api/admin/flags/summary`, loaded when the page opens, also for moderators); admins write, moderators read only; `dev/check-admin-flags.js`. Not in the nav, `noindex`. **Staff permissions** (`js/admin.js`, `js/admin-permissions.js`; API `/api/admin/permissions/**`): the page first asks `GET /api/admin/permissions/mine`, hides the tabs the account cannot view and opens the first allowed one (an older API without it: all tabs as before), and exposes `window.hvStaff` (`can(tool, action)`, `admin`, `roles`) to the tabs, which hide buttons by permission (Flags: Approve, Cheat, Undo, bulk, rules, Scan now, notes; Users: roles, Discord, chat flags with `users act`, patch channel and the Pre-release slots with `patches`; Server restart; Balance and Settings read only without `act`). Roles: admin, moderator and the new helper (a Helper checkbox and badge in the Users tab). The admin-only Permissions tab is a table of every tool and action per role (ticks saved at once, a dot for a change from the default, two-click Reset to defaults, a notice when the table is missing). A flag's detail also shows a Character panel (`GET /api/admin/flags/subject/{userId}?character=`: character and account facts, currencies against caps, quests, flags with history, imports, logins, shared-IP count (never an IP), other characters, admin actions, staff notes with an Add note form; links to the hunter page and `admin.html#users?q=<name>`); `dev/check-admin-staff.js`. |
| `/report.html` | Bug report (`#bug`) and feature request (`#feature`) forms, for signed-in accounts only: signed out (or expired) the page shows why and a Sign in button that comes back here (`/?next=/report.html...`) and no forms; a 401 from the API (sign-in ran out) asks to sign in again and keeps what was typed (`sessionStorage` `hvmhfz.report-draft`, put back in the form after sign-in). Each report becomes a task on the Kanboard board. |
| `/bot-terms.html` | Prontier bot: Terms of Service (effective 5 Nov 2026): who runs the Discord bot, what its commands and posts do (from `hvmhfz_discord_bot`; no chat relay), acceptable use, no warranty, changes and termination, not affiliated with Capcom or Discord. Linked from the footer. The bot's privacy facts are in the "Prontier Discord bot" section of `/privacy.html#bot`. |
| `/diagnostics-data.html` | What the game's live diagnostics sends (crash and usage data, "telemetry"): in short, when it sends (timings, retries, offline queue), every field (the tables between `<!-- telemetry-fields:begin/end -->` are generated by `hvmhfz_re` `tools/diag/telemetry_fields.py --html`, never edited by hand; a test there fails when the client sends a field the page lacks), two example reports (`pre[data-example]`), what is never sent, where it goes, who sees it, 30 days, what we use it for, the local files, how to turn it off, and the Account page's "Live reports from your game". Linked from the footer, the Server menu, `/privacy.html#game-data` and the Account Diagnostics tab. Checked by `dev/check-live-reports.js`. |
| `/privacy.html` | Privacy and cookies: what the site, API, game server and bot keep, why and how long, the browser storage it uses (`hvmhfz.token`, `hvmhfz.consent`; no cookies of its own), other services (GitHub Pages, Cloudflare Turnstile, the set builder embed, Discord) and players' rights. Linked from the footer and the cookie banner. Update it when the site starts storing or sending anything new. |

## Layout

```
index.html            home and sign in
account.html          signed in account view (sub-tabs: overview, characters with the character view, hunts, guild, custom quests, backups, transfer, game options, client patch, diagnostics, account)
guilds.html           guild directory and detail
hunters.html          hunter directory and profile
leaderboards.html     timed hunt leaderboards and guild RP
database.html         the Database page: one search over monsters, quests, items, weapons and sources, and the section and tool tiles (js/database.js)
items.html            items and equipment (js/catalog.js)
equipment.html        one weapon or armour piece: upgrade line and materials (js/equipment.js, js/equipment-materials.js, data/equipment/)
sources.html          every item source by group (js/sources.js); source.html one source and its items (js/source.js); data in data/sources/
skills.html           every skill (js/skills.js); skill.html one skill and what gives it (js/skill.js)
catalog.html          the old address of items.html: forwards to it with its query and #anchor (js/page-moved.js), noindex
weapons.html          weapon database and damage calculator (data/weapons/, js/weapons.js, js/weapons-calc.js, js/move-names.js), Usage tab (js/weapons-usage.js)
balance.html          balance changes: the published server-side balance table with reasons and its versions (js/balance-public.js)
worlds.html           world status, live board and hunt totals
play.html            Play: Windows, Linux / Steam Deck and character transfer checklists
guide-windows.html    redirect to /play.html#windows (old Windows guide)
guide-linux.html      redirect to /play.html#linux (old Linux guide)
report.html           bug report and feature request forms
guide-frontier.html   Frontier guide landing page (cards per section)
guide-frontier-*.html Frontier guide sections (18), the comparison page and three moved-page notices
bot-terms.html        Prontier Discord bot terms of service
privacy.html          privacy and cookies policy (with a Prontier bot section, #bot)
diagnostics-data.html everything the game's live crash and usage reporting sends
admin.html            admin panel: gifts (distributions) and the Hunting Road rotation
road.html             Hunting Road builder and entry viewer
road-vote.html        Hunting Road rotation: entries, vote, results
road-history.html     past Hunting Road winners (public)
sky-corridor.html     Sky Corridor: town progress, boards, guild missions, present box (public)
tournaments.html      Speedrun Cup standings and VS Bracket (public)
road-data.html        Hunting Road data per Road and floor (public, static, written by dev/make-road-data.py)
changelog.html        player changelog (rolling, one entry per live update)
css/styles.css        shared guild-hall theme (leather page, parchment panels, brass trim, gold buttons)
assets/guide/*.webp   guide screenshots, WebP
assets/guide/<section>/ Frontier guide pictures, WebP, one folder per handbook section
css/guide-frontier.css Frontier guide layout only (side column, pictures, cards, previous/next, "On Hunsterverse" notes)
assets/backgrounds/   page background pictures (rules and sizes in its README.md)
assets/favicon.png    site icon
js/play.js            Play page: saved ticks, copy buttons, hidden installer and full download slots and opening the "More help" section a link points at
js/page-moved.js      a page that moved (catalog.html -> items.html): forwards to the new address with its query and #anchor
js/guide-moved.js     the old Windows and Linux guide pages: forwards an old address and its #anchor to the matching Play card or section
js/nav.js             site nav: the four menus, and the Menu button on narrow screens
js/background.js      page background: a random picture from assets/backgrounds/ per page load, dark and blurred
js/consent.js         cookie banner (Accept/Decline, kept in localStorage hvmhfz.consent); runs held-back optional scripts after Accept
js/guide-frontier.js  Frontier guide: opens the side lists on wide screens, marks the section in view
js/whatsnew.js        home page "What's new": the newest day of changelog.html
js/time.js            times in the viewer's own time zone (HvTime): "12 Nov 2026, 15:12 CET", <time datetime> with the UTC time as its title, relative times, fixed-zone resets said both ways ("Sun 16:00 your time (Mon 00:00 JST)"), and the footer's "Times: my timezone / UTC" setting (localStorage hv-times); every page that shows a time loads it before its own scripts, and page scripts fall back to their old text without it (and under node)
js/changelog-times.js changelog: rewrites each UTC release time in the visitor's time zone (js/time.js), the UTC text stays without JavaScript
js/main.js            login, saved session; after sign-in goes to ?next= (js/signin-next.js) or the account page
js/signin-next.js     sign-in return: which ?next= paths are followed, the form's note, and the sign-in address the Road builder, Quest builder and account page send signed-out visitors to; also runs under node
js/turnstile.js       Cloudflare Turnstile widget, shared by main.js and report.js
js/signup.js          home page sign-up form (/#signup): the API's name and password rules, POST /api/auth/signup, its refusals shown as they are, then on like sign-in; the rules also run under node
js/report.js          report forms: signed-in only (else the Sign in panel), send, success, error, 401 (sign in again, draft kept) and Discord fallback
js/admin.js           admin panel: gift list, new gift form, end a gift (/api/admin/distributions); Hunting Road rotations (/api/admin/road)
js/road-rules.js      Hunting Road rules in the browser (port of the Go road package); also runs under node
js/road-summary.js    Hunting Road: a Road's changes from the base, in words (builder and entry view); also runs under node
js/road.js            Hunting Road builder
js/road-help.js       Hunting Road builder: the "?" circle on every field, button and column (HELP: what each does in the game)
js/builder-ui.js      controls shared by the Road and Quest builders: picker with icons and search, number inputs, fields, sections, add/remove buttons
js/quest-editor.js    Quest builder (quest-editor.html), in building order; see docs/quest-editor-web.md
assets/builder/no-icon.svg  the one placeholder the builders (and js/game-icons.js) draw for a monster or item without a picture
assets/icons/1x/<key>.png, assets/icons/2x/<key>.png  the game's item and equipment icons in their colours, 32 and 64 px (see "Game icons")
js/road-vote.js       Hunting Road vote page
js/road-history.js    Hunting Road past winners
js/road-rewards.js    Hunting Road rewards on the account page: labels and the claim body per board (design, score); also runs under node
js/account.js         account page: tabs, characters list, hunt log, guild, gifts, Road rewards
js/account-details.js account page, the character view on the Characters tab: overview, equipment worn, My Sets, item box, pouch, warehouse and equipment box of one character (GET /api/account/characters/{id}/details and /storage); its helpers also run under node
js/game-icons.js      item and equipment icons: the icon key of an item (data/item-icons.json) or a piece (its type and the colour the game gives it: data/equipment-icons.json), the 1x/2x files, the placeholder for anything unknown; its lookups also run under node
js/link-command.js    the Discord link command the account page shows, `/link code:<code>`, built from the API's token (the API's own `!f link` text is not shown); also runs under node
js/account-backup.js  account page, Backups tab: download, import with preview and confirm, import history (docs/character-backup-web.md); its preview renderer is window.HvImportView
js/account-transfer.js account page, Transfer tab: the transfer wizard (a file into a new character, or into one on the account)
js/backup-file.js     backup zips: writes the bot's /backup layout from the API's answer, reads our zips, older zips, Erupe export JSON and a bare save file for an import; also runs under node
js/guilds.js          guild directory and detail
js/hunters.js         hunter directory and profile
js/leaderboards.js    leaderboards, from /api/public/leaderboards/hunts and the guild list
js/sky.js            Sky Corridor: API calls, labels and the hunter profile's Sky Corridor tab; its helpers also run under node
js/sky-corridor.js   Sky Corridor page: town progress, boards, guild missions, present box
js/event-info.js      what each Events card says when opened: one entry per event key (what, steps, gets, when, tips, links)
js/events.js          Events page (and its "Now / Next" line and "Side event now / next" line from /api/public/events/calendar (current, next, sideCurrent, sideNext)); its row-to-card helpers also run under node (dev/check-tournaments.js)
js/admin-events.js    admin panel Events tab: the event calendar (/api/admin/events/**); times shown in the viewer's zone (js/time.js), the strip and the time boxes in UTC; two lanes, one event at a time each: the main event (Hunter Festival, Diva Defense; Monday 03:00 UTC) and the side event (Speedrun Cup, VS Bracket; Thursday 15:00 UTC), each run drawn in its eventLane row (a transition run too), the lane being the event's (no lane field in the form); the gaps (red, in the lane that has no run: no main event, no side event) with "Fill this gap"; one "extend the loop" form per lane (generate with lane main or side, prefilled from loopNext and sideLoopNext); drag a planned run to move it or an edge to change its length (snaps to the hour and to its lane's boundary; long press on phones; arrow keys), checked live against the API's rules, then a before/after preview, the API's check and Save (PUT); a "?" circle on every field says what it does in game (HELP, from Erupe's event docs); its helpers also run under node
js/admin-settings.js  admin panel Settings tab: the game server's live settings (/api/admin/settings/**), forms from the API's spec, review before save, history and revert; the Patch gate section also counts who it would refuse now (/api/admin/settings/patch_gate/impact, stored values, then the form's as edited); its helpers also run under node
js/admin-balance-grid.js the Balance tab's grid: the values of a move set or a weapon type as editable cells, each cell one draft row (create, update or delete); its helpers also run under node
js/admin-balance.js   admin panel Balance tab: draft rows (the Changes table, reasons editable), pickers for move / weapon / field with names and current values from data/weapons/ (numbers by hand when missing), diff against the published version, publish and roll back (/api/admin/balance/**); its helpers also run under node
js/admin-flags.js     admin panel Flags tab: the flag review queue, detail with history, approve / cheat / undo, bulk, rules and scan (/api/admin/flags/**); its helpers also run under node
js/admin-permissions.js admin panel Permissions tab (admins): who may do what per role (GET/PUT /api/admin/permissions, POST .../reset); window.hvStaff itself is set by js/admin.js
css/admin-flags.css   styles of the admin Flags tab (admin.html only)
js/balance-fields.js  the balance fields' game values (every attack field of a move, from data/weapons "rec") and the game's names of coded fields (index.json "codes") as the API's codes; shared by the Balance grid and the balance page, also runs under node
js/balance-public.js  balance changes page: /api/public/balance grouped by weapon type and style, names and the game's values from data/weapons/, history; its helpers also run under node
js/admin-notices.js   admin panel Notices tab: login notices (the live settings section login_notices) with an MHFML preview, Send now in game and/or on Discord (/api/admin/notices/send, two clicks), scheduled notices (/api/admin/notices/scheduled, cancel); times in UTC; its helpers also run under node
js/admin-content.js   admin panel Content tab: the event content editors (/api/admin/content/**), lists and forms built from the API's specs; items searched in data/item-ids.json; its helpers also run under node
js/admin-patches.js   admin panel Users tab: client patch per character and the current / older / unknown count (GET /api/admin/users, data/patch-versions.json); its helpers also run under node
js/tournaments.js     Tournaments page: Speedrun Cup standings and the VS Bracket; its helpers also run under node
js/catalog.js         the Items page: sections, search, paging; armour rows link to equipment.html
js/equipment.js       the equipment page: upgrade line, materials, Tower upgrades
js/skills.js          the Skills page: trees, Road skills, Tower sigils, category chips and search
js/skill.js           one skill: levels, decorations, Road gems, automatic skills, armour (paged, filtered)
js/skill-links.js     the "Skills:" line of the item and equipment pages (window.HvSkillLinks)
js/equipment-materials.js the material lists of a piece (window.HvMaterials), for equipment.html and the Weapons page's detail
js/hr.js              stored HR -> the game's rank 1-7 and the label "HR100 (HR4)" (1-29 HR1, 30-49 HR2, 50-98 HR3, 99-298 HR4, 299-997 HR5, 998 HR6, 999 HR7); hunter list and card, account, admin, Road picker, worlds and the search show it; sorting stays by the stored number; `dev/check-hr.js`
js/database.js        the Database page's search box and results (window.HvSearch from js/search.js)
js/search.js          the site search: the header's Search button, Ctrl/Cmd+K or / (monsters, quests, items, weapons from the site's indexes; guilds, hunters, armour and hunt counts from the API), and window.HvSearch for the Database page
js/weapons.js         weapons page: list, weapon detail with moves, calculator form and monster hitzone presets
js/weapons-calc.js    the damage formula (one melee hit as the client computes it, in single-precision floats); browser and Node
js/monster-links.js   a monster's field guide link from the server's id or name or the guide's name (data/monsters/index.json); used by the quest pages, leaderboards, hunters, account and worlds; also runs under node
js/worlds.js          world status polling
js/activity.js        live board on the Worlds page (/api/public/activity); its pure part also runs under node
dev/mock-feedback.py  local stand-in for POST /api/feedback (testing only)
dev/mock-activity.py  local stand-in for GET /api/public/activity (testing only)
dev/check-tournaments.js checks the Events cards (live rows, 404 fallback) and the Tournaments page in headless Chromium on a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-tournaments.js)
dev/check-events.js checks the Events cards open and close (tap, Enter, Space, Escape), have their sections and valid links, at 375 px and with the API missing (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-events.js)
dev/check-admin-events.js checks the admin Events tab (strip with the two lanes, gaps of both kinds and "Fill this gap", one loop form per lane, drag to move and resize with the mouse, the keyboard and a long press at 375 px, the before/after preview and Save, the "?" circles of every field, list, add, edit, delete, stop, extend the loop) and the Events page's "Next" and side event lines in headless Chromium on a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-events.js)
dev/check-admin-settings.js checks the admin Settings tab (live settings: sections and their game-server state, forms built from the API's spec with config defaults, review of the changes before save, history and revert, the Patch gate's count) in headless Chromium on a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-settings.js)
dev/check-admin-balance.js checks the admin Balance tab (rows with names and current values, add / edit / delete / reorder with the bodies sent, the move and weapon pickers, scale results, the diff, publish in two steps with the fingerprint, roll back, a moderator read only, a missing table, the weapon data missing, 375 px; the grid: a cell edit and the row sent, the reason asked once, Tab and Enter, a range error, reset and the game's value deleting the row, the multiplier line, existing draft rows in their cells, weapons with paging, search and changed only, mode switching, a phone at 375 px with a sticky first column; screenshots in /srv/devbot/.bot-logs/balance-grid/) in headless Chromium on a fake API; it serves data/weapons/ from the weapon-db worktree when this site has none (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-balance.js)
dev/check-admin-flags.js checks the admin Flags tab (badge from the summary, queue cards, filters, detail with history, approve / cheat / undo behind confirms with the bodies sent, a 409 canForce and "Undo anyway", bulk with per-id results, rules PUT and Scan now, a moderator read only, a missing table, 390 px; screenshots in /srv/devbot/.bot-logs/account-flags/) in headless Chromium on a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-flags.js)
dev/check-admin-users.js checks the admin Users tab (one Manage button per row, the Discord name with the id in the hover text, search with query and match=discord and the highlight, the drawer opening one at a time and closing with Esc or Close, role checkboxes with the current ones ticked, one PUT with the full set, the second click for removing a staff role, a 400 message, the fallback to POST /api/admin/roles on a 404, Unlink in two clicks, a moderator read only, no sideways overflow at 390 px; screenshots in /srv/devbot/.bot-logs/users-tab/) in headless Chromium on a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-users.js)
dev/check-admin-staff.js checks the admin page's staff permissions (tabs and Flags buttons per role: admin, moderator, helper, player; the Users Helper checkbox; an older API without /mine; the Permissions editor with its PUT and reset bodies, a refusal and tableReady false) and the flag Character panel (every block, null sections, markup as text, no IP, links, a note added) at 1280 and 390 px, screenshots to /srv/devbot/.bot-logs/staff-tools/ (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-staff.js)
dev/check-balance-public.js checks the Balance changes page (rows grouped with names, game → new values and factors, reason links, markup as text, history; the empty table; a 404 and no version: not published yet; no answer: Try again; 375 px and desktop; the link from weapons.html and the nav) in headless Chromium on stubbed API answers; screenshots public-*.png (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-balance-public.js)
dev/check-db-lists.js checks the Quests and Monsters lists keep their state in the address (reload, ?q= and ?monster= links, Clear filters, Previous/Next to the table top), the quest page's way back to the filtered list, no false "0 on the server" without the API, the monster page's tabs following the hash, and the phone layout (filters two to a row, 40 px monster icons) at 375 and 1280 px (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-db-lists.js)
dev/check-db-search.js checks the Database page and the header search (groups, links, a quest by id, weapons, ?q= and ?kind=, keys, a failed index, no big files, 44 px hits on touch, the Database crumb, the tile counts against the data, make-search-index.py --check) at 375, 768 and 1280 px; SHOTS=<folder> saves the page and the open menu (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-db-search.js)
dev/make-search-index.py writes data/search/quests.json and data/search/weapons.json, the site search's name indexes, from data/quests.json and data/weapons/<type>.json; run it after either changes (--check: run by dev/check-db-search.js)
dev/check-db-catalog.js checks the Items page (and that /catalog.html forwards to it) keeps its section, search and page in the address, has no header sort on its paged table and shows Try again when the item list fails, at 375 and 1280 px (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-db-catalog.js)
dev/check-admin-notices.js checks the admin Notices tab (login notices with the preview and save, Send now with the counter and two clicks, a failed target, schedule and cancel, a missing table, 375 px) in headless Chromium on a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-notices.js)
dev/check-admin-content.js checks the admin Content tab (lists, add with the item search, edit, delete, a locked table, event quests disable/enable, gacha rows and items) in headless Chromium on a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-content.js)
dev/check-activity.js checks js/activity.js on the made-up boards in dev/activity-fixtures.json
dev/check-road-rules.js  checks js/road-rules.js against the Go golden outputs (needs the base Road as JSON, see the file)
dev/check-road-monsters.js checks the any-of-176 monsters rule and where a new monster's fields come from, on a made-up Road
dev/check-road-policy.js checks the policy rules the Go outputs don't cover (points cap, solo Road, the entry level and the levels offered) on a made-up Road
dev/check-road-help.js checks the Road builder in headless Chromium on a fake API: a "?" circle with its text on every field and column (hover, tap, Escape, on screen at 1280 and 375 px) and the Level picker (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-road-help.js)
dev/check-road-test.js checks the Road builder's "Test in game" panel (js/road-test.js) in headless Chromium on a fake API: hidden while the live setting road_test is off; start (PUT /api/account/road-test with the name and edits), a refused Road with its problem, stop (DELETE) (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-road-test.js)
dev/check-road-summary.js  checks js/road-summary.js on a small made-up Road (node dev/check-road-summary.js)
dev/check-road-zenith.js  checks the Road builder's Zenith forms in headless Chromium against a fake API on a made-up Road (NODE_PATH=/root/work/pw-tools/node_modules)
dev/make-road-data.py writes the Road tables into road-data.html from decoded Road files (rengoku-build decode)
dev/check-road-data.py checks dev/make-road-data.py on two small made-up Roads (python3 dev/check-road-data.py)
dev/make-item-data.py writes data/items/ (the item index and one file per item with drops, quest rewards and quest needs); run it with --offline after dev/make-monster-data.py or a quests.json rebuild, then dev/make-share-pages.py
dev/make-use-data.py writes data/uses/ (one file per item with a use, index.json) and data/equipment/<slot>/ (names.json and the material lists by id // 1024) from hvmhfz_re data/item_uses.json (tools/items/item_uses.py build, from the decoded client files; no server data) and this site's quest-objectives.json, search/quests.json and items/index.json; run it after either changes. Check: python3 dev/check-uses.py ("uses OK": tests the script, every link of the files resolves) and NODE_PATH=/root/work/pw-tools/node_modules node dev/check-uses.js (the item, equipment, Weapons pages; SHOTS=<dir>)
dev/make-source-data.py writes data/sources/ (index.json and one file per source) and each item's "where", "gather", "offered" and "unlisted" in data/items/ from hvmhfz_re data/item_sources_detail.json (its docs/item-sources.md section 14; regenerate that from a read-only live snapshot first); make-item-data.py keeps those keys. Check: python3 dev/check-sources.py ("sources OK": tests the script, every source page and item link resolves, both ways) and NODE_PATH=/root/work/pw-tools/node_modules node dev/check-source-pages.js ("source pages OK")
dev/make-skill-data.py writes data/skills/ (index.json, one file per skill tree, pieces/<slot>/<id // 1024>.json and items/<id // 1024>.json for the Skills lines) from hvmhfz_re data/skills_db.json and data/skill_categories.tsv; run it after either changes, then dev/make-share-pages.py
dev/check-skills.py tests make-skill-data.py and checks data/skills/ against hvmhfz_re data/skills_db.json ("skills OK"); dev/check-skills.js checks the pages in headless Chromium at 1280 and 390 px (NODE_PATH=/root/work/pw-tools/node_modules [SHOTS=dir] node dev/check-skills.js)
dev/make-weapons-data.py writes data/weapons/*.json and dev/weapons-cases.json from a client patch zip (mhfdat.bin, mhfpac.bin) and the client's mhfsdt.bin with the hvmhfz_re tools (tools/weapons, build/unpack_cli); run it again when a patch changes dat/mhfdat.bin; it also writes data/weapons/ids.json (weapon id -> type, for the catalog's links; `--ids-only` rewrites just that from the type files)
dev/check-weapons.js checks js/weapons-calc.js against the moves.py reference cases (24), the weapon data, and with NODE_PATH as above the page in headless Chromium (SHOTS=<dir> also saves desktop and phone screenshots)
dev/check-road-rewards.js checks js/road-rewards.js on made-up reward rows, with and without boards
dev/site-shell.py     writes the skip link, nav, breadcrumbs and footer into every page from dev/shell/ (nav.html, footer.html, pages.json)
dev/check-site.py     checks that every page is in sync with dev/shell/, has the skip link and the shared scripts, then runs dev/check-nav.py
dev/check-nav.py      checks every page is in pages.json, at most 2 clicks from home, has breadcrumbs, search, one <h1> and a "Page · Hunsterverse" title, the sitemap (every indexable page, monsters by current slug), and runs check-links.py (--self-test: on a made-up site)
dev/check-site-shell.py checks dev/site-shell.py on a small made-up site
dev/check-changelog.py checks changelog.html: month > day > topic, a release time on every change, the contents; and that every bullet of the page before the regrouping (git 8e02a4c) is still there (--self-test: on made-up pages)
dev/check-guku-name.py  fails when any tracked text file or file name spells the house pet with the old slur, in any case (the pet is Gu-ku, identifiers guku; owner, 2026-11-12); images are not read
dev/check-links.py    checks every local link, picture and anchor, the query parameters detail links use (the target page must read them; monster and quest ids must exist), links built in js/*.js, files scripts name, and sitemap.xml (python3 dev/check-links.py)
dev/make-quest-monsters.py writes each quest's monsters in data/quests.json from its Japanese objective, in the field guide's names
data/quest-objectives.json  what the quest files say each quest's objectives are: main, sub-objective A and B (type, target, count) from the served files, and string 1-4 in Japanese from the original pack; written by dev/make-quest-objectives.py (reads `hunsterverse` over ssh, read only; see the file)
dev/fix-quest-objectives.py makes the quests' Japanese and English objective texts the quest files' (data/quests.json, data/quest-details.json) and writes subAJp/subAEn/subBJp/subBEn for the quest page's sub-objective rows (--check: change nothing)
dev/fix-quest-monster-names.py makes the monsters the English quest texts name (data/quests.json name, data/quest-details.json objectives, sub-objectives, descriptions and client lines) the ones their Japanese text names: katakana names and kanji epithets (氷狐竜 is Dyuragaua: "Duramboros" was a wrong monster in 154 texts) against the field guide's English names, each wrong name replaced when the Japanese text says which monster it is (--check: change nothing, exit 1 when a text names a wrong monster; --self-test; --files LIVE ORIG [--fixes F]: the same audit of the served quest files' 8 strings, for the hvmhfz_re fix bundle); run by check-catalog-monsters.js
dev/check-quest-objectives.py checks every quest's objectives (both files' Japanese text, the English count, the sub-objectives) against data/quest-objectives.json; also run by check-catalog-monsters.js
dev/make-quest-pieces.py writes data/quests/pieces/<id ÷ 1000>.json, the quest page's copy of data/quests.json and data/quest-details.json (only the fields it shows); run it after any change to either file (--check: change nothing)
dev/check-quest-page.js checks in headless Chromium that the quest page loads only its piece (not data/quests.json or quest-details.json), shows what the big files say, and its not-found, load error and Try again states (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-page.js)
dev/check-catalog-monsters.js checks that every quest catalog monster has a monster page, that make-quest-monsters.py and make-quest-pieces.py have run, and the monster index (node dev/check-catalog-monsters.js)
dev/check-builder-icons.js checks that every monster and item the builders offer has a picture file or the placeholder (node dev/check-builder-icons.js)
dev/make-builder-data.py writes data/map-areas.json (from the client's mhfo-hd.dll) and the names in data/item-ids.json (the English client's own, from its decompressed mhfdat.bin)
dev/make-equipment-icons.py writes data/equipment-icons.json (weapon class and rarity of every melee and ranged id, rarity of every armour id) from the FrontierDataTool dumps of the game's equipment tables (Z Zenith; on mhfz-dev in frontier_tools/ReFrontier-master/data_dumps); ids checked against the server's equipment_* tables (see the file)
dev/make-forced-equipment.py writes data/forced-equipment.json from the same dumps plus directories of decompressed quest files (for the decorations); see the file
data/wiki-names.json  names only: the Monster Hunter Fandom wiki's Frontier monsters, locations and weapon types (snapshot of 2026-11-03)
data/monster-icon-sources.json  the wiki file, URL and our SHA-1 of every wiki-style monster icon
dev/check-wiki-names.py checks our monster, place and weapon type names against data/wiki-names.json (every difference listed with the reason, usually the game's own word), that the builders and the Road pages name and draw each monster as its guide page does, and that no wiki icon changed (python3 dev/check-wiki-names.py; --self-test)
data/map-ids.json     every map id's own name (place plus day/night, version or district), group, quest count and confidence (docs/maps.md)
data/quest-fields.json  every quest-file field the quest builder and the API codec touch: offset, bytes, range, value names (docs/quest-fields.md)
data/quest-condition-notes.json  the quest restrictions the builder offers (our names, Pax's ids, the Hardcore notes); the same ids as the API's QuestCodec.CONDITION_NOTES
data/forced-equipment.json  the equipment a custom quest may force: per slot which ids are real pieces (and for blademasters, gunners or both), and the decorations Capcom's quests force; written by dev/make-forced-equipment.py, copied to the API
dev/check-quest-fields.js checks data/quest-fields.json against the API codec, js/quest-editor.js, the site's name tables and docs/quest-fields.md
dev/check-exact-links.js checks in headless Chromium, against a fake API with and without the ids API 5b6d085 added, that hunter and guild names link by id (else by name) and that a refused quest upload or Road draft save shows the API's message (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-exact-links.js)
dev/check-play.js     checks play.html and js/play.js in headless Chromium: three checklists, ticks kept across reloads, copy buttons, hidden slots, home page links, the client patch versions (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-play.js)
data/patch-versions.json  client patch versions, newest first: version, release time (UTC), sha256, size, files, what changed, known problem, changelog link, download, current
data/weapons/          index.json (source patch and sha256s, types, sharpness multipliers and colours, formula constants, skill names from the client's text, open points) and one file per weapon type (weapons as rows of `fields`, the sharpness bars they use, technique skills, moves, Charge Attack Up list, Fencing+2 records); written by dev/make-weapons-data.py
dev/check-patch-versions.py checks data/patch-versions.json: versions in order without gaps, one current (the newest), changelog ids that exist, each version's own download (python3 dev/check-patch-versions.py [--backups /root/backups/client-patch])
data/patch-files.json  sha256 of the key game files (mhf.exe, mhfo-hd.dll, mhfo.dll, dat/mhfdat.bin, dat/mhfpac.bin, dat/mhfinf.bin, hvmods.dll) inside each client patch zip, by version: the releases, then every pre-release build (1.22-pre2), each newest first; the API's Diagnostics upload compares a player's hvdiag.txt with the build they run (a build missing here answers "the file list of v1.22-pre2 is not published", and testers send most reports). Rewrite it after every release and after every pre-release publish: python3 dev/make-patch-files.py --backups /root/backups/client-patch (check only: --check; it fails while a version in patch-versions.json has no entry or the order is wrong). The ops scripts do it for you with the site folder: `release-patch.sh --site-dir DIR` (releases) and `publish-prerelease.sh --slot S --notes notes-1.22-pre2.txt --site-dir DIR --apply Frontier_Patch-v1.22-pre2.zip` (pre-releases, on mhfz-dev: it keeps the stamped zip in /root/backups/client-patch, publishes it to the slot through publish-patch.py on hunsterverse, then rewrites this file); then commit and push data/patch-files.json as for any site change
dev/check-live-reports.js  checks the account page's "Live reports from your game" (js/account-telemetry.js: list, Show detail, Load more, Delete with confirm, empty state, 401/404/500, 375 px) and /diagnostics-data.html (every data-field row, sections, examples, no sideways scroll at 375 px) in headless Chromium against a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-live-reports.js)
dev/check-diag.js     checks the account page's Diagnostics box (js/account-diag.js: help, the "What went wrong?" note (1,000 characters) and Area sent with every file, files uploaded as soon as they are picked or dropped (no Upload click) one after another, a status and answer per file, the Upload button only for queued files, the leave-page warning, bad type, 256 KB, 10-file cap, refusals, 375 px) and the admin page's Diagnostics tab (note and area in the list and view, area filter) and Users tab Logins button in the Manage drawer (js/admin-diag.js) in headless Chromium against a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-diag.js)
dev/check-link-command.js checks js/link-command.js: `/link code:<code>` from the token, never the old `!f link` text (node dev/check-link-command.js)
dev/check-signin-next.js checks js/signin-next.js: same-site paths only, hostile values refused (node dev/check-signin-next.js)
dev/check-signup.js   checks the sign-up: the rules in node, then in headless Chromium against a fake API the form switch, page-side mistakes, the API's refusals (409 wrong case, 400, 403, 429, 500, unreachable), success and ?next=, the Play page links, a 360px phone (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-signup.js)
dev/check-report-signin.js checks in headless Chromium, against a fake API, report.html: signed out or expired shows the Sign in button (back to the report page) and no forms, signed in sends the token, a 401 asks to sign in again and keeps what was typed (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-report-signin.js)
dev/check-backup-file.js checks js/backup-file.js on made-up zips and JSON, with Python's zipfile (node dev/check-backup-file.js)
dev/check-account-transfer.js checks the account page's Transfer tab (the transfer wizard) in headless Chromium against a fake API: coming soon on 404, the signed-out return, a new character from our zip, an older zip into an existing character with its warning, bare save and export files, a full account, a file without a save, part checks, 375 px (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-transfer.js)
dev/check-subtabs.js  checks the sub-tabs (js/subtabs.js) on the account page in headless Chromium against a fake API: roles, deep links and every old hash, nested anchors (opens folds, scrolls below the bar), Back/Forward, the remembered tab, keyboard, the sticky bar, lazy panels, the phone's Jump to select; SHOTS=<folder> saves screenshots of every tab (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-subtabs.js)
dev/check-account-qol.js checks the account page's Game options card in headless Chromium against a fake API: one switch per feature the API lists (off by default, description, needed patch, hidden-information note), PUT of only the toggled id, a refused save, the "Being tested: pre-release only" section (features with `preReleaseOnly`, greyed out with the API's `lockedMessage` while the account is on Stable, moving into the normal list when stable reaches them, reload on the `hvmhfz:patch-channel` event), the Controller buttons line (PlayStation / Xbox, `PUT /api/account/qol/controller`), 375px width (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-qol.js). dev/check-account-patch-channel.js checks the Client patch box, including its 20 second refresh, the switched-back notice and the hidden-tab pause (fake clock).

dev/check-quest-expiry.js checks custom quest expiry in headless Chromium against a fake API: the admin event quest slot count and a refused publish, the reminder at the top of the account page, expiry dates, Keep testing, Resubmit, draft Keep and Restore, an API without the fields, the admin Expired/Retired filters and Retire (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-expiry.js)
dev/check-account-details.js checks the account page's Details tab and the Characters tab's links in headless Chromium against a fake API: hunter card and Details links, nothing loaded before the tab opens, the four sections (names, unknown ids, levels, decorations, My Sets, box filter and search, stats), no save, an API without the endpoint, the admin box, 375 px (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-details.js)
dev/check-quest-expiry.js checks custom quest expiry in headless Chromium against a fake API: the admin event quest slot count and a refused publish, the reminder at the top of the account page, expiry dates, Keep testing, Resubmit, drafts without any expiry (no Keep, Restore or deleted section), an API without the fields, the admin Expired/Retired filters and Retire (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-expiry.js)
dev/check-account-details.js checks the account page's character view (Characters tab) and its icons in headless Chromium against a fake API: the icon lookups on the real data file, no Storage or Details tab (old links land on Characters), hunter card and View links, nothing loaded before the tab opens, the seven sections (names, unknown ids, class, rarity, levels, decorations, tinted icons, My Sets, the item box grid and list with search, pouch, warehouse, equipment box filter and search, stats), placeholders for missing pictures, gift icons, no save, an API without /details, the admin box, 375 px (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-details.js)
dev/check-account-backup.js checks the account page's Backups tab in headless Chromium against a fake API: coming soon on 404, download, preview, cancel, confirm, history, refusals (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-backup.js)
dev/check-signin-return.js checks in headless Chromium, against a fake API, that signed-out visits to the Road builder, Quest builder and account page land on the sign-in form with ?next= and a note, that a saved sign-in goes on to next (never off the site), and road-vote.html's public view (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-signin-return.js)
dev/check-times.js   checks times in the viewer's zone in headless Chromium with timezoneId Europe/Berlin and America/Los_Angeles (changelog, leaderboards, Sky Corridor, Events, Play, Balance): the converted time and zone, the UTC title, the JST/UTC resets in local time, the footer's UTC setting and that it is remembered (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-times.js)
dev/check-sky.js     checks sky-corridor.html and the hunter Sky Corridor tab in headless Chromium against a fake API (sample data, empty, 404, tracking off), with screenshots to dev-shots/ (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-sky.js)
dev/check-tower.js   checks the tower rank and points displays in headless Chromium against a fake API: the hunter profile's Tower Rank and Tower Points (shown when set, hidden when null), the Sky Corridor board on the leaderboards (rows, empty state, tracking off, error) and the "How tower points work" note (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-tower.js; SHOTS=folder saves screenshots)
dev/check-quest-maps.js checks the quest builder in headless Chromium against a fake API: only the server's maps can be chosen, a 400 shows next to its field, no unnamed areas (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-maps.js)
dev/check-quest-zenith.js checks the quest builder's Zenith forms (slot bytes, Zenith flag and rank) in headless Chromium against a fake API (NODE_PATH as above)
dev/check-quest-listing.js checks the quest builder's listing options (counter, mark, players, stars, time of day, season, targets required, the "?" buttons) and the admin's counter and mark change at publishing in headless Chromium against a fake API (NODE_PATH as above)
dev/check-quest-versions.js checks custom quest versions and Delete in headless Chromium against a fake API: "v2" beside each submission and draft, Delete (confirm first, DELETE for that id, the draft kept) on testing and pending quests only, none with an API without versions, the builder's "Updated to v3" and "Submitted as v1", the admin Deleted filter (NODE_PATH as above)
dev/check-quest-rules.js checks the quest builder's rules and restrictions (Hardcore and its class rule, the restriction list, death count across the G rank line, rank limits and their order, the flag checkboxes, a server refusal, an older draft, 375 px) in headless Chromium against a fake API (NODE_PATH as above)
dev/check-quest-equipment.js checks the quest builder's forced equipment (catalog search with game icons, placeholder rows left out, no blademaster/gunner mix, no piece, decorations, a weapon id past 16,383, a server refusal, the review, an older draft, 375 px) in headless Chromium against a fake API (NODE_PATH as above)
dev/check-quest-rewards.js checks the quest builder's reward and text extras (Reward 1/2/3 with game icons and the fill from the main target's rewards, fixed rewards, sub-target money, the target, clear and fail line fill and its Undo, the review, a server refusal, an older draft, the pages' reward wording, 375 px) in headless Chromium against a fake API (NODE_PATH as above)
dev/check-quest-monsters.js checks the quest builder's monster tuning (difficulty and its G rank rule, size, size spread, each large monster's usual or exact position, the server's position refusal, an older API without spots) in headless Chromium against a fake API (NODE_PATH as above)
dev/check-links.py    checks every local link, picture and #anchor on the site (python3 dev/check-links.py [pages])
dev/make-og.py        writes the 1200x630 preview cards in assets/og/ (one per page, assets/og/monster/<slug>.png, assets/og/weapon/<type>.png; python3 dev/make-og.py [page cards ...]); dev/set-og.py points each page's og:image at its card
dev/make-share-pages.py writes the share pages in s/ (see "Link previews"; --check: s/ up to date)
dev/make-monster-data.py writes data/monsters/game/ (one file per monster id, index.json) and data/quests/rewards/ (quests by id ÷ 1000) from hvmhfz_re tools/monsters outputs (--src, default /root/work/monster-data; item names from hvmhfz_re data/item_sources.tsv); then run make-og.py and make-share-pages.py (monster cards and previews use it). Check: node dev/check-monster-pages.js
dev/check-embeds.py   checks every page's and share page's preview tags and pictures (--serve: also fetches a sample as Discordbot from a local server and prints each preview)
dev/check-share.js    checks the share pages' redirects and the Copy link button in headless Chromium (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-share.js)
js/share.js           "Copy link" in the breadcrumbs of the monster, quest, item, weapon, changelog, hunter, guild and leaderboard pages: copies the share page's address (the API's share link for hunters, guilds and boards)
s/                    share pages (generated, noindex): s/monster/, s/quest/, s/item/, s/weapon/, s/changelog/
dev/make-hv-summary.py writes the comparison tables of guide-frontier-hunsterverse.html from the guide's notes (--check: one note per section, page up to date)
CNAME                 frontier.hunsterverse.net
```

Static site, no build step. Push to `main` and GitHub Pages serves it.

## Sub-tabs

`js/subtabs.js` (with the "Sub-tabs" rules in `css/styles.css`) turns a page's tab bar into sub-tabs; the account page
uses it, and `docs/subtabs-audit.md` lists the pages that could use it next. Markup: a `div.subtabs-bar` around a
`nav.tabs[role=tablist][data-subtabs="<page>"]` of `a.tab[role=tab][href="#name"][aria-controls="panel-name"]`, and one
`section.tab-panel[role=tabpanel]` per tab. Optional `data-subtabs-aliases='{"old": "name-or-element-id"}'`.

- One panel shows at a time; the address follows the tab (`#name`, a history entry per click, so Back and Forward work).
- A hash opens its tab: the tab's name, an alias, or any element inside a panel (it opens closed `<details>` around it
  and scrolls to it below the bar, waiting up to 5 seconds for a script to show it). Other hashes (`#content`) are left alone.
- No hash: the tab last used on the page (`localStorage` `hv.subtabs.<page>`), else the first.
- Keyboard: arrows, Home, End (roving tabindex). The bar sticks under the site bar; it wraps on wide screens, and
  with more than 5 tabs phones (720px and below) get a "Jump to" select instead.
- Lazy panels: `HvSubtabs.whenOpen(elementOrName, fn)` runs `fn` once, when that panel first shows (at once on a page
  without sub-tabs). The account page loads Game options and Client patch this way. Every change fires `hv:subtab` on
  `document`.
- Folds for rarely used groups: `details.fold > summary > h3 + span.fold-hint`.

## Game icons

Every item and equipment icon on the site (account page, catalog, item pages, Festa prizes, the builders'
pickers, the weapon type lists on Hunters, Worlds and Leaderboards, the weapons guide) is the game's own,
drawn the way the client draws it. In the game an icon is a grey 64x64 sprite multiplied by a colour; the
files here have the colour already in.

Where they come from (all in the client; game data may be public in this repo, owner's rule 2026-11-02):

- the sprites: `dat/mhf_90c.bin` entry 17 (the sprite lists) and entry 54 (texture 0xb13, the grey icon
  sheet): item shapes, the five armour slots, the 14 weapon classes and the small G, T, Z and paw badges;
- item shape, colour and badges: the item table of `dat/mhfdat.bin` (our client patch's copy);
- the colours: two tables in `mhfo-hd.dll`, one for items (22 colours) and one for equipment (10 colours,
  which RARE 1-3 share the first of), and the client's rules for which colour a weapon takes (its rarity, a
  series colour, or one by its level).

They are made by `tools/icons/game_icons.py` in the private `hvmhfz_re` repo (its `docs/game-icons.md`
has the details and the client addresses), which writes `assets/icons/`, `data/item-icons.json` (item id
to key) and the weapon rules in `data/equipment-icons.json` (`meleeTint`, `rangedTint`). Run it again when
a client patch adds items:

    python3 tools/icons/game_icons.py build <client game folder> <this repo> --patch <unzipped patch folder>

Files: one PNG per icon and colour (not a sprite sheet, so a page loads only what it shows), named by key:
`item-<sprite>-<colour>[-<badges>]` for items (510 icons) and `<slot or class>-<colour>` for equipment
(20 types x 10 colours; `<class>-0` is the plain weapon type icon), 2x the game's 64 px, 1x scaled to
32 px; palette PNGs where that loses nothing. About 1.7 MB for all 1,420 files.

## Site shell

The skip link, header nav, breadcrumbs and footer come from one source in `dev/shell/`; `dev/site-shell.py`
writes them into every page, between `<!-- site-shell:header ... -->` / `<!-- /site-shell:header -->`,
`<!-- site-shell:crumbs ... -->` / `<!-- /site-shell:crumbs -->` and
`<!-- site-shell:footer ... -->` / `<!-- /site-shell:footer -->`. Don't edit a page between those markers:
the next run overwrites it, and `dev/check-site.py` fails while a page differs from the source.

- `dev/shell/nav.html`: the skip link and header nav, with nothing marked current.
- `dev/shell/footer.html`: the footer.
- `dev/shell/pages.json`: one line per page: `page` (file), `group` (the menu it sits under, or `null`),
  `label` (its short name), `title` (its `<title>`, unescaped; must match the page; always "Page · Hunsterverse", guide sections
  "Section · Frontier guide · Hunsterverse", and the same for titles scripts set) and `current` (the nav
  link it marks, or `null`). The script marks that link `aria-current="page"` and its menu button
  `is-current`, and checks that `group` is that menu. Optional: `trail` (`[label, href]` crumbs between the
  group and the page, e.g. a guide section's chapter), `item: true` (a detail page: its script puts the item's
  name last) and `crumbs: false` (no breadcrumbs: the home page).
- Breadcrumbs, every page but home: `Home › group › trail › label` in
  `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>`; the group is plain text (a menu, not a page), except a group with a page of its own (the pages.json entry whose `label` is the group's name: `database.html` for Database), whose crumb links there; that page's own crumbs are Home › Database. They
  sit first in the page's `main`, or where the page already had its breadcrumbs (the Frontier guide pages, beside
  their side column), and replace the old "Hunsterverse · X" kicker line. Detail pages call
  `HvCrumbs.item(name)` (`js/nav.js`): the monster and quest pages replace their stand-in crumb, the hunter
  and guild profiles turn "Hunters"/"Guilds" into a link and add the name.

The script also adds `<script src="/js/search.js" defer></script>` before `</body>` on a page that doesn't
load it. It keeps everything else on the page (head, main, scripts).

- Nav, same on every page: six menus and the account button. Labels use the game's and the Discord bot's
  own words (Worlds as the bot's `/worlds`, Hunting Road and Road).
  - **Guides:** Play, Frontier guide.
  - **Database:** Search everything (`/database.html`), Monsters, Quests, Items, Sources, Weapons, Balance changes.
  - **Tools:** Set builder, Quest builder, Damage calculator (`/weapons.html#calc`: the calculator stays on the Weapons page; `js/weapons.js` lands on it once the list has filled in).
  - **Hunting Road:** Rotation and vote, Road builder, Past winners, Road data, Roads in game (`guide-roads.html`), Sky Corridor.
  - **Community:** Hunters, Guilds, Leaderboards, Discord.
  - **Server:** Worlds, Events, Changelog, Report a problem.
  - Then the account button (`a.nav-account`): "Sign in" to `/account.html` in the HTML; `js/nav.js` makes it
    "My account" with a saved sign-in that has not expired, and points it at the home page's sign-in form
    (`/#login-form`) without one. `js/search.js` adds the Search button in front. The API page is in the footer.
- Footer, four columns: Guides, Explore (Database, Monsters, Quests, Items, Leaderboards, Hunting Road), Server
  (Changelog, Worlds, Report a problem, API) and About (Privacy, Discord, hunstermonter.net).

  Each menu is a `div.nav-group` with a `button.nav-group-toggle` and a `div.nav-menu` of links. The page's
  own link has `aria-current="page"`, and its group button the class `is-current`; the home page, 404,
  privacy, admin and API mark nothing, and a monster's page marks Monsters. On a wide screen a menu opens on hover, or on click and
  keyboard (`js/nav.js`). Below 1160px the bar folds behind the Menu button and lists every group open.
  Both guides also switch between Windows and Linux at the top.
- Width: data pages (database, monsters, monster, items, weapons, hunters, guilds, events, worlds, account, set builder) add
  `wide` to their `main` and use the screen up to `--wrap-wide` (1760px); reading pages (guides, changelog, report)
  keep `--wrap` (1120px). Up to 1160px the nav folds behind the Menu button; from 1161 to 1400px the full bar uses tighter letters and padding (and up to 1280px a smaller logo) to stay on one line.
- Each page also has the skip link (`<a class="skip-link" href="#content">`), a `main` with `id="content"`,
  the footer `footer.site-foot` (with the Privacy link), `/css/styles.css`, `/js/nav.js`, `/js/background.js`, `/js/consent.js` and `/js/search.js`.
- The bar is sticky. Below 980px wide `js/nav.js` folds the links behind a Menu button; without JavaScript
  they wrap into a grid under the logo.

To change the menu or footer: edit `dev/shell/nav.html` or `dev/shell/footer.html`, then run the script.
To add a page: write it with any skip link + `<header class="site-nav">` and `<footer class="site-foot">`
(the script puts the markers around them), add its line to `dev/shell/pages.json`, then run:

```
python3 dev/site-shell.py      # rewrites the pages that are out of date; "site shell in sync"
python3 dev/check-site.py      # "site shell OK", exit code 0
python3 dev/check-site-shell.py  # tests the script itself on a made-up site
```

A branch that conflicts in a page's header, breadcrumbs or footer: take either side, then run `python3 dev/site-shell.py`.

It also reports local links and images that point at missing files.

## Frontier guide

The guide pages are plain HTML like every other page; edit them directly. Each section page repeats two
lists in its side column: "On this page" (one entry per `<section id>` with an `<h2>`) and "All sections"
(every guide page, the same on all of them). Adding or renaming a section means updating those lists,
the previous/next links of its neighbours and the landing page's cards. Pictures go in
`assets/guide/<section>/` as WebP (about 960px wide at most), with `width`, `height`, `alt` and
`loading="lazy"`. Their breadcrumbs come from `dev/shell/pages.json` (`trail`: the chapter), like every
page's (see "Site shell").

Every `<section id="X">` ends with exactly one "On Hunsterverse" note comparing it with our server:

```
<aside class="box hv-note hv-same" id="hv-X"><p><strong class="hv-verdict">Works the same.</strong> ...</p></aside>
```

The verdict is one of `hv-same` "Works the same", `hv-diff` "Different", `hv-missing` "Not available here
yet" and `hv-unknown` "Unknown, not checked"; say how it differs and link our own page. Only write what has
been checked (server settings, code, database, our pages); otherwise use "Unknown, not checked". Never
send readers to the original guide's site, spreadsheet or Discord. After editing notes, rebuild the
comparison page, then run the checks:

```
python3 dev/make-hv-summary.py          # rewrites the tables of guide-frontier-hunsterverse.html
python3 dev/make-hv-summary.py --check  # "0 problem(s)": one note per section, page up to date
python3 dev/check-site.py               # "site shell OK"
python3 dev/check-links.py              # "no broken links"; also checks the #anchors of the contents lists
```

## Changelog

`changelog.html` is the players' record of every live update, by month, day and topic, newest first. Whenever an
update goes live (a new game server build, a database fix players notice, a new Discord bot build), add it in the
same change:

1. Find the day under "Released updates" (`<section class="cl-day" id="d-YYYY-MM-DD">` inside its month,
   `<section class="cl-month" id="m-YYYY-MM">`), or add it at the top: heading `<h4 class="cl-day-title">`
   "Weekday D Month YYYY", and a link to it in the contents (`nav.cl-toc`).
   Every day is a drop-down: `<details class="cl-fold cl-fold-day">`, a `<summary>` with the date, then the
   `section.cl-day` (its `h4` is `visually-hidden`, the summary shows the date), and every month is one around its
   `section.cl-month` (`cl-fold cl-fold-month`, summary "Month YYYY"). Only the newest 3 days carry `open` (and the
   month that holds them): when you add a day, take `open` off the day that is now 4th. A new month gets its own
   month drop-down. `js/changelog-folds.js` opens the folds around a link target (`#d-...`, `#m-...`), and the bot
   feed and `update-news.py` read `section.cl-topic` wherever it sits, so keep the topics inside `section.cl-day`.
2. Put each change under its topic for that day (`<section class="cl-topic" id="d-YYYY-MM-DD-<topic>">`, an
   `<h5>`; e.g. Sky Corridor, Gacha, Hunting Road, Client patch, Game server, Launcher, Website, Discord bot),
   newest release first; a new topic also goes in the day's topic line (`p.cl-topics`). Every change of that day
   about the same topic goes under one topic, whichever update brought it.
3. Start every change (`<li>`) with when it went live, in UTC: `<time class="cl-when"
   datetime="2026-11-03T03:41Z">3 Nov 2026, 03:41 UTC</time>`, from the release record (the server docs, the
   release runbook, the patch release, the site's GitHub Pages deployment). When the time is not recorded, give
   the date only: `<time class="cl-when cl-date" datetime="2026-11-03">3 Nov 2026</time>`. Don't guess times.
   Staff-only changes (the admin panel, moderation and review tools) get `<li class="cl-staff">`: they stay on
   the page with a Staff tag, but the Discord bot's #changelog feed skips them. A whole topic can be marked
   `<section class="cl-topic cl-staff">`, and a topic titled "Admin..." (an "Admin panel" topic) is skipped too.
   A player-facing change that merely mentions admins (custom quests reviewed in the admin panel) is not staff-only.
4. Move the entries that went live out of "Coming next". For a game server build, the source is that
   build's player notes ("Next build" in Erupe's `docs/hvmhfz-changelog.md`).
5. Update "Last update listed" in the page's meta line, and "Known issues" if one was fixed or found.
6. Run `python3 dev/make-share-pages.py` (the day's share page, see "Link previews").
7. Run `python3 dev/check-changelog.py` ("changelog OK") and `python3 dev/check-site.py`. `python3 dev/check-changelog.py`
   also checks the drop-downs (newest 3 days open, the rest closed); `NODE_PATH=/root/work/pw-tools/node_modules node
   dev/check-changelog-folds.js` ("changelog folds OK", headless Chromium) checks that links open them.

The home page's "What's new" (`js/whatsnew.js`) shows the first changes of the newest day.

Write for players: what they see in game, no packet names or commit ids. Leave out how to abuse a hole
that is not fixed on live yet.

## API

All read through `https://api.hvmhfz.eclipseforge.xyz`.

- Public: `/api/public/summary`, `/guilds`, `/guilds/{id}`, `/hunters`, `/hunters/{id}`, `/catalog/items`, `/catalog/equipment`, `/worlds`, `/monsters`, `/activity`.
- Account (JWT): `/api/account`, `/characters`, `/guilds`, `/discord`, `/characters/{id}/storage`, `/characters/{id}/hunts`, `/characters/{id}/details` (the Details tab; admins may open any character); for the Backups tab (`docs/character-backup-web.md`) `/characters/{id}/backup`, `/characters/import/preview`, `/characters/import`, `/characters/imports`; for the Transfer tab `POST /characters/import-new/preview` and `POST /characters/import-new` (a new character from the file).

- Sign-up (public, Turnstile): `POST /api/auth/signup` `{username, password, token}`; 200 is the sign-in answer (`accessToken`), a refusal is `{message}` (400 rules, 403 captcha, 409 name taken, also when only the capital letters differ, 429, 503). Used by `js/signup.js`.
- Feedback (JWT; signed-out requests get 401 once API task `api-feedback-signin` is live): `POST /api/feedback`, used by `report.html`.

Character storage and hunt endpoints are scoped to the signed in user; another account's character returns 404. Save data is decoded in memory and never stored or exposed raw.

### Feedback endpoint

`report.html` sends one JSON object per report:

| Field | Bug | Feature | Limit |
|---|---|---|---|
| `type` | `"bug"` | `"feature"` | |
| `title` | required | required | 120 |
| `description` | required (what happened) | required (the idea) | 4000 |
| `platform` | required, `"windows"` or `"linux"` | | |
| `steps` | optional | | 4000 |
| `expected` | optional | | 2000 |
| `reason` | | optional (why it helps) | 2000 |
| `contact` | not used any more (ignored by the API) | | |
| `website` | honeypot, empty for people | same | |
| `turnstileToken` | Turnstile response | same | |

Optional fields are sent as empty strings.

**Who sent it:** the page only shows the forms to a signed-in player (the home page's token in
`localStorage`, `hvmhfz.token`; the API answers 401 to signed-out requests, a 401 on send makes the
page ask to sign in again, keeping the text in `sessionStorage` until the report is sent). It sends it as `Authorization: Bearer ...` and the API signs the task
with that account and its linked Discord ("Reported by"). Nothing the form says about the sender
is used, so nobody can sign a report as someone else. The form shows who it will be signed as,
from `/api/account`. Needs API `api-feedback-signed`
or later (the CORS rule for `/api/feedback` allows the `Authorization` header).

Attachments (optional, both forms): up to 3 files of 2 MB each, PNG, JPEG or GIF images or `.txt`
and `.log` files. The page checks count, size and file name before sending. With files, the request
is `multipart/form-data` instead of JSON: the same JSON object in a `report` part
(`Content-Type: application/json`) and one `files` part per file. The API checks the content again,
re-encodes images (drops metadata such as phone GPS) and attaches them to the Kanboard task under
its own names (`screenshot-1.png`, `log-2.txt`). PDFs, archives and programs are refused.

The page expects `201 {"taskId": n, "attachmentsFailed": 0}` (or `200` with no body when the
honeypot was filled), `400` bad input or attachment, `403` Turnstile failed, `413` attachments too
large, `429` rate limited. When `attachmentsFailed` is above 0 the task exists but some files are
missing from it, and the page asks for them on Discord. Any other answer, a network error or no
answer within 15 seconds (60 with attachments) shows the Discord fallback: the report as plain text
to copy into #mhfrontier.

### Testing the Hunting Road rules

`js/road-rules.js` must give the same problems as the Go tool (`rengoku-build check -json`). Decode the live
base to a file outside the repo, then run the fixtures of the Erupe repo against it (policy off, `too-big` skipped):

```
rengoku-build decode -in <bin>/rengoku_data.bin > /path/outside/repo/base.json
node dev/check-road-rules.js /path/outside/repo/base.json <Erupe>/cmd/rengoku-build/testdata/roads
```

The policy rules the Go fixtures don't cover (the points cap `maxPoints`, the solo Road, the entry level) are
checked on a made-up Road, no game data needed: `node dev/check-road-policy.js`.

The entry level (+0x10) is the monster's strength level: the client uses it as the row of the monster's stat
table in its `mhfemd.bin` (health, attack and toughness multipliers; 84 rows per monster). Players may pick any
level 0 to 83 (owner, 2026-11-05): `copied-fields` refuses only a level past 83 (as Erupe's rengoku-build and the
API), and the builder lists the levels the live Road uses with the monster first and warns that the others may
play at base strength (`levelChoices` in `js/road-rules.js`); the policy's default `entryFields` includes
`zenith` and `level` (as the API's).

`maxPoints` is a site rule for now: the API (`PolicyRules.java`) does not send or check it yet, so keep
`points` and `points2` out of the API's `road.edit.floor-fields` until it does.

### Live board

`js/activity.js` reads `GET /api/public/activity` (API `hvmhfz_rest_api`, README "Live activity") every
30 seconds while the tab is visible: totals, then one row per character (name, world, in town or on a
quest, quest id). Quest names live in the client, so the id is shown; "Departing" is a quest whose id
the server doesn't know yet. When the API sends counts only (`hvmhfz.activity.public-names=false`) the
list says names are hidden; any error shows "unavailable" and the next refresh tries again. A player's
`discordName` comes from the API (server nickname, else Discord display name; the bot supplies it)
and may be null (account not linked, or not in our Discord) or missing (an older API); when set it is
a second, muted line under the character, set as text only. Each world may also send `parties`
(`[{questId, members: [names]}]`, hunters questing together, groups of 2 or more): the board then lists
them under the table, one "Parties" part per world (the quest as "Quest #id", "Quest loading…" while the
id is null), and tags those hunters "In party" in the list. Missing or empty `parties` (an older API)
shows nothing, and so does a world with no players listed (counts only). Quest history (`/api/sessions/questtime`,
`/questhistory`) is staff only, so it is not on
this page; a public history would be a new panel fed by a new public endpoint.
Until Erupe `ActivityTracking.Enabled` is on, everyone shows as "In town" with no quest.

```
node dev/check-activity.js                 # the pure part, on dev/activity-fixtures.json
python3 dev/mock-activity.py busy 8099     # or empty, hidden, 401, 500
python3 -m http.server 8000
```

Open `http://localhost:8000/worlds.html?api=http://localhost:8099` (the override works only on
`localhost` and `127.0.0.1`).

### Testing the report page locally

```
python3 dev/mock-feedback.py 201 8099     # or 400, 401, 403, 413, 429, 502
python3 -m http.server 8000
```

Put a sign-in token in the browser first (sign in on the home page, or `localStorage.setItem("hvmhfz.token", ...)` with any JWT-shaped value whose `exp` is in the future), else the page shows only the Sign in button. Open `http://localhost:8000/report.html?api=http://localhost:8099`. The `?api=` override and
Cloudflare's always-pass test Turnstile key are only used on `localhost` and `127.0.0.1`; the live
site always uses the real API and key.

## Link previews

Discord, X and other apps build a link's preview from the page's static `og:`/`twitter:` tags; they do not run
scripts. Every page has its own title, description and 1200x630 card (`assets/og/`, `dev/make-og.py` and
`dev/set-og.py`; the sign-in, admin, error and legal pages keep the brand card). A detail link with a query
(`/monster.html?m=...`, `/quest.html?id=...`) or an anchor (`/changelog.html#d-...`) still shows its page's
generic card, because the crawler fetches the same file. So each thing of the site's own data has a share page:

| Share page | Preview | Opens |
|---|---|---|
| `/s/monster/<slug>.html` | name, kind, weak elements, HP range, forms; its own card (icon, `assets/og/monster/`) | `/monster.html?m=<slug>` |
| `/s/quest/<id>.html` | name, category, monsters, objective, time, reward; its first monster's card | `/quest.html?id=<id>` |
| `/s/item/<id>.html` (items with sources) | name, best drop and how many monsters, how many quests reward it, quests that need it | `/item.html?id=<id>` |
| `/s/weapon/<type>.html[?w=<id>]` | the weapon type, its count and what the database shows; the type's card | `/weapons.html?type=<type>[&w=<id>]` |
| `/s/changelog/<date>.html[#d-<date>-<topic>]` | the day, its topics and headlines | `/changelog.html#d-<date>[-<topic>]` |

About 11,750 files (mostly the 9,152 quests and 2,403 items), about 1.5 KB each. A share page sends a browser on with
`location.replace` (a meta refresh without JavaScript, a link last). One page per weapon would be 16,000 more files,
so a weapon link previews as its type and still opens the weapon. The "Copy link" button (`js/share.js`) copies
these addresses; with no share page it copies the page's own address. Run `python3 dev/make-share-pages.py` after
the data (`data/monsters`, `data/quests.json`, `data/items`, `data/weapons`) or the changelog change, and
`python3 dev/make-og.py` after the monster or weapon data change; `python3 dev/check-embeds.py` says when s/ is
out of date. Hunters, guilds and leaderboards come from the API, so their share links are served by the API
(its README, "Share links"): a small page with the preview tags and a card drawn for that hunter, guild or board,
which then opens the page here. The Copy link button copies them, and so does the hunter profile's Copy profile
link:

| Page | Copy link copies |
|---|---|
| `/hunters.html?id=<id>` | `https://api.hvmhfz.eclipseforge.xyz/share/hunter/<id>` |
| `/guilds.html?id=<id>` | `https://api.hvmhfz.eclipseforge.xyz/share/guild/<id>` |
| `/leaderboards.html#<board>-<period>` (no hash: `hunters-week`) | `.../share/leaderboard/<board>/<period>` (hunters, guilds, monsters) |
| `/leaderboards.html#rp` (and the old `#guilds`) | `.../share/leaderboard/rp` |
| `/leaderboards.html#road`, `#road-solo` | `.../share/leaderboard/road/open`, `.../road/solo` (the live rotation only) |

A past Road rotation and the hunter and guild lists copy the page's own address.

## Links

- Community site (footer link only, not for registration: its sign-up is for another game server): https://hunstermonter.net
- Launcher: https://github.com/LilButter/Mezeporta
- Client patch: https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases

The site is not affiliated with Capcom.
