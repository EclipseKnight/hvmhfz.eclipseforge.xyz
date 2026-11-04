#!/usr/bin/env python3
"""Checks that every page shares the same site shell.

Each page carries a copy of the skip link, header nav and footer, written by dev/site-shell.py from
dev/shell/ (nav.html, footer.html, pages.json). For every *.html page in the site root it checks:
  - the page is in dev/shell/pages.json, and its shell is exactly what dev/site-shell.py would write
    (same nav, the right link marked aria-current, same footer); every Frontier guide page marks the
    "Frontier guide" link;
  - the page has the skip link, a main#content, styles.css, nav.js, background.js, consent.js and search.js;
  - the footer links the privacy policy;
  - every local href/src points at a file that exists, and so does every picture in js/background.js;
  - every { in css/*.css is closed;
  - everything dev/check-nav.py checks (pages reachable from home, breadcrumbs, search, titles, sitemap,
    and every internal link through dev/check-links.py).

Usage: python3 dev/check-site.py   (exit code 0 = all good, 1 = problems, listed)
"""
import importlib.util
import pathlib
import re
import sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent

# The shell itself (skip link, header nav, footer) comes from dev/shell/ and is written into the
# pages by dev/site-shell.py; this checks that every page is in sync with it.
sys.dont_write_bytecode = True  # no __pycache__ in the site
spec = importlib.util.spec_from_file_location("site_shell", ROOT / "dev" / "site-shell.py")
site_shell = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site_shell)


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []          # open tags: (tag, attrs)
        self.footer = []         # footer markup, as a list of tokens
        self.local_refs = []
        self.ids = set()
        self.classes = set()
        self.scripts = []
        self.stylesheets = []

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
        if tag not in ("img", "meta", "link", "br", "input", "hr"):
            self.stack.append((tag, attrs))

    def handle_endtag(self, tag):
        if self._inside("footer", "site-foot"):
            self.footer.append(("end", tag))
        # Void tags written as <img /> also arrive here; only close tags that are open.
        if any(open_tag == tag for open_tag, _ in self.stack):
            while self.stack and self.stack.pop()[0] != tag:
                pass

    def handle_data(self, data):
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

        footers[name] = page.footer
        if "skip-link" not in page.classes:
            problems.append(f"{name}: no skip link")
        if "content" not in page.ids:
            problems.append(f"{name}: no element with id=content for the skip link")
        if "/css/styles.css" not in page.stylesheets:
            problems.append(f"{name}: does not load /css/styles.css")
        for script in ("/js/nav.js", "/js/background.js", "/js/consent.js", "/js/search.js"):
            if script not in page.scripts:
                problems.append(f"{name}: does not load {script}")
        for ref in page.local_refs:
            target = ref.split("#")[0].split("?")[0]
            if target in ("", "/"):
                continue
            if not (root / target.lstrip("/")).is_file():
                problems.append(f"{name}: {ref} does not exist")

    for name, footer in footers.items():
        if not footer:
            problems.append(f"{name}: no footer.site-foot")
    if 'href="/privacy.html"' not in (root / "dev/shell/footer.html").read_text(encoding="utf-8"):
        problems.append("dev/shell/footer.html: no link to /privacy.html")
    shell = site_shell.load(root)
    for name, entry in shell["pages"].items():
        # Every Frontier handbook page sits under the handbook's one nav link.
        if name.startswith("guide-frontier") and entry.get("current") != "/guide-frontier.html":
            problems.append(f"dev/shell/pages.json: {name} should mark /guide-frontier.html as current")
    problems += site_shell.problems(root, write=False)

    # The background pictures: the quoted names in the IMAGES list of js/background.js.
    listed = re.search(r"var IMAGES = \[(.*?)\];", (root / "js/background.js").read_text(encoding="utf-8"), re.S)
    if not listed:
        problems.append("js/background.js: no IMAGES list")
    else:
        for picture in re.findall(r'"([^"]+)"', listed.group(1)):
            if not (root / "assets/backgrounds" / picture).is_file():
                problems.append(f"js/background.js: assets/backgrounds/{picture} does not exist")

    # Two function declarations with one name in a script: the later one silently replaces the
    # earlier everywhere in that scope (hoisting), which broke the admin Gifts tab once.
    for script in sorted((root / "js").glob("*.js")):
        seen = {}
        for number, line in enumerate(script.read_text(encoding="utf-8").splitlines(), 1):
            if line.startswith("(function"):
                seen = {}  # a new top-level wrapper is its own scope
            m = re.match(r"(\s*)function (\w+)\s*\(", line)
            if not m:
                continue
            key = (len(m.group(1)), m.group(2))
            if key in seen:
                problems.append(f"js/{script.name}:{number}: function {m.group(2)} is declared again "
                                f"(first at line {seen[key]}); the later one replaces the earlier")
            else:
                seen[key] = number

    # Every { closed in each stylesheet: one missing } once put every later rule (the VS bracket,
    # the admin Notices tab) inside the Play page's phone-only @media block.
    for sheet in sorted((root / "css").glob("*.css")):
        text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"),  # keep line numbers
                      sheet.read_text(encoding="utf-8"), flags=re.S)
        depth, opened = 0, None
        for number, line in enumerate(text.splitlines(), 1):
            for ch in line:
                if ch == "{":
                    if depth == 0:
                        opened = number
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth < 0:
                        problems.append(f"css/{sheet.name}:{number}: a }} with no {{")
                        depth = 0
        if depth:
            problems.append(f"css/{sheet.name}: the block opened near line {opened} is never closed")
    return problems


if __name__ == "__main__":
    found = check(ROOT)
    # Navigation: every page in pages.json, at most 2 clicks from home, breadcrumbs, search, titles,
    # sitemap and every internal link (dev/check-nav.py, which runs dev/check-links.py).
    spec = importlib.util.spec_from_file_location("check_nav", ROOT / "dev" / "check-nav.py")
    check_nav = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(check_nav)
    found += check_nav.problems()
    for line in found:
        print(line)
    print(f"{len(found)} problem(s)" if found else "site shell OK")
    sys.exit(1 if found else 0)
