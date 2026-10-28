# hvmhfz.eclipseforge.xyz

Hunsterverse account portal, community pages and setup guides for Monster Hunter Frontier Z.

## Pages

| Path | What it does |
|---|---|
| `/` | Home: how to start playing (guides, steps) and sign in. After a successful login it hands over to `/account.html`. |
| `/account.html` | Signed in view: overview (with the Hunting Road rewards and a character picker to claim them), characters, storage, hunt log, guild and account. Redirects to `/` without a valid session. |
| `/monsters.html` | Monster field guide: search by name or species, cards link to full hitzone, HP and drop pages. |
| `/monster.html?m=slug` | One monster: hitzones normal and enraged, HP by level, stagger limits, maps, every carve table, Henshu/GR/Zenith forms. |
| `/events.html` | Live server events, the event quest pool and the Festa prize table. |
| `/guilds.html` | Guild directory: search, sort by RP, members, newest or name. `?id=` opens a guild with roster and board. |
| `/hunters.html` | Hunter rankings: search, sort by HR, GR, recent or name. `?id=` opens a hunter profile; `?q=` opens the list searching for a name. |
| `/leaderboards.html` | Timed hunt boards: top hunters, top guilds (hunts by current members) and most hunted monsters for this week, last week, this month, last month and all time (UTC; weeks start Monday), from `/api/public/leaderboards/hunts`; plus guild RP. `#<board>-<period>` picks one (`#hunters-week`, `#guilds-month`, `#monsters-all`, `#rp`); the old `#hr`, `#gr` and `#guilds` links still land on a board. Tied scores share a rank. |
| `/catalog.html` | Item and equipment catalog with section chips and search. |
| `/worlds.html` | Live world status, the live board (who is online, in town or on a quest and which quest, and who is questing together, from `/api/public/activity`; each name links to its hunter profile by `charId`, or to the Hunters page searching for it when the answer has no `charId`) and server wide hunt totals, refreshed every 30 seconds. |
| `/guide-windows.html` | Windows setup guide: client, patch, Mezeporta launcher, server entry, troubleshooting, English patch. |
| `/guide-linux.html` | Linux setup guide: Wine, portable prefix, KDE/NVIDIA fixes, same server entry, troubleshooting. |
| `/changelog.html` | Rolling player changelog: "Coming next" (finished, not live), then one dated entry per live update, newest first, then known issues. Linked from the footer. Update it at every live deploy (below). |
| `/road-vote.html` | Hunting Road rotation: phase and dates, the entries, vote or take a vote back during the vote window, results after it closes. Signed in (shows a sign-in prompt otherwise). The nav's "Hunting Road" link. Needs the saved sign-in; API `/api/road/**`. |
| `/road.html` | Hunting Road builder: per floor its table and two Road points multipliers (capped by the policy's `maxPoints`, default 4x), per table its entries (monster, second monster, weight, forced), add an entry, reset to the base. The monster lists offer all 176 monsters the game knows (ids and names as Erupe's `common/mhfmon`, kept in `js/road-rules.js`): first the ones the live Road uses, then those new to the Road. An "Also change the solo Road" box (off by default) shows the solo Road (mode 1) to edit when the policy allows mode 1; unticking it drops those changes. Checks the rules live with `js/road-rules.js`, asks `POST /api/road/check` before submitting (POST) or saving (PUT), and won't submit while the page itself lists a problem. `?entry=<id>` opens an entry (yours to edit during submissions, others read-only). Everything about the Road itself (base, tables, policy) comes from `GET /api/road/pool` at run time; no game data is in the repo. Signed in only, `noindex`. |
| `/road-history.html` | Past Hunting Road winners (number, name, character, votes, live from and until), public, from `/api/public/road/history`. |
| `/admin.html` | Admin panel: gifts (Erupe distributions) and the Hunting Road rotation (rotations with entries and votes, create, change dates, close now, approve, override the winner, hide/unhide/disqualify, pause). Lists every gift with its items, claims and end, creates a gift (for everyone or one character, with rank limits, a deadline and items picked from the catalog) and ends one. Admin accounts only: the API checks `ROLE_ADMIN` on every `/api/admin/**` request; the account page links here for admins. Not in the nav, `noindex`. |
| `/report.html` | Bug report (`#bug`) and feature request (`#feature`) forms. No sign-in. Each report becomes a task on the Kanboard board. |
| `/privacy.html` | Privacy and cookies: what the site, API, game server and bot keep, why and how long, the browser storage it uses (`hvmhfz.token`, `hvmhfz.consent`; no cookies of its own), other services (GitHub Pages, Cloudflare Turnstile, the set builder embed, Discord) and players' rights. Linked from the footer and the cookie banner. Update it when the site starts storing or sending anything new. |

