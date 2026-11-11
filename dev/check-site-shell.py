#!/usr/bin/env python3
"""Checks dev/site-shell.py on a small made-up site in a temporary folder.

A page without markers gets them, its menu link and menu marked, the search script and its breadcrumbs
(group, trail, item stand-in; none on a page with crumbs false) in place of its "Hunsterverse · X" kicker or
its old breadcrumbs; a second run changes nothing; a hand-edited nav, a page missing from pages.json and a
wrong group are reported.

Usage: python3 dev/check-site-shell.py   (exit code 0 = all good)
"""
import importlib.util
import json
import pathlib
import sys
import tempfile

sys.dont_write_bytecode = True  # no __pycache__ in the site
spec = importlib.util.spec_from_file_location("site_shell", pathlib.Path(__file__).resolve().parent / "site-shell.py")
shell = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shell)

NAV = """<a class="skip-link" href="#content">Skip to content</a>
<header class="site-nav">
  <nav id="site-menu" aria-label="Main">
    <div class="nav-group">
      <button type="button" class="navlink nav-group-toggle" aria-expanded="false" aria-controls="nav-a">A</button>
      <div class="nav-menu" id="nav-a">
        <a class="navlink" href="/a.html">All of A</a>
        <a class="navlink" href="/one.html">One</a>
      </div>
    </div>
    <a class="navlink" href="/two.html">Two</a>
  </nav>
</header>
"""
FOOTER = '<footer class="site-foot"><a href="/privacy.html">Privacy</a></footer>\n'
PAGE = """<!DOCTYPE html>
<html>
  <head><title>{title}</title></head>
  <body>
    <a class="skip-link" href="#content">Skip</a>
    <header class="site-nav">old nav</header>

    <main id="content">
      <p class="kicker">Hunsterverse · Old</p>
      <h1>{title}</h1>
    </main>

    <footer class="site-foot">old footer</footer>
    <script src="/js/{title}.js"></script>
  </body>
</html>
"""
PAGES = [
    {"page": "one.html", "group": "A", "label": "One", "title": "one", "current": "/one.html"},
    {"page": "two.html", "group": None, "label": "Two", "title": "two", "current": "/two.html"},
    {"page": "sub.html", "group": "A", "label": "Sub", "title": "sub", "current": "/one.html",
     "trail": [["One", "/one.html"]], "item": True},
    {"page": "home.html", "group": None, "label": "Home", "title": "home", "current": None, "crumbs": False},
    {"page": "old.html", "group": "A", "label": "It's old", "title": "old", "current": "/one.html"},
    {"page": "a.html", "group": "A", "label": "A", "title": "a", "current": "/a.html"},
]
OLD_CRUMBS = '<nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li>hand-made</li></ol></nav>\n'
INLINE = '<main id="content">inline</main>'


failures = []


def expect(what, ok):
    if not ok:
        failures.append(what)


with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    (root / "dev/shell").mkdir(parents=True)
    (root / "dev/shell/nav.html").write_text(NAV)
    (root / "dev/shell/footer.html").write_text(FOOTER)
    (root / "dev/shell/pages.json").write_text(json.dumps(PAGES))
    for entry in PAGES:
        (root / entry["page"]).write_text(PAGE.format(title=entry["title"]))
    old = (root / "old.html").read_text()
    (root / "old.html").write_text(old.replace("    <main", OLD_CRUMBS + "    <main", 1))
    two = (root / "two.html").read_text()
    (root / "two.html").write_text(two[:two.index("<main")] + INLINE + two[two.index("</main>") + 7:])

    expect("check mode lists the unmarked pages", len(shell.problems(root)) == len(PAGES))
    expect("first run has no errors", shell.problems(root, write=True) == [])
    sub = (root / "sub.html").read_text()
    expect("first run leaves nothing out of sync", shell.problems(root) == [])
    expect("old nav and footer are gone", "old nav" not in sub and "old footer" not in sub)
    expect("page's own head, main and script are kept",
           "<title>sub</title>" in sub and "<h1>sub</h1>" in sub and "/js/sub.js" in sub)
    expect("sub page marks the One link", 'href="/one.html" aria-current="page">One' in sub)
    expect("sub page marks menu A", "nav-group-toggle is-current" in sub)
    expect("search script added once", sub.count("/js/search.js") == 1)
    expect("sub page has Home > A (linking its hub, a.html) > One > its item stand-in",
           '<ol><li><a href="/">Home</a></li><li><a href="/a.html">A</a></li><li><a href="/one.html">One</a></li>'
           '<li aria-current="page" data-crumb-item>Sub</li></ol>' in sub)
    hub = (root / "a.html").read_text()
    expect("the hub page has Home > A, no group crumb of its own",
           '<ol><li><a href="/">Home</a></li><li aria-current="page">A</li></ol>' in hub)
    expect("breadcrumbs open the main, the kicker is gone",
           sub.index('<main id="content">') < sub.index("site-shell:crumbs") < sub.index("breadcrumbs")
           < sub.index("/site-shell:crumbs") < sub.index("<h1>") and "kicker" not in sub)
    home = (root / "home.html").read_text()
    expect("crumbs false: no breadcrumbs, kicker still removed", "breadcrumbs" not in home and "kicker" not in home)
    old = (root / "old.html").read_text()
    expect("old breadcrumbs replaced in place, label escaped",
           "hand-made" not in old and old.count('class="breadcrumbs"') == 1
           and old.index("breadcrumbs") < old.index("<main") and "It&#x27;s old</li>" in old)
    two = (root / "two.html").read_text()
    expect("top-level page marks its link and no menu",
           'href="/two.html" aria-current="page"' in two and "is-current" not in two)
    expect("top-level page: Home > page, inline main content kept",
           '<li><a href="/">Home</a></li><li aria-current="page">Two</li>' in two and "inline</main>" in two)
    expect("header markers wrap the shell", sub.index("site-shell:header") < sub.index("skip-link") < sub.index("/site-shell:header"))

    before = {p.name: p.read_text() for p in root.glob("*.html")}
    shell.problems(root, write=True)
    expect("second run changes nothing", before == {p.name: p.read_text() for p in root.glob("*.html")})

    (root / "one.html").write_text(before["one.html"].replace(">One</a>", ">Uno</a>"))
    expect("hand-edited nav is reported", any("one.html: out of sync" in p for p in shell.problems(root)))
    (root / "one.html").write_text(before["one.html"])

    (root / "new.html").write_text(PAGE.format(title="new"))
    expect("page missing from pages.json is reported", any("new.html: not in" in p for p in shell.problems(root)))
    (root / "new.html").unlink()

    (root / "dev/shell/pages.json").write_text(json.dumps([dict(PAGES[0], group=None)] + PAGES[1:]))
    expect("wrong group is reported", any("one.html: group" in p for p in shell.problems(root)))

for line in failures:
    print("FAIL", line)
print(f"{len(failures)} failure(s)" if failures else "site shell generator OK")
sys.exit(1 if failures else 0)
