#!/usr/bin/env python3
"""Write the share pages: one small static page per monster, quest, item, weapon type and changelog day,
whose preview tags (og:/twitter:) describe that one thing, and which send a person on to the real page.

    python3 dev/make-share-pages.py           rewrites s/ (run after the data or the changelog changes)
    python3 dev/make-share-pages.py --check   exit 1 if s/ is out of date, changes nothing

Why: Discord, X and other link previews read a page's HTML without running its JavaScript, so a deep
link such as /monster.html?m=akantor shows monster.html's generic card. /s/monster/akantor.html shows
Akantor's name, kind, weak elements, HP and its own card (assets/og/monster/, dev/make-og.py), then opens
/monster.html?m=akantor (a script for browsers, a meta refresh without JavaScript, a visible link last).
The pages' "Copy link" button (js/share.js) copies these addresses.

    s/monster/<slug>.html     every monster of data/monsters/index.json (its own card)
    s/quest/<id>.html         every quest of data/quests.json (the card of its first monster, else quest.png)
    s/item/<id>.html          every item with sources (data/items/<id>.json; the others have no item data)
    s/weapon/<type>.html      every weapon type; ?w=<id> is passed on, so /s/weapon/lance.html?w=812
                              previews as the Lance list and opens weapon 812 (one page per weapon would be
                              16,000 files)
    s/changelog/<date>.html   every day on changelog.html; a #d-<date>-<topic> anchor is passed on

X reads the og: tags when the twitter: ones are missing, so only twitter:card is repeated.
About 11,800 files of about 1.5 KB (mostly quests and items). They are noindex: search engines keep the
real pages (sitemap.xml). dev/check-embeds.py checks them.
"""
import html
import json
import pathlib
import re
import sys

sys.dont_write_bytecode = True  # no __pycache__ from importing make-og.py
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from importlib import import_module

make_og = import_module("make-og")

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "s"
BASE = "https://hvmhfz.eclipseforge.xyz"
KINDS = ("monster", "quest", "item", "weapon", "changelog")


def clip(text, limit=200):
    """Previews cut descriptions around 200-300 characters; cut at a word and say so."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[:limit - 1].rsplit(" ", 1)[0].rstrip(",;:·") + "…"


def page(path, title, description, target, image, large=True, keep_query=None, label=None):
    """One share page. target: the real page (root-relative); keep_query: a query parameter (digits only)
    the script passes on to it; image: root-relative picture, 1200x630 when large, else square."""
    e = lambda s: html.escape(s, quote=True)
    url = f"{BASE}/s/{path}"
    full_title = f"{title} · Hunsterverse"
    desc = clip(description)
    if keep_query:
        # the address may carry ?<keep_query>=digits (a weapon id): add it to the target, nothing else
        go = ("var t=" + json.dumps(target) + ",v=new URLSearchParams(location.search).get(" + json.dumps(keep_query)
              + ");if(v&&/^\\d+$/.test(v))t+=(t.indexOf('?')<0?'?':'&')+" + json.dumps(keep_query + "=") + "+v;"
              "location.replace(t.split('#')[0]+(location.hash||(t.indexOf('#')<0?'':'#'+t.split('#')[1])));")
    else:
        # a #anchor on the share address (a changelog topic) replaces the target's own
        go = ("var t=" + json.dumps(target) + ";location.replace(location.hash?t.split('#')[0]+location.hash:t);")
    go = go.replace("</", "<\\/")
    card = "summary_large_image" if large else "summary"
    size = ('\n<meta property="og:image:width" content="1200" />\n<meta property="og:image:height" content="630" />'
            if large else "")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<!-- dev/make-share-pages.py -->
<title>{e(full_title)}</title>
<meta name="description" content="{e(desc)}" />
<meta name="robots" content="noindex, follow" />
<link rel="canonical" href="{e(BASE + target)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Hunsterverse" />
<meta property="og:title" content="{e(title)}" />
<meta property="og:description" content="{e(desc)}" />
<meta property="og:url" content="{e(url)}" />
<meta property="og:image" content="{e(BASE + image)}" />{size}
<meta name="twitter:card" content="{card}" />
<meta name="theme-color" content="#150e09" />
<script>{go}</script>
<meta http-equiv="refresh" content="0; url={e(target)}" />
</head>
<body style="background:#150e09;color:#f5ebd6;font:16px/1.5 sans-serif;padding:24px">
<p>Opening <a style="color:#e3c26b" href="{e(target)}">{e(label or title)} on Hunsterverse</a>…</p>
</body>
</html>
"""


def monsters():
    index = json.loads((ROOT / "data" / "monsters" / "index.json").read_text())
    by_name = {}
    for entry in index:
        subtitle, extra, _ = make_og.monster_summary(entry)
        card = f"/assets/og/monster/{entry['slug']}.png"
        by_name[entry["name"]] = card
        tail = ("Hitzones per rank, status, drops, attacks and HP from the game's data." if make_og.game_data(entry)
                else "Hitzones, HP by level, stagger limits, maps and drops.")
        desc = subtitle + ". " + (extra + ". " if extra else "") + tail
        yield f"monster/{entry['slug']}.html", page(f"monster/{entry['slug']}.html", entry["name"], desc,
                                                    f"/monster.html?m={entry['slug']}", card)
    monsters.cards = by_name