## Layout

```
index.html            home and sign in
account.html          signed in account view (tabs: overview, characters, storage, hunts, guild, account)
guilds.html           guild directory and detail
hunters.html          hunter directory and profile
leaderboards.html     timed hunt leaderboards and guild RP
catalog.html          item and equipment catalog
worlds.html           world status, live board and hunt totals
guide-windows.html    Windows guide
guide-linux.html      Linux guide
report.html           bug report and feature request forms
privacy.html          privacy and cookies policy
admin.html            admin panel: gifts (distributions) and the Hunting Road rotation
road.html             Hunting Road builder and entry viewer
road-vote.html        Hunting Road rotation: entries, vote, results
road-history.html     past Hunting Road winners (public)
changelog.html        player changelog (rolling, one entry per live update)
css/styles.css        shared guild-hall theme (leather page, parchment panels, brass trim, gold buttons)
assets/guide/*.webp   guide screenshots, WebP
assets/backgrounds/   page background pictures (rules and sizes in its README.md)
assets/favicon.png    site icon
js/nav.js             site nav: the four menus, and the Menu button on narrow screens
js/background.js      page background: a random picture from assets/backgrounds/ per page load, dark and blurred
js/consent.js         cookie banner (Accept/Decline, kept in localStorage hvmhfz.consent); runs held-back optional scripts after Accept
js/whatsnew.js        home page "What's new": the newest entry of changelog.html
js/main.js            login, saved session
js/turnstile.js       Cloudflare Turnstile widget, shared by main.js and report.js
js/report.js          report forms: send, success, error and Discord fallback
js/admin.js           admin panel: gift list, new gift form, end a gift (/api/admin/distributions); Hunting Road rotations (/api/admin/road)
js/road-rules.js      Hunting Road rules in the browser (port of the Go road package); also runs under node
js/road.js            Hunting Road builder
js/road-vote.js       Hunting Road vote page
js/road-history.js    Hunting Road past winners
js/account.js         account page, including storage and hunt log
js/guilds.js          guild directory and detail
js/hunters.js         hunter directory and profile
js/leaderboards.js    leaderboards, from /api/public/leaderboards/hunts and the guild list
js/catalog.js         catalog browsing
js/worlds.js          world status polling
js/activity.js        live board on the Worlds page (/api/public/activity); its pure part also runs under node
dev/mock-feedback.py  local stand-in for POST /api/feedback (testing only)
dev/mock-activity.py  local stand-in for GET /api/public/activity (testing only)
dev/check-activity.js checks js/activity.js on the made-up boards in dev/activity-fixtures.json
dev/check-road-rules.js  checks js/road-rules.js against the Go golden outputs (needs the base Road as JSON, see the file)
dev/check-road-monsters.js checks the any-of-176 monsters rule and where a new monster's fields come from, on a made-up Road
dev/check-road-policy.js checks the policy rules the Go outputs don't cover (points cap, solo Road) on a made-up Road
dev/check-site.py     checks that every page has the same nav, footer and skip link
CNAME                 hvmhfz.eclipseforge.xyz
```

Static site, no build step. Push to `main` and GitHub Pages serves it.

## Site shell

There are no templates: every page carries its own copy of the same header nav and footer.

