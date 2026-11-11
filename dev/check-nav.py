#!/usr/bin/env python3
"""Checks that every page can be found and reads the same way.

For every *.html page in the site root:
  - it is in dev/shell/pages.json;
  - its <title> reads "Page · Hunsterverse" (guide sections: "Section · Frontier guide · Hunsterverse"),
    and so does every document.title a script in js/ sets;
  - it has exactly one <h1> in its own HTML (detail pages too: their script may hide it for its own);
  - it has the breadcrumbs (<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>), except where pages.json
    says "crumbs": false (the home page), and loads the site search (/js/search.js);
  - it is at most 2 clicks from the home page, following the links in the pages' own HTML (the menu and
    footer count, as they are on every page). A detail page (pages.json "item": true) counts as one click
    past its list page (the last crumb of its trail), whose script links each item. Not checked: the
    pages in UNLISTED below and forwarding notices (<meta http-equiv="refresh">);
  - sitemap.xml lists every page without noindex, except detail pages, and lists monster.html?m= for
    exactly the monsters of data/monsters/index.json, by their current slugs.
Then it runs dev/check-links.py over the whole site (local links, anchors, query parameters, sitemap).

Usage: python3 dev/check-nav.py              (exit code 0 = all good, 1 = problems, listed)
       python3 dev/check-nav.py --self-test  (checks this script on a small made-up site)
"""
import html
import importlib.util
import json
import pathlib
import re
import sys
import tempfile
from html.parser import HTMLParser
from urllib.parse import urlsplit

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://frontier.hunsterverse.net"
MAX_CLICKS = 2
TITLE = re.compile(r"^\S(.*\S)? · Hunsterverse$")
# Pages that are meant to be out of the way.
UNLISTED = {
    "404.html": "GitHub Pages shows it for a missing page",
    "admin.html": "admin accounts only; the account page links it for them",
}

sys.dont_write_bytecode = True  # no __pycache__ in the site


def load_module(name, file):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).resolve().parent / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.scripts = [], []
        self.title, self.in_title = "", False
        self.h1 = 0
        self.crumbs = False
        self.noindex = self.forwards = False
        self.stack = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"):
            self.links.append(a["href"].strip())
        if tag == "script" and a.get("src"):
            self.scripts.append(a["src"].split("?")[0])
        if tag == "title":
            self.in_title = True
        if tag == "h1":
            self.h1 += 1
        if tag == "meta" and (a.get("name") or "").lower() == "robots" and "noindex" in (a.get("content") or ""):
            self.noindex = True
        if tag == "meta" and (a.get("http-equiv") or "").lower() == "refresh":
            self.forwards = True
        if tag == "ol" and self.stack and self.stack[-1][0] == "nav":
            nav = self.stack[-1][1]
            if "breadcrumbs" in (nav.get("class") or "").split() and nav.get("aria-label") == "Breadcrumb":
                self.crumbs = True
        if tag not in ("img", "meta", "link", "br", "input", "hr", "source"):
            self.stack.append((tag, a))

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if any(t == tag for t, _ in self.stack):
            while self.stack and self.stack.pop()[0] != tag:
                pass

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def local_page(href):
    """The site-root page a link opens ('index.html' for '/'), or None for anything else."""
    parts = urlsplit(href)
    if parts.scheme or parts.netloc or href.startswith("#"):
        return None
    path = parts.path.lstrip("/")
    if path in ("", "index.html"):
        return "index.html"
    return path if path.endswith(".html") and "/" not in path else None


def problems(root=ROOT, links=True):
    found = []
    entries = {e["page"]: e for e in json.loads((root / "dev/shell/pages.json").read_text(encoding="utf-8"))}
    pages = {}
    for path in sorted(root.glob("*.html")):
        page = Page()
        page.feed(path.read_text(encoding="utf-8"))
        pages[path.name] = page

    for name, page in pages.items():
        entry = entries.get(name)
        if entry is None:
            found.append(f"{name}: not in dev/shell/pages.json")
            entry = {}
        title = " ".join(page.title.split())
        if not TITLE.match(title) or "|" in title or "MHFZ:" in title:
            found.append(f'{name}: title {title!r} does not read "Page · Hunsterverse"')
        if page.h1 != 1:
            found.append(f"{name}: {page.h1} <h1> headings in its HTML, not 1")
        if entry.get("crumbs") is not False and not page.crumbs:
            found.append(f'{name}: no breadcrumbs (<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>)')
        if "/js/search.js" not in page.scripts:
            found.append(f"{name}: does not load the site search (/js/search.js)")

    # Clicks from the home page, over the pages' own links.
    depth = {"index.html": 0}
    frontier = ["index.html"]
    while frontier:
        nxt = []
        for name in frontier:
            for href in pages[name].links if name in pages else []:
                target = local_page(href)
                if target in pages and target not in depth:
                    depth[target] = depth[name] + 1
                    nxt.append(target)
        frontier = nxt
    for name, entry in entries.items():  # a detail page: one click past its list page
        trail = entry.get("trail") or []
        if entry.get("item") and trail:
            parent = local_page(trail[-1][1])
            if parent in depth:
                depth[name] = min(depth.get(name, depth[parent] + 1), depth[parent] + 1)
    for name, page in pages.items():
        if name in UNLISTED or page.forwards:
            continue
        if name not in depth:
            found.append(f"{name}: no link to it from the home page or the pages it links")
        elif depth[name] > MAX_CLICKS:
            found.append(f"{name}: {depth[name]} clicks from the home page, more than {MAX_CLICKS}")

    # The sitemap: every indexable page, and every monster by its current slug.
    sitemap = (root / "sitemap.xml").read_text(encoding="utf-8")
    locs = re.findall(r"<loc>" + re.escape(SITE) + r"(/[^<]*)</loc>", sitemap)
    listed = {local_page(html.unescape(loc)) for loc in locs}
    for name, page in pages.items():
        if page.noindex or page.forwards or name in UNLISTED or entries.get(name, {}).get("item"):
            continue
        if name not in listed:
            found.append(f"sitemap.xml: {name} is missing")
    index = root / "data/monsters/index.json"
    if index.is_file() and "monster.html" in pages:
        slugs = {m["slug"] for m in json.loads(index.read_text(encoding="utf-8"))}
        in_map = {m for loc in locs for m in re.findall(r"^/monster\.html\?m=([^&#]+)$", html.unescape(loc))}
        for slug in sorted(in_map - slugs):
            found.append(f"sitemap.xml: monster.html?m={slug} is not a current monster slug (data/monsters/index.json)")
        for slug in sorted(slugs - in_map):
            found.append(f"sitemap.xml: monster.html?m={slug} is missing")

    # Titles set by scripts follow the same format.
    for script in sorted((root / "js").glob("*.js")) if (root / "js").is_dir() else []:
        for number, line in enumerate(script.read_text(encoding="utf-8").splitlines(), 1):
            m = re.search(r"document\.title\s*=\s*(.+?);", line)
            if m and not m.group(1).endswith(' · Hunsterverse"'):
                found.append(f'js/{script.name}:{number}: document.title {m.group(1)} does not end in " · Hunsterverse"')

    if links:
        check_links = load_module("check_links", "check-links.py")
        skipped = []
        for path in sorted(check_links.ROOT.glob("*.html")):
            found += check_links.check_page(path, skipped)
        for css in sorted((check_links.ROOT / "css").glob("*.css")):
            found += check_links.check_css(css)
        found += check_links.check_scripts()
        found += check_links.check_sitemap()
    return found


