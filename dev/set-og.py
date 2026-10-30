#!/usr/bin/env python3
"""Point every page's preview tags at its own card, and report pages whose description is a copy.

    dev/set-og.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

PAGE_CARD = {
    "index.html": "index", "hunters.html": "hunters", "leaderboards.html": "leaderboards",
    "worlds.html": "worlds", "quests.html": "quests", "quest.html": "quest",
    "quest-editor.html": "quest-editor",
    "monsters.html": "monsters", "monster.html": "monsters", "guilds.html": "guilds",
    "events.html": "events", "road-vote.html": "road-vote", "road.html": "road-vote",
    "road-history.html": "road-vote", "catalog.html": "catalog", "set-builder.html": "set-builder",
    "changelog.html": "changelog", "api.html": "api", "guide-windows.html": "guide-windows",
    "guide-linux.html": "guide-linux",
}

BASE = "https://hvmhfz.eclipseforge.xyz"
seen_desc = {}

for name, slug in PAGE_CARD.items():
    path = ROOT / name
    if not path.exists():
        continue
    text = path.read_text()
    image = f"{BASE}/assets/og/{slug}.png"
    text = re.sub(r'(<meta property="og:image" content=")[^"]*(")', r"\g<1>" + image + r"\g<2>", text, count=1)
    text = re.sub(r'(<meta name="twitter:image" content=")[^"]*(")', r"\g<1>" + image + r"\g<2>", text, count=1)
    path.write_text(text)

    m = re.search(r'<meta property="og:description" content="([^"]*)"', text)
    if m:
        seen_desc.setdefault(m.group(1), []).append(name)

for desc, pages in seen_desc.items():
    if len(pages) > 1:
        print("same description on", ", ".join(pages), ":", desc[:70])

print("cards set for", len(PAGE_CARD), "pages")
