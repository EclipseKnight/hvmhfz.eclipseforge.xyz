#!/usr/bin/env python3
"""Check the link previews (what Discord, X and others show when someone pastes a link to the site).

They read the page's HTML without running scripts, so only the static tags count. For every page in the
site root and every share page under s/ (dev/make-share-pages.py):
  - a <title>, a meta description, og:title, og:description (each under 300 characters), og:site_name;
  - og:url: the page's own address on https://frontier.hunsterverse.net;
  - og:image: a picture on the site that exists, 1200x630 for twitter:card summary_large_image (and
    og:image:width/height saying so), square and at least 144 px for summary;
  - twitter:card and theme-color set;
  - a public page has a picture of its own, not the plain brand card (GENERIC_OK lists the exceptions);
  - a share page sends people to a page and a thing that exist (monster, quest, item, weapon type,
    skill, changelog day), and s/ is what dev/make-share-pages.py writes now.
Hunters, guilds and leaderboards are API data: their pages here keep the page's card, and their share links
are served by the API (https://api.hvmhfz.eclipseforge.xyz/share/hunter/<id>, /share/guild/<id>,
/share/leaderboard/<board>[/<option>]; the API README's "Share links", tested by its ShareEndpointTests),
so this script does not check them; dev/check-share.js checks that Copy link copies them.

    python3 dev/check-embeds.py           the checks above
    python3 dev/check-embeds.py --serve   also serves the site locally and fetches a sample of links the way
                                          Discord does (Discordbot user agent, no scripts), then prints what
                                          each preview shows
Exit code 0 = all good, 1 = problems, listed one per line.
"""
import functools
import http.server
import importlib
import json
import pathlib
import re
import sys
import threading
import urllib.request
from html.parser import HTMLParser

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = "https://frontier.hunsterverse.net"
GENERIC = "/assets/og/hunsterverse.png"
# Pages nobody shares for their content (sign-in, admin, error, legal): the brand card is right for them.
GENERIC_OK = {"404.html", "account.html", "admin.html", "privacy.html", "bot-terms.html"}
DISCORD_UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"


class Head(HTMLParser):
    """The <title> and <meta>/<link> tags before </head>."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta, self.title, self.refresh, self.canonical = {}, None, None, None
        self._in_title, self._done = False, False

    def handle_starttag(self, tag, attrs):
        if self._done:
            return
        a = dict(attrs)
        if tag == "title":
            self._in_title, self.title = True, ""
        elif tag == "meta":
            key = a.get("property") or a.get("name")
            if key:
                self.meta.setdefault(key, a.get("content") or "")
            if (a.get("http-equiv") or "").lower() == "refresh":
                self.refresh = a.get("content") or ""
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")

    def handle_data(self, data):
        if self._in_title:
            self.title += data

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self._done = True


def parse(text):
    head = Head()
    head.feed(text)
    return head


@functools.lru_cache(maxsize=None)
def image_size(rel):
    path = ROOT / rel.lstrip("/")
    if not path.is_file():
        return None
    with Image.open(path) as img:
        return img.size


def check_tags(rel, head, problems):
    """The checks every page shares. rel: the page's path from the site root, e.g. "s/quest/1.html"."""
    say = lambda msg: problems.append(f"{rel}: {msg}")
    if not (head.title or "").strip():
        say("no <title>")
    for key in ("description", "og:title", "og:description", "og:site_name", "og:url", "og:image",
                "twitter:card", "theme-color"):
        if not head.meta.get(key, "").strip():
            say(f"no {key}")
    for key in ("description", "og:description", "og:title"):
        if len(head.meta.get(key, "")) > 300:
            say(f"{key} longer than 300 characters")
    url = head.meta.get("og:url", "")
    own = BASE + "/" + ("" if rel == "index.html" else rel)
    if url and url != own:
        say(f"og:url is {url}, not {own}")
    image = head.meta.get("og:image", "")
    if image and not image.startswith(BASE + "/"):
        say(f"og:image {image} is not on {BASE}")
        return
    if not image:
        return
    if head.meta.get("twitter:image") and head.meta["twitter:image"] != image:
        say("twitter:image differs from og:image")
    local = image[len(BASE):]
    size = image_size(local)
    if size is None:
        say(f"og:image {local} does not exist")
        return
    card = head.meta.get("twitter:card")
    if card == "summary_large_image":
        if size != (1200, 630):
            say(f"og:image {local} is {size[0]}x{size[1]}, not 1200x630")
        if (head.meta.get("og:image:width"), head.meta.get("og:image:height")) != ("1200", "630"):
            say("og:image:width/height do not say 1200x630")
    elif card == "summary":
        if size[0] != size[1] or size[0] < 144:
            say(f"og:image {local} is {size[0]}x{size[1]}, not a square of 144 px or more")
    elif card:
        say(f"twitter:card {card} is not summary or summary_large_image")


