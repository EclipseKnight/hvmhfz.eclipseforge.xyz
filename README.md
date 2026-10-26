# hvmhfz.eclipseforge.xyz

Hunsterverse account portal, community pages and setup guides for Monster Hunter Frontier Z.

## Pages

| Path | What it does |
|---|---|
| `/` | Home: how to start playing (guides, steps) and sign in. After a successful login it hands over to `/account.html`. |
| `/account.html` | Signed in view: overview, characters, storage, hunt log, guild and account. Redirects to `/` without a valid session. |
| `/guilds.html` | Guild directory: search, sort by RP, members, newest or name. `?id=` opens a guild with roster and board. |
| `/hunters.html` | Hunter rankings: search, sort by HR, GR, recent or name. `?id=` opens a hunter profile. |
| `/catalog.html` | Item and equipment catalog with section chips and search. |
| `/worlds.html` | Live world status and server wide hunt totals, refreshed every 30 seconds. |
| `/guide-windows.html` | Windows setup guide: client, patch, Mezeporta launcher, server entry, troubleshooting, English patch. |
| `/guide-linux.html` | Linux setup guide: Wine, portable prefix, KDE/NVIDIA fixes, same server entry, troubleshooting. |
| `/report.html` | Bug report (`#bug`) and feature request (`#feature`) forms. No sign-in. Each report becomes a task on the Kanboard board. |

## Layout

```
index.html            home and sign in
account.html          signed in account view (tabs: overview, characters, storage, hunts, guild, account)
guilds.html           guild directory and detail
hunters.html          hunter directory and profile
catalog.html          item and equipment catalog
worlds.html           world status and hunt totals
guide-windows.html    Windows guide
guide-linux.html      Linux guide
report.html           bug report and feature request forms
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
js/catalog.js         catalog browsing
js/worlds.js          world status polling
dev/mock-feedback.py  local stand-in for POST /api/feedback (testing only)
dev/check-site.py     checks that every page has the same nav, footer and skip link
CNAME                 hvmhfz.eclipseforge.xyz
```

Static site, no build step. Push to `main` and GitHub Pages serves it.

## Site shell

There are no templates: every page carries its own copy of the same header nav and footer.

- Nav, same on every page and in this order: Guilds, Hunters, Catalog, Worlds, Guides, Report, Account, Discord.
  The page's own link has `aria-current="page"`; the guide pages mark Guides, and the home page marks nothing.
  Guides opens the Windows guide; both guides switch between Windows and Linux at the top.
- Each page also has the skip link (`<a class="skip-link" href="#content">`), a `main` with `id="content"`,
  the footer `footer.site-foot`, `/css/styles.css` and `/js/nav.js`.
- The bar is sticky. Below 980px wide `js/nav.js` folds the links behind a Menu button; without JavaScript
  they wrap into a grid under the logo.

To change the nav or footer, change it on every page and in `NAV` in `dev/check-site.py`, then run:

```
python3 dev/check-site.py      # "site shell OK", exit code 0
```

It also reports local links and images that point at missing files.

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
| `contact` | optional Discord name | optional Discord name | 64 |
| `website` | honeypot, empty for people | same | |
| `turnstileToken` | Turnstile response | same | |

Optional fields are sent as empty strings. The page expects `201 {"taskId": n}` (or `200` with no
body when the honeypot was filled), `400` bad input, `403` Turnstile failed, `429` rate limited.
Any other answer, a network error or no answer within 15 seconds shows the Discord fallback: the
report as plain text to copy into #mhfrontier.

### Testing the report page locally

```
python3 dev/mock-feedback.py 201 8099     # or 400, 403, 429, 502
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
