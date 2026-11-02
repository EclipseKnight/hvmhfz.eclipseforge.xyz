#!/usr/bin/env python3
"""Checks every local link and picture on the site.

For every *.html page in the site root, every href, src and srcset that points inside the site (root-relative
"/x", relative "x", or "#id") must name a file that exists, and a "#id" must be an id (or <a name>) on the
target page. url(...) in css/*.css is checked the same way. External links (http, https, mailto, ...) are
not fetched.

Pages whose own script reads location.hash (tabs and boards picked by "#name", e.g. account.html,
leaderboards.html) handle their fragments in the browser: those fragments are counted, not checked.

Usage: python3 dev/check-links.py [page.html ...]   (no pages = the whole site)
Exit code 0 = no broken links, 1 = problems, listed one per line.
"""
import pathlib
import re
import sys
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.refs = []  # (line, attribute, value)
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.ids.add(a["id"])
        if tag == "a" and a.get("name"):
            self.ids.add(a["name"])
        if tag == "script" and a.get("src"):
            self.scripts.append(a["src"])
        line = self.getpos()[0]
        for key in ("href", "src"):
            if a.get(key):
                self.refs.append((line, key, a[key].strip()))
        if a.get("srcset"):
            for part in a["srcset"].split(","):
                if part.strip():
                    self.refs.append((line, "srcset", part.split()[0]))
        # <meta http-equiv="refresh" content="0; url=/x"> moves the reader on: check its target too
        if tag == "meta" and (a.get("http-equiv") or "").lower() == "refresh":
            m = re.search(r"url=(\S+)", a.get("content") or "", re.I)
            if m:
                self.refs.append((line, "refresh", m.group(1)))


_pages = {}
# search.js is on every page and reads the hash for itself only, so it doesn't make a page hash-routed.
SHARED_SCRIPTS = {"/js/search.js"}


def hash_routed(page):
    for src in page.scripts:
        src = src.split("?")[0]  # cache-busters like ?v=2
        script = ROOT / src.lstrip("/")
        if src not in SHARED_SCRIPTS and script.is_file() and re.search(
                r"location\.hash|hashchange", script.read_text(encoding="utf-8")):
            return True
    return False


def parse(path):
    if path not in _pages:
        page = Page()
        page.feed(path.read_text(encoding="utf-8"))
        _pages[path] = page
    return _pages[path]


def resolve(base, value):
    """The file a local reference points at, and its fragment; None for external references."""
    parts = urlsplit(value)
    if parts.scheme or parts.netloc or value.startswith(("data:", "javascript:")):
        return None
    path = unquote(parts.path)
    if not path:
        target = base
    elif path.startswith("/"):
        target = ROOT / path.lstrip("/")
    else:
        target = base.parent / path
    if target.is_dir():
        target = target / "index.html"
    return target, unquote(parts.fragment)


def check_page(path, skipped):
    problems = []
    page = parse(path)
    name = path.relative_to(ROOT)
    for line, key, value in page.refs:
        hit = resolve(path, value)
        if hit is None:
            continue
        target, fragment = hit
        if not target.is_file():
            problems.append(f"{name}:{line}: {key} {value} -> missing file")
            continue
        if fragment and target.suffix == ".html" and fragment not in parse(target).ids:
            if hash_routed(parse(target)):
                skipped.append(value)
                continue
            problems.append(f"{name}:{line}: {key} {value} -> no id {fragment!r} on {target.relative_to(ROOT)}")
    return problems


def check_css(path):
    problems = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        for value in re.findall(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", line):
            hit = resolve(path, value)
            if hit and not hit[0].is_file():
                problems.append(f"{path.relative_to(ROOT)}:{number}: url({value}) -> missing file")
    return problems


def main(args):
    pages = [ROOT / a for a in args] if args else sorted(ROOT.glob("*.html"))
    problems, skipped = [], []
    for page in pages:
        problems += check_page(page, skipped)
    if not args:
        for css in sorted((ROOT / "css").glob("*.css")):
            problems += check_css(css)
    for p in problems:
        print(p)
    print(f"{len(pages)} page(s) checked, " + (f"{len(problems)} broken link(s)" if problems else "no broken links")
          + f" ({len(skipped)} fragment(s) left to page scripts)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
