#!/usr/bin/env python3
"""Checks that every page shares the same site shell.

The site has no templates: each page carries its own copy of the nav and footer.
This script keeps those copies in step. For every *.html page in the site root it checks:
  - the header nav has the same links, in the same order, as NAV below;
  - at most one nav link is marked aria-current, and it is the one the page should mark;
  - the footer is identical on every page;
  - the page has the skip link, a main#content, styles.css and nav.js;
  - every local href/src points at a file that exists.

Usage: python3 dev/check-site.py   (exit code 0 = all good, 1 = problems, listed)
"""
import pathlib
import sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent

# The one nav, in order. Change it here and on every page together.
NAV = [
    ("/monsters.html", "Monsters"),
    ("/events.html", "Events"),
    ("/guilds.html", "Guilds"),
    ("/hunters.html", "Hunters"),
    ("/catalog.html", "Catalog"),
    ("/worlds.html", "Worlds"),
    ("/guide-windows.html", "Guides"),
    ("/report.html", "Report"),
    ("/account.html", "Account"),
    ("https://discord.gg/YuE42eh", "Discord"),
]
# Which nav link a page marks as current. Pages not listed mark their own link; None marks nothing.
CURRENT = {
    "index.html": None,
    "404.html": None,
    # One monster's page sits under the Monsters guide.
    "monster.html": "/monsters.html",
    "guide-windows.html": "/guide-windows.html",
    "guide-linux.html": "/guide-windows.html",
    # The changelog is not in the nav; the footer links it.
    "changelog.html": None,
    # The set builder is a gear tool, linked from the Catalog page.
    "set-builder.html": "/catalog.html",
}


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []          # open tags: (tag, attrs)
        self.nav_links = []      # (href, text, aria-current)
        self.footer = []         # footer markup, as a list of tokens
        self.local_refs = []
        self.ids = set()
        self.classes = set()
        self.scripts = []
        self.stylesheets = []
        self._link = None

    def _inside(self, tag, cls=None):
        return any(t == tag and (cls is None or cls in (a.get("class") or "").split()) for t, a in self.stack)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        self.classes.update((attrs.get("class") or "").split())
        for key in ("href", "src"):
            value = attrs.get(key)
            if value and value.startswith("/"):
                self.local_refs.append(value)
        if tag == "script" and attrs.get("src"):
            self.scripts.append(attrs["src"])
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.stylesheets.append(attrs.get("href"))
        if self._inside("footer", "site-foot"):
            self.footer.append(("start", tag, tuple(sorted(attrs.items()))))
        if tag == "a" and self._inside("header", "site-nav") and self._inside("nav"):
            self._link = [attrs.get("href"), "", attrs.get("aria-current")]
        if tag not in ("img", "meta", "link", "br", "input", "hr"):
            self.stack.append((tag, attrs))

    def handle_endtag(self, tag):
        if tag == "a" and self._link is not None:
            self.nav_links.append((self._link[0], self._link[1].strip(), self._link[2]))
            self._link = None
        if self._inside("footer", "site-foot"):
            self.footer.append(("end", tag))
        # Void tags written as <img /> also arrive here; only close tags that are open.
        if any(open_tag == tag for open_tag, _ in self.stack):
            while self.stack and self.stack.pop()[0] != tag:
                pass

    def handle_data(self, data):
        if self._link is not None:
            self._link[1] += data
        if self._inside("footer", "site-foot") and data.strip():
            self.footer.append(("text", " ".join(data.split())))


def check(root):
    problems = []
    pages = sorted(root.glob("*.html"))
    if not pages:
        return ["no pages found in " + str(root)]
    footers = {}
    for path in pages:
        name = path.name
        page = PageParser()
        page.feed(path.read_text(encoding="utf-8"))

        links = [(href, text) for href, text, _ in page.nav_links]
        if links != NAV:
            problems.append(f"{name}: nav links differ from NAV: {links}")
        current = [href for href, _, cur in page.nav_links if cur == "page"]
        expected = CURRENT.get(name, "/" + name)
        if current != ([expected] if expected else []):
            problems.append(f"{name}: aria-current on {current or 'nothing'}, expected {expected or 'nothing'}")

        footers[name] = page.footer
        if "skip-link" not in page.classes:
            problems.append(f"{name}: no skip link")
        if "content" not in page.ids:
            problems.append(f"{name}: no element with id=content for the skip link")
        if "/css/styles.css" not in page.stylesheets:
            problems.append(f"{name}: does not load /css/styles.css")
        if "/js/nav.js" not in page.scripts:
            problems.append(f"{name}: does not load /js/nav.js")
        for ref in page.local_refs:
            target = ref.split("#")[0].split("?")[0]
            if target in ("", "/"):
                continue
            if not (root / target.lstrip("/")).is_file():
                problems.append(f"{name}: {ref} does not exist")

    first = pages[0].name
    for name, footer in footers.items():
        if not footer:
            problems.append(f"{name}: no footer.site-foot")
        elif footer != footers[first]:
            problems.append(f"{name}: footer differs from {first}")
    return problems


if __name__ == "__main__":
    found = check(ROOT)
    for line in found:
        print(line)
    print(f"{len(found)} problem(s)" if found else "site shell OK")
    sys.exit(1 if found else 0)
