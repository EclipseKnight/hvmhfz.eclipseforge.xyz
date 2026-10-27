# hvmhfz.eclipseforge.xyz

Hunsterverse account portal, community pages and setup guides for Monster Hunter Frontier Z.

## Pages

| Path | What it does |
|---|---|
| `/` | Home: how to start playing (guides, steps) and sign in. After a successful login it hands over to `/account.html`. |
| `/account.html` | Signed in view: overview, characters, storage, hunt log, guild and account. Redirects to `/` without a valid session. |
| `/monsters.html` | Monster field guide: search by name or species, cards link to full hitzone, HP and drop pages. |
| `/monster.html?m=slug` | One monster: hitzones normal and enraged, HP by level, stagger limits, maps, every carve table, Henshu/GR/Zenith forms. |
| `/events.html` | Live server events, the event quest pool and the Festa prize table. |
| `/guilds.html` | Guild directory: search, sort by RP, members, newest or name. `?id=` opens a guild with roster and board. |
| `/hunters.html` | Hunter rankings: search, sort by HR, GR, recent or name. `?id=` opens a hunter profile. |
| `/leaderboards.html` | Timed hunt boards: top hunters, top guilds (hunts by current members) and most hunted monsters for this week, last week, this month, last month and all time (UTC; weeks start Monday), from `/api/public/leaderboards/hunts`; plus guild RP. `#<board>-<period>` picks one (`#hunters-week`, `#guilds-month`, `#monsters-all`, `#rp`); the old `#hr`, `#gr` and `#guilds` links still land on a board. Tied scores share a rank. |
| `/catalog.html` | Item and equipment catalog with section chips and search. |
| `/worlds.html` | Live world status and server wide hunt totals, refreshed every 30 seconds. |
| `/guide-windows.html` | Windows setup guide: client, patch, Mezeporta launcher, server entry, troubleshooting, English patch. |
| `/guide-linux.html` | Linux setup guide: Wine, portable prefix, KDE/NVIDIA fixes, same server entry, troubleshooting. |
| `/changelog.html` | Rolling player changelog: "Coming next" (finished, not live), then one dated entry per live update, newest first, then known issues. Linked from the footer. Update it at every live deploy (below). |
| `/report.html` | Bug report (`#bug`) and feature request (`#feature`) forms. No sign-in. Each report becomes a task on the Kanboard board. |

## Layout

```
index.html            home and sign in
account.html          signed in account view (tabs: overview, characters, storage, hunts, guild, account)
guilds.html           guild directory and detail
hunters.html          hunter directory and profile
leaderboards.html     timed hunt leaderboards and guild RP
catalog.html          item and equipment catalog
worlds.html           world status and hunt totals
guide-windows.html    Windows guide
guide-linux.html      Linux guide
report.html           bug report and feature request forms
changelog.html        player changelog (rolling, one entry per live update)
css/styles.css        shared guild-hall theme (leather page, parchment panels, brass trim, gold buttons)
assets/guide/*.webp   guide screenshots, WebP
assets/favicon.png    site icon
js/nav.js             site nav: folds the links behind a Menu button on narrow screens
js/main.js            login, saved session
js/turnstile.js       Cloudflare Turnstile widget, shared by main.js and report.js
js/report.js          report forms: send, success, error and Discord fallback
js/account.js         account page, including storage and hunt log
js/guilds.js          guild directory and detail
js/hunters.js         hunter directory and profile
js/leaderboards.js    leaderboards, from /api/public/leaderboards/hunts and the guild list
js/catalog.js         catalog browsing
js/worlds.js          world status polling
dev/mock-feedback.py  local stand-in for POST /api/feedback (testing only)
dev/check-site.py     checks that every page has the same nav, footer and skip link
CNAME                 hvmhfz.eclipseforge.xyz
```

Static site, no build step. Push to `main` and GitHub Pages serves it.

## Site shell

There are no templates: every page carries its own copy of the same header nav and footer.

- Nav, same on every page and in this order: Monsters, Events, Guilds, Hunters, Catalog, Worlds, Guides, Report, Account, Discord.
  The page's own link has `aria-current="page"`; the guide pages mark Guides, the leaderboards page marks Hunters,
  and the home page marks nothing. The bar is full: the leaderboards page is linked from the Hunters and Guilds
  pages, and the changelog from the footer.
  Guides opens the Windows guide; both guides switch between Windows and Linux at the top.
- Width: data pages (monsters, monster, catalog, hunters, guilds, events, worlds, account, set builder) add
  `wide` to their `main` and use the screen up to `--wrap-wide` (1760px); reading pages (guides, changelog, report)
  keep `--wrap` (1120px). Below 1340px the nav folds behind the Menu button.
- Each page also has the skip link (`<a class="skip-link" href="#content">`), a `main` with `id="content"`,
  the footer `footer.site-foot`, `/css/styles.css` and `/js/nav.js`.
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

- Public: `/api/public/summary`, `/guilds`, `/guilds/{id}`, `/hunters`, `/hunters/{id}`, `/catalog/items`, `/catalog/equipment`, `/worlds`, `/monsters`.
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