- Nav, same on every page: four menus and three links.
  - **Database:** Monsters, Catalog, Set builder.
  - **Community:** Hunters, Guilds, Leaderboards, Hunting Road.
  - **Server:** Worlds, Events, Changelog.
  - **Guides:** Windows guide, Linux guide.
  - Then Report, Account and Discord. `js/search.js` adds the Search button in front.

  Each menu is a `div.nav-group` with a `button.nav-group-toggle` and a `div.nav-menu` of links. The page's
  own link has `aria-current="page"`, and its group button the class `is-current`; the home page and 404
  mark nothing, and a monster's page marks Monsters. On a wide screen a menu opens on hover, or on click and
  keyboard (`js/nav.js`). Below 1160px the bar folds behind the Menu button and lists every group open.
  Both guides also switch between Windows and Linux at the top.
- Width: data pages (monsters, monster, catalog, hunters, guilds, events, worlds, account, set builder) add
  `wide` to their `main` and use the screen up to `--wrap-wide` (1760px); reading pages (guides, changelog, report)
  keep `--wrap` (1120px). Below 1340px the nav folds behind the Menu button.
- Each page also has the skip link (`<a class="skip-link" href="#content">`), a `main` with `id="content"`,
  the footer `footer.site-foot` (with the Privacy link), `/css/styles.css`, `/js/nav.js`, `/js/background.js` and `/js/consent.js`.
- The bar is sticky. Below 980px wide `js/nav.js` folds the links behind a Menu button; without JavaScript
  they wrap into a grid under the logo.

To change the nav or footer, change it on every page and in `NAV` in `dev/check-site.py`, then run:

```
python3 dev/check-site.py      # "site shell OK", exit code 0
```

It also reports local links and images that point at missing files.

## Changelog

`changelog.html` is the players' record of every live update. Whenever an update goes live (a new game
server build, a database fix players notice, a new Discord bot build), add it in the same change:

1. Add an `<h3>` at the top of "Released updates", titled `<day> <Mon> <year>: <what>`, newest first.
2. Move the entries that went live out of "Coming next". For a game server build, the source is that
   build's player notes ("Next build" in Erupe's `docs/hvmhfz-changelog.md`).
3. Update "Last update listed" in the page's meta line, and "Known issues" if one was fixed or found.

Write for players: what they see in game, no packet names or commit ids. Leave out how to abuse a hole
that is not fixed on live yet.

## API

All read through `https://api.hvmhfz.eclipseforge.xyz`.

- Public: `/api/public/summary`, `/guilds`, `/guilds/{id}`, `/hunters`, `/hunters/{id}`, `/catalog/items`, `/catalog/equipment`, `/worlds`, `/monsters`, `/activity`.
- Account (JWT): `/api/account`, `/characters`, `/guilds`, `/discord`, `/characters/{id}/storage`, `/characters/{id}/hunts`.

- Feedback (no sign-in): `POST /api/feedback`, used by `report.html`.

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

**Who sent it:** when the player is signed in (the home page's token in `localStorage`,
`hvmhfz.token`), the page sends it as `Authorization: Bearer ...` and the API signs the task
with that account and its linked Discord ("Reported by"). Nothing the form says about the sender
is used, so nobody can sign a report as someone else. The form shows who it will be signed as,
from `/api/account`. Signed out, the task says "Not signed in". Needs API `api-feedback-signed`
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

The policy rules the Go fixtures don't cover (the points cap `maxPoints`, the solo Road) are checked on a
made-up Road, no game data needed: `node dev/check-road-policy.js`.

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
python3 dev/mock-feedback.py 201 8099     # or 400, 403, 413, 429, 502
python3 -m http.server 8000
```

Open `http://localhost:8000/report.html?api=http://localhost:8099`. The `?api=` override and
Cloudflare's always-pass test Turnstile key are only used on `localhost` and `127.0.0.1`; the live
site always uses the real API and key.

## Links

- Community site and Discord: https://hunstermonter.net
- Launcher: https://github.com/LilButter/Mezeporta
- Client patch: https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases

The site is not affiliated with Capcom.