def check_root_pages(problems):
    pages = sorted(ROOT.glob("*.html"))
    for path in pages:
        head = parse(path.read_text())
        check_tags(path.name, head, problems)
        if head.meta.get("og:image") == BASE + GENERIC and path.name not in GENERIC_OK:
            problems.append(f"{path.name}: previews with the plain brand card; give it its own (dev/make-og.py, dev/set-og.py)")
    return len(pages)


def share_target_exists(kind, key, target):
    """Whether the real page a share page opens shows something."""
    if kind == "monster":
        return target == f"/monster.html?m={key}" and (ROOT / "data" / "monsters" / f"{key}.json").is_file()
    if kind == "quest":
        return target == f"/quest.html?id={key}" and int(key) in share_target_exists.quests
    if kind == "item":
        return target == f"/item.html?id={key}" and (ROOT / "data" / "items" / f"{key}.json").is_file()
    if kind == "weapon":
        return target == f"/weapons.html?type={key}" and (ROOT / "data" / "weapons" / f"{key}.json").is_file()
    if kind == "skill":
        return target == f"/skill.html?id={key}" and (ROOT / "data" / "skills" / f"{key}.json").is_file()
    if kind == "changelog":
        return target == f"/changelog.html#d-{key}" and f'id="d-{key}"' in share_target_exists.changelog
    return False


def check_share_pages(problems):
    share_target_exists.quests = {q["id"] for q in json.loads((ROOT / "data" / "quests.json").read_text())["quests"]}
    share_target_exists.changelog = (ROOT / "changelog.html").read_text()
    count = 0
    for path in sorted((ROOT / "s").glob("*/*.html")):
        count += 1
        rel = str(path.relative_to(ROOT))
        head = parse(path.read_text())
        check_tags(rel, head, problems)
        m = re.fullmatch(r"0; url=(.+)", head.refresh or "")
        target = m.group(1).replace("&amp;", "&") if m else None
        if not target or head.canonical != BASE + target:
            problems.append(f"{rel}: the meta refresh and canonical link do not name the same page")
        elif not share_target_exists(path.parent.name, path.stem, target):
            problems.append(f"{rel}: opens {target}, which does not show that {path.parent.name}")
    # s/ must be what the generator writes now (the data or the changelog may have changed since)
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(ROOT / "dev"))
    made = importlib.import_module("make-share-pages").build()
    on_disk = {str(p.relative_to(ROOT / "s")) for p in (ROOT / "s").glob("*/*.html")}
    for rel in sorted(set(made) ^ on_disk):
        problems.append(f"s/{rel}: {'missing' if rel in made else 'no longer made'}: run python3 dev/make-share-pages.py")
    for rel in sorted(set(made) & on_disk):
        if (ROOT / "s" / rel).read_text() != made[rel]:
            problems.append(f"s/{rel}: out of date: run python3 dev/make-share-pages.py")
    return count


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def fetch(url, ua=DISCORD_UA):
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def serve_and_fetch(problems):
    """Fetch a sample of links as Discord's crawler does (its user agent, HTML only) and show the preview."""
    newest = re.search(r'id="d-(\d{4}-\d\d-\d\d)"', (ROOT / "changelog.html").read_text()).group(1)
    first_quest = json.loads((ROOT / "data" / "quests.json").read_text())["quests"][0]["id"]
    first_item = min(int(p.stem) for p in (ROOT / "data" / "items").glob("*.json") if p.stem.isdigit())
    sample = ["/", "/play.html", "/guide-frontier-zenith.html", "/weapons.html", "/monster.html?m=akantor",
              "/s/monster/akantor.html", f"/s/quest/{first_quest}.html", f"/s/item/{first_item}.html",
              "/s/weapon/lance.html?w=812", f"/s/changelog/{newest}.html#d-{newest}",
              # API data: the page's own card here; the preview of one hunter is the API's /share/hunter/<id>
              "/hunters.html?id=1"]
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    local = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        for path in sample:
            status, ctype, body = fetch(local + path.split("#")[0])
            if status != 200 or "html" not in ctype:
                problems.append(f"{path}: answered {status} {ctype}")
                continue
            head = parse(body.decode("utf-8"))
            image = head.meta.get("og:image", "")
            istatus, itype, ibody = fetch(local + image[len(BASE):]) if image.startswith(BASE) else (0, "", b"")
            if istatus != 200 or not itype.startswith("image/"):
                problems.append(f"{path}: its og:image {image} answered {istatus} {itype}")
            print(f"\n{path}\n  [{head.meta.get('og:site_name')}] {head.meta.get('og:title')}"
                  f"\n  {head.meta.get('og:description')}"
                  f"\n  picture: {image[len(BASE):]} ({head.meta.get('twitter:card')}, {len(ibody) // 1024} KB)")
    finally:
        server.shutdown()


def main():
    problems = []
    pages = check_root_pages(problems)
    shares = check_share_pages(problems)
    if "--serve" in sys.argv[1:]:
        serve_and_fetch(problems)
    for line in problems:
        print(line)
    print(f"\n{pages} pages and {shares} share pages checked: " + ("embeds OK" if not problems else f"{len(problems)} problems"))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
