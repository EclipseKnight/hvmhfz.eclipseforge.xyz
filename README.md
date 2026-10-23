# hvmhfz.eclipseforge.xyz

Hunsterverse account portal, community pages and setup guides for Monster Hunter Frontier Z.

## Pages

| Path | What it does |
|---|---|
| `/` | Sign in. After a successful login it hands over to `/account.html`. |
| `/account.html` | Signed in view: overview, characters, storage, hunt log, guild and account. Redirects to `/` without a valid session. |
| `/guilds.html` | Guild directory: search, sort by RP, members, newest or name. `?id=` opens a guild with roster and board. |
| `/hunters.html` | Hunter rankings: search, sort by HR, GR, recent or name. `?id=` opens a hunter profile. |
| `/catalog.html` | Item and equipment catalog with section chips and search. |
| `/worlds.html` | Live world status and server wide hunt totals, refreshed every 30 seconds. |
| `/guide-windows.html` | Windows setup guide: client, patch, Mezeporta launcher, server entry, troubleshooting, English patch. |
| `/guide-linux.html` | Linux setup guide: Wine, portable prefix, KDE/NVIDIA fixes, same server entry, troubleshooting. |

## Layout

```
index.html            sign in
account.html          signed in account view (tabs: overview, characters, storage, hunts, guild, account)
guilds.html           guild directory and detail
hunters.html          hunter directory and profile
catalog.html          item and equipment catalog
worlds.html           world status and hunt totals
guide-windows.html    Windows guide
guide-linux.html      Linux guide
css/styles.css        shared guild theme (parchment, gold, leather)
assets/guide/*.webp   guide screenshots, WebP
assets/favicon.png    site icon
js/main.js            login, Cloudflare Turnstile, saved session
js/account.js         account page, including storage and hunt log
js/guilds.js          guild directory and detail
js/hunters.js         hunter directory and profile
js/catalog.js         catalog browsing
js/worlds.js          world status polling
CNAME                 hvmhfz.eclipseforge.xyz
```

Static site, no build step. Push to `main` and GitHub Pages serves it.

## API

All read through `https://api.hvmhfz.eclipseforge.xyz`.

- Public: `/api/public/summary`, `/guilds`, `/guilds/{id}`, `/hunters`, `/hunters/{id}`, `/catalog/items`, `/catalog/equipment`, `/worlds`, `/monsters`.
- Account (JWT): `/api/account`, `/characters`, `/guilds`, `/discord`, `/characters/{id}/storage`, `/characters/{id}/hunts`.

Character storage and hunt endpoints are scoped to the signed in user; another account's character returns 404. Save data is decoded in memory and never stored or exposed raw.

## Links

- Community site and Discord: https://hunstermonter.net
- Launcher: https://github.com/LilButter/Mezeporta
- Client patch: https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases

The site is not affiliated with Capcom.
