# hvmhfz.eclipseforge.xyz

Hunsterverse account-linking site and setup guides for Monster Hunter Frontier Z.

## Pages

| Path | What it does |
|---|---|
| `/` | Account linking. Sign in with the game account, then run the `!f link <token>` command in the `#mhfrontier` Discord channel. |
| `/guide-windows.html` | Windows setup guide: client, patch, Mezeporta launcher, server entry, troubleshooting, English patch. |
| `/guide-linux.html` | Linux setup guide: Wine, portable prefix, KDE/NVIDIA fixes, same server entry, troubleshooting. |

## Layout

```
index.html            account linking
guide-windows.html    Windows guide
guide-linux.html      Linux guide
css/styles.css        shared guild theme (parchment, gold, leather)
assets/guide/*.webp   guide screenshots, WebP
assets/favicon.png    site icon
js/main.js            login, Cloudflare Turnstile, activation code
CNAME                 hvmhfz.eclipseforge.xyz
```

Static site, no build step. Push to `main` and GitHub Pages serves it.

## Links

- Community site and Discord: https://hunstermonter.net
- Launcher: https://github.com/LilButter/Mezeporta
- Client patch: https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases

The site is not affiliated with Capcom.
