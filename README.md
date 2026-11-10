# hvmhfz.eclipseforge.xyz

Hunsterverse account portal, community pages and setup guides for Monster Hunter Frontier Z.

## Pages

| Path | What it does |
|---|---|
| `/` | Home: a hero with two buttons ("New here? Start playing" to `/play.html`, "Already playing? Sign in" to the form), the sign-in form beside it (after the tiles on screens below 1160px; its "Create an account" link, or `/#signup`, swaps it for the sign-up form, `js/signup.js`: `POST /api/auth/signup` with Turnstile, rules as the API's, the API's refusal shown as it is, then signed in like the sign-in), one row of tiles per audience (New here, Play, Community, Tools, Account; each tile a guide card picture or monster icon that is already on the site) and "What's new". After a successful login it hands over to `?next=` when that is a path on this site (`js/signin-next.js`: starts with `/`, no `//`, no backslash, scheme, space or control character, not the home page itself; the form then says why, e.g. "Sign in to use the Quest builder"), else to `/account.html`. |
| `/account.html` | Signed in view: overview (with the Hunting Road rewards and a character picker to claim them), characters, hunt log, guild, custom quests, backups and account. Characters: the list (each name links to its public hunter card, `/hunters.html?id=`, and "View" opens it below) and the character view (`js/account-details.js`), one character at a time in seven sections: Overview (ranks, playtime, money, stamps, guild, lifetime hunts, the account's gacha coins, house, a link to the hunter card), Equipment (the six worn slots with names, or the kind and id when the name is unknown, weapon class, rarity, armour levels, decorations and sigils), Loadouts (the in-game equipment My Sets: pieces, decorations, cuffs; a piece no longer in the box says so), Item box (the 6,000 slots as in game, pages of 100 with a preview, or as a list; search jumps to the page; a phone opens the list), Pouch, Warehouse (icon, name, count, search) and Equipment box (a table with class, rarity, level and decorations, slot chips and search); counts on the section chips. Every item, weapon and armour piece shows the game's own icon in the game's colour (`js/game-icons.js`, see "Game icons" below; the placeholder `assets/builder/no-icon.svg` for anything unknown). It reads `GET /api/account/characters/{id}/details` (API README "Character details") and `/storage` (own characters only), both when the tab is first shown; while the API answers 404 on details the equipment parts say "coming soon" and the boxes still show; an admin gets a box to open any character id (no item lists for another account's character). Old `#storage` and `#details` links land on the Characters tab (the item box or the overview). Custom quests (`js/quest-submissions.js`; up to five waiting or in testing at a time, approved quests never count): the submissions with each testing quest's expiry date (14 days without activity) and Keep testing, Resubmit for an expired quest while its file is kept (30 days), the quest drafts with their deletion date (90 days untouched) and Keep, and the deleted drafts with Restore (30 days); a reminder 3 days before either shows at the top of the page whatever tab is open (API README "Custom quest expiry"). Backups: download a character's backup zip, import a file into a character (preview, then confirm) and the account's imports; "coming soon" until the API has the account endpoints (`docs/character-backup-web.md`). Transfer (`#transfer`, `js/account-transfer.js`): the transfer wizard in six steps (account, file, what is in it, where it goes, confirm, "Now install and play"): it reads our backup zip, another server's zip, a newer Erupe export JSON or a bare save file, previews it with `POST /api/account/characters/import-new/preview`, and makes it a new character (`import-new`) or imports it into a character already on the account (the Backups tab's preview and older-file warning); a signed-out visitor goes to `/?next=/account.html#transfer`, where they sign in or create an account and come back; "coming soon" until the API has `import-new`. Without a valid session it sends the visitor to `/?next=/account.html...#login-form`, and back after sign-in; signing out goes to `/`. |
| `/monsters.html` | Monster field guide: search by name or species, cards link to full hitzone, HP and drop pages. `?q=` opens it searching. Hunt counts match the server's by monster id (`ids` in `data/monsters/index.json`). |
| `/monster.html?m=slug` | One monster: hitzones normal and enraged, HP by level, stagger limits, maps, every carve table, Henshu/GR/Zenith forms, and a link to its quests. `slug` is `data/monsters/<slug>.json`; older links with the entry's `oldSlug` or `formerSlugs` still open it. An entry made from our own data instead of the field guide's tables (Shagaru Magala, id 164, Mi Ru, id 113, Unknown, id 100, and the five Musou versions without ids of their own, `musou-pariapuria`, `-zinogre`, `-guanzorumu`, `-mi-ru`, `-elzelion`: name, quests, a short `about` note, optional `questsHref`/`questsLabel` for the quest link; `"ferias": false` drops the Ferias credit) shows empty tables. |
| `/events.html` | What is running: one card per event (Diva Defense, MezFes, event campaigns, Speedrun Cup, VS Bracket, Hunter Festival, then Raviente, Caravan rankings, Sky Corridor, the Hunting Road vote and event quests, which are always shown) that opens on a tap (a button with `aria-expanded`; Enter, Space and Escape work) to say what the event is, how to take part, what you get, when, tips and links (the text of every card is one entry per event key in `js/event-info.js`: edit it there), and with its state, from `/api/public/events/current` (the schedules Erupe writes: phase in words, when it ends and the content; an event with no row is off and its card is left out; a stale row says so) or, while that endpoint is missing or empty, from the static schedule kept in `js/events.js` (update it when a schedule changes; the Hunter Festival card reads `/api/public/festa`, the API's old 2023 `diva` event row is not shown), the event quest pool and the Festa prize table (`/api/public/events`; when that does not answer the cards still show). |
| `/tournaments.html` | Tournaments (`js/tournaments.js`): the Speedrun Cup standings from `/api/public/tournament/standings` (this week's quest, phase and closing time, last week's results, a table per weapon class picked with chips, plus the Guild board; "No clears yet" for an empty board) and the VS Bracket from `/api/public/vs-bracket/current` (phase, entrants, sign-up end, the rounds as columns, stacked on phones, with names, Bye, Hidden hunter, cleared ticks, times once decided, the winner and the champion). An endpoint that 404s, fails or answers null shows a "not running yet" note for its section. Linked from the Events page and the Server menu. |
| `/guilds.html` | Guild directory: search, sort by RP, members, newest or name. `?id=` opens a guild with roster and board; `?name=` opens the one guild of that exact name (else the list, searching). |
| `/hunters.html` | Hunter rankings: search, sort by HR, GR, recent or name. `?id=` opens a hunter profile; `?name=` opens the one hunter of that exact name (else the list, searching), for pages the API gives no character id; `?q=` opens the list searching for a name. |
| `/leaderboards.html` | Timed hunt boards: top hunters, top guilds (hunts by current members) and most hunted monsters for this week, last week, this month, last month and all time (UTC; weeks start Monday), from `/api/public/leaderboards/hunts`; plus guild RP. `#<board>-<period>` picks one (`#hunters-week`, `#guilds-month`, `#monsters-all`, `#rp`); the old `#hr`, `#gr` and `#guilds` links still land on a board. Tied scores share a rank. |
| `/catalog.html` | Item and equipment catalog with section chips and search. `?q=` opens it searching (monster drop tables link here). |
| `/quests.html` | Quest catalog from `data/quests.json`: every quest file, search and filters, monster icons linking to their pages. `?q=` opens it searching, `?monster=<guide name>` filtered to one monster. |
| `/quest.html?id=N` | One quest: category, area, objective, time, rewards money, monsters (each to its page), description, tracked runs. |
| `/worlds.html` | Live world status, the live board (who is online, in town or on a quest and which quest, and who is questing together, from `/api/public/activity`; each name links to its hunter profile by `charId`, or to the Hunters page searching for it when the answer has no `charId`) and server wide hunt totals, refreshed every 30 seconds. |
| `/play.html` | Play: three cards, each a numbered checklist with one download per step: New on Windows, Linux / Steam Deck (marked not tested yet) and Bringing a character from another server (a "where to get your file" table per source type, then the account page's Backups tab or Discord `/link` and `/import`). The Windows and Linux account steps ("Make your account, then log in") link to the sign-up form (`/#signup`) and keep REGISTER in the launcher as the other way. Ticks are kept in this browser (`localStorage` `hvmhfz.play`, `js/play.js`, listed in `privacy.html`); Copy buttons for the server settings (name, host, launcher and game port, from `docs/launcher.md`) and the Discord commands. Marked slots for the one-click installer and our own full download stay hidden until `SLOTS` in `js/play.js` has the flag on and a URL. Every route for a new player ends here: the home page (main button, sign-in box, "Start playing", "New on Windows", "Linux / Steam Deck" and "Bringing a character" tiles, to the card anchors `#windows`, `#linux`, `#transfer`), the Frontier guide, the 404 page, the Guides menu and the footer. Each card ends with collapsible "More help" sections (`<details>`, ids `windows-patch`, `windows-trouble`, `linux-packages`, `linux-patch`, `linux-prefix`, `linux-wrapper`, `linux-trouble`), and a last panel holds `#language` (English and Japanese text) and `#discord` (linking and bot commands); `js/play.js` opens the one a link or address points at. Last, `#patches` "Client patch versions": the current patch (version, date, size, full SHA-256 with Copy, download from `client_patch`) and a table of the older ones (date, what changed, known problem, size, short SHA-256 with Copy, download from each version's own release `client-patch-v<version>`; one card per version on a phone), from `data/patch-versions.json` (`js/play.js`; the patch size in the steps, `[data-patch-size]`, follows the current one). Versions are `v1.N`, one step per public patch; add one with `hvmhfz_ops` `hunsterverse/mezeporta/release-patch.sh`, which prints the entry. The setup guides that used to hold this text are now only redirect pages (see below). |
| `/guide-windows.html`, `/guide-linux.html` | Redirect pages for the old Windows and Linux guides (the setup guides were folded into the Play page, 4 Nov 2026). Meta refresh to `/play.html#windows` / `#linux`, canonical, noindex, a visible "This guide moved to Play" link, and a small inline script that maps the old `#anchors` (`#patch`, `#trouble`, `#prefix`, `#english`, `#discord`, ...) to the matching Play card or "More help" section. Not in the nav, the footer or the sitemap. |
| `/guide-frontier.html` | Frontier guide, landing page: one card per section (picture and one line), grouped in five chapters (`#start`, `#gear`, `#reference`, `#progression`, `#activities`), plus links to our own guides, the comparison page and the credit to the original guide's author. In the nav under Guides ("Frontier guide"), and a card and a step on the home page. |
| `/guide-frontier-<section>.html` | One guide section each, 18 in reading order: `basics`, `guild`, `house`, `menus`, `items`, `item-box`, `weapons`, `armour`, `transcend`, `monsters`, `tools`, `hunter-rank`, `g-rank-start`, `g-rank`, `zenith`, `quests-food`, `events`, `hunters-road`. Each has breadcrumbs, a side column with "On this page" and "All sections" (sticky on wide screens, folded above the text on phones), the text with its pictures, previous/next links and the credit. Rewritten from Fist's guide (saved as a PDF in January 2022; owner: credit the author by name, don't link the original or its resources). Every section ends with an "On Hunsterverse" note comparing it with our server. |
| `/guide-frontier-hunsterverse.html` | Hunsterverse vs the old servers: a short summary of the differences, the course perks every account has, and one table row per section note (generated by `dev/make-hv-summary.py`). Linked from the landing page and every page's credit. |
| `/guide-frontier-equipment.html`, `-activities.html`, `-reference.html` | Old handbook addresses: a short notice listing the pages that replaced the chapter, and a redirect to its chapter on the landing page. `noindex`, not in the sitemap. |
| `/changelog.html` | Rolling player changelog: "Coming next" (finished, not live), then the released updates by month, day and topic, newest first (contents by month and day; anchors `#d-YYYY-MM-DD` and `#d-YYYY-MM-DD-<topic>`), each change with its release time in UTC and, with JavaScript, the visitor's own time (`js/changelog-times.js`), then known issues. Linked from the footer. Update it at every live deploy (below). |
| `/road-vote.html` | Hunting Road rotation: phase and dates, the entries, vote or take a vote back during the vote window, results after it closes, with the saved sign-in. Signed out (or expired) it shows the Road live now from the public `/api/public/road/versions` (the rotation itself, `/api/road/cycle`, needs the sign-in), how a rotation runs, links to Past winners, Road data and Roads in game, and a "Sign in to vote" button that comes back here. The nav's "Hunting Road › Rotation and vote" link. Needs the saved sign-in; API `/api/road/**`. |
| `/road.html` | Hunting Road builder: per floor its table and two Road points multipliers (capped by the policy's `maxPoints`, default 4x), per table its entries (monster, second monster, weight, forced, level: a picker of any level 0 to 83, the rows of the game's stat table, the ones the live Road uses with that monster first and the others marked "may play at base strength"), add an entry, reset to the base. The monster pickers (`js/builder-ui.js`, with each monster's icon and a search box) offer all 176 monsters the game knows (ids as Erupe's `common/mhfmon`, kept in `js/road-rules.js`; shown under the monster pages' names, its `GUIDE_NAMES`): first the ones the live Road uses, then the Zenith forms ("Zenith Rathalos", first monster only, for the 20 monsters the base Road has a Zenith entry for; the edit sends `"zenith": true` or `false` only when the monster would otherwise come out in the other form, and the server copies the base's own Zenith or normal entry; `dev/check-road-zenith.js`), then those new to the Road. An "Also change the solo Road" box (off by default) shows the solo Road (mode 1) to edit when the policy allows mode 1; unticking it drops those changes. Lists every change from the base in words ("Changes from the base", `js/road-summary.js`), for the Road being built and for an entry opened from the vote page. Checks the rules live with `js/road-rules.js`, asks `POST /api/road/check` before submitting (POST) or saving (PUT), and won't submit while the page itself lists a problem. A "?" circle on every field, button and column says what it does in the game (`js/road-help.js`; hover or focus shows it, a tap keeps it open; on a phone a key above the tables stands in for the hidden column headers). `?entry=<id>` opens an entry (yours to edit during submissions, others read-only). A "Test in game" panel (`js/road-test.js`, shown only while the live setting `road_test` is on) builds the Road being edited with the submission rules (`PUT /api/account/road-test`) and has the game server serve it to the player's account and the quest rooms they host for a set number of hours, as practice (nothing of the runs is saved; Erupe `docs/hvmhfz-road-test.md`); Stop ends it (`DELETE`). Everything about the Road itself (base, tables, policy) comes from `GET /api/road/pool` at run time; the builder holds no game data itself. Signed in only (signed out it sends the visitor to `/?next=/road.html...` and back after sign-in), `noindex`. |
| `/road-data.html` | Hunting Road data, public and static: every Road the server has run (number, name), per floor its Road points multipliers, monster table and monsters with their chance, open and solo Road. No script: `dev/make-road-data.py` writes the tables into the page from the decoded Road files (see that file); run it again when a new Road goes live. |
| `/sky-corridor.html` | Sky Corridor (the Tower), public, from `/api/public/sky/*` (`js/sky.js`, `js/sky-corridor.js`): the town's Duremudira progress per district as bars toward the goals (districts 3 and 4 counted but not shown in town), totals and the last clear; the hunter boards (floors or Duremudira clears, all districts or one, all time or this week: hunters with a clear since Monday 00:00 UTC, still with their all-time totals); the 33 guild missions by page and the guilds with their page's three missions; the present box milestones with how many reached and received each; what the Tower is and how to get in, with links to the Frontier guide. An API without these endpoints (404) or without the tables (`tracking: false`) shows "Sky Corridor stats are coming soon". The hunter profile's Sky Corridor tab (`#sky`) comes from `/api/public/sky/hunter/{id}` and stays hidden on a 404 or when the hunter has nothing there. |
| `/road-history.html` | Past Hunting Road winners (number, name, character, votes, live from and until), public, from `/api/public/road/history`. |
| `/admin.html` | Admin panel: gifts (Erupe distributions) and the Hunting Road rotation (rotations with entries and votes, create, change dates, close now, approve, override the winner, hide/unhide/disqualify, pause). Lists every gift with its items, claims and end, creates a gift (for everyone or one character, with rank limits, a deadline and items picked from the catalog) and ends one. Admin accounts only: the API checks `ROLE_ADMIN` on every `/api/admin/**` request; the account page links here for admins. Its Users tab shows each character's client patch (the version the game sent at its last login, from client patch v1.19; `js/admin-patches.js`) and a line counting played characters on the current patch (the one marked current in `data/patch-versions.json`), an older one, or unknown (v1.18 or older, or not seen since the recording started); `dev/check-admin-patches.js`. Its Custom quests tab (`js/admin-quests.js`) shows "N of CAP event quest slots used" (`GET /api/admin/quest-submissions/event-slots`; approved quests share the in-game event quest list) and the API's reason when a publish is refused because the list is full. Not in the nav, `noindex`. |
| `/report.html` | Bug report (`#bug`) and feature request (`#feature`) forms, for signed-in accounts only: signed out (or expired) the page shows why and a Sign in button that comes back here (`/?next=/report.html...`) and no forms; a 401 from the API (sign-in ran out) asks to sign in again and keeps what was typed (`sessionStorage` `hvmhfz.report-draft`, put back in the form after sign-in). Each report becomes a task on the Kanboard board. |
| `/bot-terms.html` | Prontier bot: Terms of Service (effective 5 Nov 2026): who runs the Discord bot, what its commands and posts do (from `hvmhfz_discord_bot`; no chat relay), acceptable use, no warranty, changes and termination, not affiliated with Capcom or Discord. Linked from the footer. The bot's privacy facts are in the "Prontier Discord bot" section of `/privacy.html#bot`. |
| `/privacy.html` | Privacy and cookies: what the site, API, game server and bot keep, why and how long, the browser storage it uses (`hvmhfz.token`, `hvmhfz.consent`; no cookies of its own), other services (GitHub Pages, Cloudflare Turnstile, the set builder embed, Discord) and players' rights. Linked from the footer and the cookie banner. Update it when the site starts storing or sending anything new. |

## Layout

```
index.html            home and sign in
account.html          signed in account view (tabs: overview, characters with the character view, hunts, guild, custom quests, backups, transfer, account)
guilds.html           guild directory and detail
hunters.html          hunter directory and profile
leaderboards.html     timed hunt leaderboards and guild RP
catalog.html          item and equipment catalog
worlds.html           world status, live board and hunt totals
play.html            Play: Windows, Linux / Steam Deck and character transfer checklists
guide-windows.html    redirect to /play.html#windows (old Windows guide)
guide-linux.html      redirect to /play.html#linux (old Linux guide)
report.html           bug report and feature request forms
guide-frontier.html   Frontier guide landing page (cards per section)
guide-frontier-*.html Frontier guide sections (18), the comparison page and three moved-page notices
bot-terms.html        Prontier Discord bot terms of service
privacy.html          privacy and cookies policy (with a Prontier bot section, #bot)
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
js/guide-moved.js     the old Windows and Linux guide pages: forwards an old address and its #anchor to the matching Play card or section
js/nav.js             site nav: the four menus, and the Menu button on narrow screens
js/background.js      page background: a random picture from assets/backgrounds/ per page load, dark and blurred
js/consent.js         cookie banner (Accept/Decline, kept in localStorage hvmhfz.consent); runs held-back optional scripts after Accept
js/guide-frontier.js  Frontier guide: opens the side lists on wide screens, marks the section in view
js/whatsnew.js        home page "What's new": the newest day of changelog.html
js/changelog-times.js changelog: adds the visitor's local time after each UTC release time
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
js/admin-events.js    admin panel Events tab: the event calendar (/api/admin/events/**); times in UTC; two lanes, one event at a time each: the main event (Hunter Festival, Diva Defense; Monday 03:00 UTC) and the side event (Speedrun Cup, VS Bracket; Thursday 15:00 UTC), each run drawn in its eventLane row (a transition run too), the lane being the event's (no lane field in the form); the gaps (red, in the lane that has no run: no main event, no side event) with "Fill this gap"; one "extend the loop" form per lane (generate with lane main or side, prefilled from loopNext and sideLoopNext); drag a planned run to move it or an edge to change its length (snaps to the hour and to its lane's boundary; long press on phones; arrow keys), checked live against the API's rules, then a before/after preview, the API's check and Save (PUT); a "?" circle on every field says what it does in game (HELP, from Erupe's event docs); its helpers also run under node
js/admin-settings.js  admin panel Settings tab: the game server's live settings (/api/admin/settings/**), forms from the API's spec, review before save, history and revert; the Patch gate section also counts who it would refuse now (/api/admin/settings/patch_gate/impact, stored values, then the form's as edited); its helpers also run under node
js/admin-notices.js   admin panel Notices tab: login notices (the live settings section login_notices) with an MHFML preview, Send now in game and/or on Discord (/api/admin/notices/send, two clicks), scheduled notices (/api/admin/notices/scheduled, cancel); times in UTC; its helpers also run under node
js/admin-content.js   admin panel Content tab: the event content editors (/api/admin/content/**), lists and forms built from the API's specs; items searched in data/item-ids.json; its helpers also run under node
js/admin-patches.js   admin panel Users tab: client patch per character and the current / older / unknown count (GET /api/admin/users, data/patch-versions.json); its helpers also run under node
js/tournaments.js     Tournaments page: Speedrun Cup standings and the VS Bracket; its helpers also run under node
js/catalog.js         catalog browsing
js/monster-links.js   a monster's field guide link from the server's id or name or the guide's name (data/monsters/index.json); used by the quest pages, leaderboards, hunters, account and worlds; also runs under node
js/worlds.js          world status polling
js/activity.js        live board on the Worlds page (/api/public/activity); its pure part also runs under node
dev/mock-feedback.py  local stand-in for POST /api/feedback (testing only)
dev/mock-activity.py  local stand-in for GET /api/public/activity (testing only)
dev/check-tournaments.js checks the Events cards (live rows, 404 fallback) and the Tournaments page in headless Chromium on a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-tournaments.js)
dev/check-events.js checks the Events cards open and close (tap, Enter, Space, Escape), have their sections and valid links, at 375 px and with the API missing (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-events.js)
dev/check-admin-events.js checks the admin Events tab (strip with the two lanes, gaps of both kinds and "Fill this gap", one loop form per lane, drag to move and resize with the mouse, the keyboard and a long press at 375 px, the before/after preview and Save, the "?" circles of every field, list, add, edit, delete, stop, extend the loop) and the Events page's "Next" and side event lines in headless Chromium on a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-events.js)
dev/check-admin-settings.js checks the admin Settings tab (live settings: sections and their game-server state, forms built from the API's spec with config defaults, review of the changes before save, history and revert, the Patch gate's count) in headless Chromium on a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-settings.js)
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
dev/check-road-rewards.js checks js/road-rewards.js on made-up reward rows, with and without boards
dev/site-shell.py     writes the skip link, nav, breadcrumbs and footer into every page from dev/shell/ (nav.html, footer.html, pages.json)
dev/check-site.py     checks that every page is in sync with dev/shell/, has the skip link and the shared scripts, then runs dev/check-nav.py
dev/check-nav.py      checks every page is in pages.json, at most 2 clicks from home, has breadcrumbs, search, one <h1> and a "Page · Hunsterverse" title, the sitemap (every indexable page, monsters by current slug), and runs check-links.py (--self-test: on a made-up site)
dev/check-site-shell.py checks dev/site-shell.py on a small made-up site
dev/check-changelog.py checks changelog.html: month > day > topic, a release time on every change, the contents; and that every bullet of the page before the regrouping (git 8e02a4c) is still there (--self-test: on made-up pages)
dev/check-links.py    checks every local link, picture and anchor, the query parameters detail links use (the target page must read them; monster and quest ids must exist), links built in js/*.js, files scripts name, and sitemap.xml (python3 dev/check-links.py)
dev/make-quest-monsters.py writes each quest's monsters in data/quests.json from its Japanese objective, in the field guide's names
dev/check-catalog-monsters.js checks that every quest catalog monster has a monster page, that make-quest-monsters.py has run, and the monster index (node dev/check-catalog-monsters.js)
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
dev/check-patch-versions.py checks data/patch-versions.json: versions in order without gaps, one current (the newest), changelog ids that exist, each version's own download (python3 dev/check-patch-versions.py [--backups /root/backups/client-patch])
data/patch-files.json  sha256 of the key game files (mhf.exe, mhfo-hd.dll, mhfo.dll, dat/mhfdat.bin, dat/mhfpac.bin, dat/mhfinf.bin, hvmods.dll) inside each client patch zip, by version (pre-releases as 1.21-pre3); the API's Diagnostics upload compares a player's hvdiag.txt with it. Rewrite it after every release: python3 dev/make-patch-files.py --backups /root/backups/client-patch (check only: --check; it fails while a version in patch-versions.json has no entry)
dev/check-diag.js     checks the account page's Diagnostics box (js/account-diag.js: help, upload of the file as it is, the answer, refusals, 256 KB, 375 px) and the admin page's Diagnostics tab and Users tab Logins button (js/admin-diag.js) in headless Chromium against a fake API (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-diag.js)
dev/check-link-command.js checks js/link-command.js: `/link code:<code>` from the token, never the old `!f link` text (node dev/check-link-command.js)
dev/check-signin-next.js checks js/signin-next.js: same-site paths only, hostile values refused (node dev/check-signin-next.js)
dev/check-signup.js   checks the sign-up: the rules in node, then in headless Chromium against a fake API the form switch, page-side mistakes, the API's refusals (409 wrong case, 400, 403, 429, 500, unreachable), success and ?next=, the Play page links, a 360px phone (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-signup.js)
dev/check-report-signin.js checks in headless Chromium, against a fake API, report.html: signed out or expired shows the Sign in button (back to the report page) and no forms, signed in sends the token, a 401 asks to sign in again and keeps what was typed (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-report-signin.js)
dev/check-backup-file.js checks js/backup-file.js on made-up zips and JSON, with Python's zipfile (node dev/check-backup-file.js)
dev/check-account-transfer.js checks the account page's Transfer tab (the transfer wizard) in headless Chromium against a fake API: coming soon on 404, the signed-out return, a new character from our zip, an older zip into an existing character with its warning, bare save and export files, a full account, a file without a save, part checks, 375 px (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-transfer.js)
dev/check-account-qol.js checks the account page's Game options card in headless Chromium against a fake API: one switch per feature the API lists (off by default, description, needed patch, hidden-information note), PUT of only the toggled id, a refused save, 375px width (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-qol.js)

dev/check-quest-expiry.js checks custom quest expiry in headless Chromium against a fake API: the admin event quest slot count and a refused publish, the reminder at the top of the account page, expiry dates, Keep testing, Resubmit, draft Keep and Restore, an API without the fields, the admin Expired/Retired filters and Retire (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-expiry.js)
dev/check-account-details.js checks the account page's Details tab and the Characters tab's links in headless Chromium against a fake API: hunter card and Details links, nothing loaded before the tab opens, the four sections (names, unknown ids, levels, decorations, My Sets, box filter and search, stats), no save, an API without the endpoint, the admin box, 375 px (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-details.js)
dev/check-quest-expiry.js checks custom quest expiry in headless Chromium against a fake API: the admin event quest slot count and a refused publish, the reminder at the top of the account page, expiry dates, Keep testing, Resubmit, drafts without any expiry (no Keep, Restore or deleted section), an API without the fields, the admin Expired/Retired filters and Retire (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-expiry.js)
dev/check-account-details.js checks the account page's character view (Characters tab) and its icons in headless Chromium against a fake API: the icon lookups on the real data file, no Storage or Details tab (old links land on Characters), hunter card and View links, nothing loaded before the tab opens, the seven sections (names, unknown ids, class, rarity, levels, decorations, tinted icons, My Sets, the item box grid and list with search, pouch, warehouse, equipment box filter and search, stats), placeholders for missing pictures, gift icons, no save, an API without /details, the admin box, 375 px (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-details.js)
dev/check-account-backup.js checks the account page's Backups tab in headless Chromium against a fake API: coming soon on 404, download, preview, cancel, confirm, history, refusals (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-backup.js)
dev/check-signin-return.js checks in headless Chromium, against a fake API, that signed-out visits to the Road builder, Quest builder and account page land on the sign-in form with ?next= and a note, that a saved sign-in goes on to next (never off the site), and road-vote.html's public view (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-signin-return.js)
dev/check-sky.js     checks sky-corridor.html and the hunter Sky Corridor tab in headless Chromium against a fake API (sample data, empty, 404, tracking off), with screenshots to dev-shots/ (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-sky.js)
dev/check-quest-maps.js checks the quest builder in headless Chromium against a fake API: only the server's maps can be chosen, a 400 shows next to its field, no unnamed areas (NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-maps.js)
dev/check-quest-zenith.js checks the quest builder's Zenith forms (slot bytes, Zenith flag and rank) in headless Chromium against a fake API (NODE_PATH as above)
dev/check-quest-listing.js checks the quest builder's listing options (counter, mark, players, stars, time of day, season, targets required, the "?" buttons) and the admin's counter and mark change at publishing in headless Chromium against a fake API (NODE_PATH as above)
dev/check-quest-rules.js checks the quest builder's rules and restrictions (Hardcore and its class rule, the restriction list, death count across the G rank line, rank limits and their order, the flag checkboxes, a server refusal, an older draft, 375 px) in headless Chromium against a fake API (NODE_PATH as above)
dev/check-quest-equipment.js checks the quest builder's forced equipment (catalog search with game icons, placeholder rows left out, no blademaster/gunner mix, no piece, decorations, a weapon id past 16,383, a server refusal, the review, an older draft, 375 px) in headless Chromium against a fake API (NODE_PATH as above)
dev/check-quest-rewards.js checks the quest builder's reward and text extras (Reward 1/2/3 with game icons and the fill from the main target's rewards, fixed rewards, sub-target money, the target, clear and fail line fill and its Undo, the review, a server refusal, an older draft, the pages' reward wording, 375 px) in headless Chromium against a fake API (NODE_PATH as above)
dev/check-quest-monsters.js checks the quest builder's monster tuning (difficulty and its G rank rule, size, size spread, each large monster's usual or exact position, the server's position refusal, an older API without spots) in headless Chromium against a fake API (NODE_PATH as above)
dev/check-links.py    checks every local link, picture and #anchor on the site (python3 dev/check-links.py [pages])
dev/make-hv-summary.py writes the comparison tables of guide-frontier-hunsterverse.html from the guide's notes (--check: one note per section, page up to date)
CNAME                 hvmhfz.eclipseforge.xyz
```

Static site, no build step. Push to `main` and GitHub Pages serves it.

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
  `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>`; the group is plain text (a menu, not a page). They
  sit first in the page's `main`, or where the page already had its breadcrumbs (the Frontier guide pages, beside
  their side column), and replace the old "Hunsterverse · X" kicker line. Detail pages call
  `HvCrumbs.item(name)` (`js/nav.js`): the monster and quest pages replace their stand-in crumb, the hunter
  and guild profiles turn "Hunters"/"Guilds" into a link and add the name.