def self_test():
    """The checks on a made-up site: a good one passes, each broken page is reported."""
    def page(title, body, crumbs=True, search=True, head=""):
        nav = '<nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li></ol></nav>' if crumbs else ""
        script = '<script src="/js/search.js" defer></script>' if search else ""
        return (f"<!DOCTYPE html><html><head><title>{title}</title>{head}</head><body>"
                f'<a href="/a.html">A</a><main id="content">{nav}{body}</main>{script}</body></html>')

    good = {
        "index.html": page("Home · Hunsterverse", "<h1>Home</h1>", crumbs=False),
        "a.html": page("A · Hunsterverse", '<h1>A</h1><a href="/b.html">B</a>'),
        "b.html": page("B · Hunsterverse", "<h1>B</h1>"),
        "item.html": page("Item · Hunsterverse", "<h1>Item</h1>"),
        "old.html": page("Old · Hunsterverse", "<h1>Old</h1>", head='<meta http-equiv="refresh" content="0; url=/a.html" /><meta name="robots" content="noindex" />'),
    }
    entries = [{"page": "index.html", "crumbs": False}, {"page": "a.html"}, {"page": "b.html"},
               {"page": "item.html", "trail": [["A", "/a.html"]], "item": True}, {"page": "old.html"}]
    sitemap = "".join(f"<url><loc>{SITE}{p}</loc></url>" for p in ("/", "/a.html", "/b.html"))
    cases = [
        ("good site", {}, None, []),
        ("old title format", {"b.html": page("Hunsterverse MHFZ: B", "<h1>B</h1>")}, None,
         ["b.html: title 'Hunsterverse MHFZ: B' does not read \"Page · Hunsterverse\""]),
        ("no heading, crumbs or search", {"b.html": page("B · Hunsterverse", "", crumbs=False, search=False)}, None,
         ["b.html: 0 <h1> headings in its HTML, not 1",
          'b.html: no breadcrumbs (<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>)',
          "b.html: does not load the site search (/js/search.js)"]),
        ("three clicks away", {"b.html": page("B · Hunsterverse", '<h1>B</h1><a href="c.html">C</a>'),
                               "c.html": page("C · Hunsterverse", "<h1>C</h1>")}, None,
         ["c.html: not in dev/shell/pages.json", "c.html: 3 clicks from the home page, more than 2",
          "sitemap.xml: c.html is missing"]),
        ("unlinked page", {"a.html": page("A · Hunsterverse", "<h1>A</h1>")}, None,
         ["b.html: no link to it from the home page or the pages it links"]),
        ("missing from the sitemap", {}, sitemap.replace(f"<url><loc>{SITE}/b.html</loc></url>", ""),
         ["sitemap.xml: b.html is missing"]),
    ]
    failed = 0
    for label, change, map_text, expected in cases:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "dev/shell").mkdir(parents=True)
            (root / "dev/shell/pages.json").write_text(json.dumps(entries), encoding="utf-8")
            (root / "sitemap.xml").write_text(map_text if map_text is not None else sitemap, encoding="utf-8")
            for name, text in {**good, **change}.items():
                (root / name).write_text(text, encoding="utf-8")
            got = problems(root, links=False)
        if sorted(got) != sorted(expected):
            failed += 1
            print(f"FAIL {label}:\n  expected {sorted(expected)}\n  got      {sorted(got)}")
        else:
            print(f"ok   {label}")
    print(f"{len(cases) - failed}/{len(cases)} self-test cases passed")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    found = problems()
    for line in found:
        print(line)
    print(f"{len(found)} problem(s)" if found else "navigation OK")
    sys.exit(1 if found else 0)