def quests(cards):
    details = json.loads((ROOT / "data" / "quest-details.json").read_text())
    for quest in json.loads((ROOT / "data" / "quests.json").read_text())["quests"]:
        qid = quest["id"]
        d = details.get(str(qid)) or {}
        parts = [quest.get("category") or "Quest"]
        if quest.get("monsters"):
            parts.append(", ".join(quest["monsters"]))
        objective = d.get("objectiveEn") or quest.get("objective")
        if objective:
            parts.append(objective)
        if d.get("minutes"):
            parts.append(f"{d['minutes']} min")
        if d.get("rewardMoney"):
            parts.append(f"{d['rewardMoney']:,}z reward")
        image = next((cards[m] for m in quest.get("monsters") or [] if m in cards), "/assets/og/quest.png")
        name = quest.get("name") or f"Quest {qid}"
        yield f"quest/{qid}.html", page(f"quest/{qid}.html", name, " · ".join(parts) + ".", f"/quest.html?id={qid}", image)


def items():
    for path in sorted((ROOT / "data" / "items").glob("*.json"), key=lambda p: p.stem):
        if not path.stem.isdigit():
            continue
        item = json.loads(path.read_text())
        drops = sorted(item.get("drops") or [], key=lambda d: -(d.get("pct") or 0))
        monsters_seen = []
        for d in drops:
            if d.get("monster") and d["monster"] not in monsters_seen:
                monsters_seen.append(d["monster"])
        bits = []
        if drops:
            top = drops[0]
            first = f"Dropped by {top['monster']} ({top.get('rank')}, {top.get('method')}, {top.get('pct'):g}%)"
            more = len(monsters_seen) - 1
            bits.append(first + (f" and {more} more monster{'s' if more != 1 else ''}" if more > 0 else ""))
        quest_list = item.get("quests") or []
        if quest_list:
            bits.append(f"needed to enter {len(quest_list):,} quest{'s' if len(quest_list) != 1 else ''}")
        rewarded = len({r[0] for r in item.get("rewards") or []})
        if rewarded:
            bits.append(f"a reward of {rewarded:,} quest{'s' if rewarded != 1 else ''}")
        desc = ("; ".join(bits) + ". " if bits else "") + "Every drop chance by rank, the quests that reward it and the quests that need it."
        yield f"item/{item['id']}.html", page(f"item/{item['id']}.html", item["name"], desc[0].upper() + desc[1:],
                                              f"/item.html?id={item['id']}", "/assets/og/item.png")


def weapons():
    index = json.loads((ROOT / "data" / "weapons" / "index.json").read_text())
    for kind in index.get("types") or []:
        desc = (f"{kind['weapons']:,} {kind['name']} weapons: attack as shown and true, affinity, element, slots and "
                f"sharpness; {kind.get('moves') or 'every'} moves with motion values per style, and a damage calculator.")
        yield f"weapon/{kind['slug']}.html", page(f"weapon/{kind['slug']}.html", kind["name"], desc,
                                                  f"/weapons.html?type={kind['slug']}",
                                                  f"/assets/og/weapon/{kind['slug']}.png", keep_query="w")


def changelog_days():
    text = (ROOT / "changelog.html").read_text()
    starts = [(m.start(), m.group(1)) for m in re.finditer(r'<section class="cl-day" id="d-(\d{4}-\d\d-\d\d)"', text)]
    for n, (start, day) in enumerate(starts):
        chunk = text[start: starts[n + 1][0] if n + 1 < len(starts) else len(text)]
        strip = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s)).strip()
        heading = re.search(r'class="cl-day-title[^"]*"[^>]*>(.*?)</h4>', chunk, re.S)
        when = strip(heading.group(1)) if heading else day
        topics = re.search(r'<p class="cl-topics">(.*?)</p>', chunk, re.S)
        heads = [strip(b).rstrip(":") for b in re.findall(r"</time>\s*<b>(.*?)</b>", chunk, re.S)]
        desc = (strip(topics.group(1)) + ". " if topics else "") + "; ".join(heads)
        yield f"changelog/{day}.html", page(f"changelog/{day}.html", f"Changelog: {when}", desc or "Server and site updates.",
                                            f"/changelog.html#d-{day}", "/assets/og/changelog.png",
                                            label=f"the changelog for {when}")


def build():
    files = dict(monsters())
    files.update(quests(monsters.cards))
    files.update(items())
    files.update(weapons())
    files.update(changelog_days())
    return files


def main():
    check = "--check" in sys.argv[1:]
    files = build()
    stale = [p for kind in KINDS for p in sorted((OUT / kind).glob("*.html"))
             if str(p.relative_to(OUT)) not in files]
    changed = [rel for rel, body in files.items()
               if not (OUT / rel).exists() or (OUT / rel).read_text() != body]
    if check:
        for rel in changed:
            print("out of date: s/" + rel)
        for p in stale:
            print("no longer made: " + str(p.relative_to(ROOT)))
        sys.exit(1 if changed or stale else 0)
    for rel in changed:
        (OUT / rel).parent.mkdir(parents=True, exist_ok=True)
        (OUT / rel).write_text(files[rel])
    for p in stale:
        p.unlink()
    counts = {k: sum(1 for rel in files if rel.startswith(k + "/")) for k in KINDS}
    print(f"share pages: {len(files)} ({', '.join(f'{v} {k}' for k, v in counts.items())}); "
          f"{len(changed)} written, {len(stale)} removed")


if __name__ == "__main__":
    main()
