#!/usr/bin/env python3
"""Checks dev/site-shell.py on a small made-up site in a temporary folder.

A page without markers gets them, its menu link and menu marked, and the search script; a second run
changes nothing; a hand-edited nav, a page missing from pages.json and a wrong group are reported.

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

    <main id="content">{title}</main>

    <footer class="site-foot">old footer</footer>
    <script src="/js/{title}.js"></script>
  </body>
</html>
"""
PAGES = [
    {"page": "one.html", "group": "A", "label": "One", "title": "one", "current": "/one.html"},
    {"page": "two.html", "group": None, "label": "Two", "title": "two", "current": "/two.html"},
    {"page": "sub.html", "group": "A", "label": "Sub", "title": "sub", "current": "/one.html"},
]

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

    expect("check mode lists the unmarked pages", len(shell.problems(root)) == 3)
    expect("first run has no errors", shell.problems(root, write=True) == [])
    sub = (root / "sub.html").read_text()
    expect("first run leaves nothing out of sync", shell.problems(root) == [])
    expect("old nav and footer are gone", "old nav" not in sub and "old footer" not in sub)
    expect("page's own head, main and script are kept",
           "<title>sub</title>" in sub and '<main id="content">sub</main>' in sub and "/js/sub.js" in sub)
    expect("sub page marks the One link", 'href="/one.html" aria-current="page">One' in sub)
    expect("sub page marks menu A", "nav-group-toggle is-current" in sub)
    expect("search script added once", sub.count("/js/search.js") == 1)
    two = (root / "two.html").read_text()
    expect("top-level page marks its link and no menu",
           'href="/two.html" aria-current="page"' in two and "is-current" not in two)
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