The script also adds `<script src="/js/search.js" defer></script>` before `</body>` on a page that doesn't
load it. It keeps everything else on the page (head, main, scripts).

- Nav, same on every page: five menus and the account button. Labels use the game's and the Discord bot's
  own words (Worlds as the bot's `/worlds`, Hunting Road and Road).
  - **Guides:** Play, Frontier guide.
  - **Database:** Monsters, Quests, Catalog, Set builder, Quest builder.
  - **Hunting Road:** Rotation and vote, Road builder, Past winners, Road data, Roads in game (`guide-roads.html`), Sky Corridor.
  - **Community:** Hunters, Guilds, Leaderboards, Discord.
  - **Server:** Worlds, Events, Changelog, Report a problem.
  - Then the account button (`a.nav-account`): "Sign in" to `/account.html` in the HTML; `js/nav.js` makes it
    "My account" with a saved sign-in that has not expired, and points it at the home page's sign-in form
    (`/#login-form`) without one. `js/search.js` adds the Search button in front. The API page is in the footer.
- Footer, four columns: Guides, Explore (Monsters, Quests, Catalog, Leaderboards, Hunting Road), Server
  (Changelog, Worlds, Report a problem, API) and About (Privacy, Discord, hunstermonter.net).

  Each menu is a `div.nav-group` with a `button.nav-group-toggle` and a `div.nav-menu` of links. The page's
  own link has `aria-current="page"`, and its group button the class `is-current`; the home page, 404,
  privacy, admin and API mark nothing, and a monster's page marks Monsters. On a wide screen a menu opens on hover, or on click and
  keyboard (`js/nav.js`). Below 1160px the bar folds behind the Menu button and lists every group open.
  Both guides also switch between Windows and Linux at the top.
- Width: data pages (monsters, monster, catalog, hunters, guilds, events, worlds, account, set builder) add
  `wide` to their `main` and use the screen up to `--wrap-wide` (1760px); reading pages (guides, changelog, report)
  keep `--wrap` (1120px). Below 1340px the nav folds behind the Menu button.
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
6. Run `python3 dev/check-changelog.py` ("changelog OK") and `python3 dev/check-site.py`.

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

## Links

- Community site (footer link only, not for registration: its sign-up is for another game server): https://hunstermonter.net
- Launcher: https://github.com/LilButter/Mezeporta
- Client patch: https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases

The site is not affiliated with Capcom.
