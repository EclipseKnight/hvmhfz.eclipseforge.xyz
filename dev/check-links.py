#!/usr/bin/env python3
"""Checks every local link and picture on the site.

For every *.html page in the site root, every href, src and srcset that points inside the site (root-relative
"/x", relative "x", or "#id") must name a file that exists, and a "#id" must be an id (or <a name>) on the
target page. url(...) in css/*.css is checked the same way. External links (http, https, mailto, ...) are
not fetched.

Pages whose own script reads location.hash (tabs and boards picked by "#name", e.g. account.html,
leaderboards.html) handle their fragments in the browser: those fragments are counted, not checked.

Detail links (a page with a query, e.g. /monster.html?m=akantor, /hunters.html?name=x) must use a
parameter the target page's own scripts read (URLSearchParams ... .get("m")): one they don't read lands
on the plain list page. Where the site holds the data, the value must exist too: monster.html?m= a slug,
oldSlug or formerSlugs of data/monsters/index.json (what js/monster.js opens), quest.html?id= a quest of
data/quests.json. The same is checked for links built in js/*.js ("/page.html?param=" strings) and for
sitemap.xml; a script that links a hunter or guild by ?name= must also link it by ?id= (the name is the
fallback for an API answer without the id); and every "/assets/", "/data/", "/js/" or "/css/" file a script names must exist.

Usage: python3 dev/check-links.py [page.html ...]   (no pages = the whole site, its scripts and the sitemap)
Exit code 0 = no broken links, 1 = problems, listed one per line.
"""
import json
import pathlib
import re
import sys
from html.parser import HTMLParser
from urllib.parse import parse_qsl, unquote, urlsplit

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


# Scripts on every page that read no query of the page's own (activity.js and report.js read ?api= only
# on localhost, a test hook, and it counts like any other read).
_params = {}
PARAM_READ = re.compile(r'(?:params|URLSearchParams\([^()]*\))\.get\(\s*"(\w+)"')


def params_read(target):
    """The query parameters a page's own scripts read."""
    if target not in _params:
        names = set()
        for src in parse(target).scripts:
            script = ROOT / src.split("?")[0].lstrip("/")
            if script.is_file() and script.suffix == ".js":
                names |= set(PARAM_READ.findall(script.read_text(encoding="utf-8")))
        _params[target] = names
    return _params[target]


_valid = {}


def valid_values():
    """Values the site's own data says exist, per (page, parameter)."""
    if not _valid:
        index = json.loads((ROOT / "data/monsters/index.json").read_text(encoding="utf-8"))
        forms = set()
        for m in index:
            forms |= {m["slug"], m.get("oldSlug")} | set(m.get("formerSlugs") or [])
        forms.discard(None)
        quests = json.loads((ROOT / "data/quests.json").read_text(encoding="utf-8"))["quests"]
        _valid[("monster.html", "m")] = forms
        _valid[("quest.html", "id")] = {str(q["id"]) for q in quests}
    return _valid


NUMERIC = {("hunters.html", "id"), ("guilds.html", "id")}  # API ids: checked for form only


def check_query(where, value, target, query):
    """Problems with the query of a link to a local page."""
    problems = []
    if not query or target.suffix != ".html":
        return problems
    page = target.name
    read = params_read(target)
    for key, val in parse_qsl(query, keep_blank_values=True):
        if key not in read:
            problems.append(f"{where}: {value} -> {page} does not read ?{key}= (it opens the plain page)")
            continue
        if not val:  # a link builder's prefix ("/quest.html?id=" + id): the key is what can be checked
            continue
        allowed = valid_values().get((page, key))
        if allowed is not None and val not in allowed:
            problems.append(f"{where}: {value} -> no {key}={val!r} in the site's data, {page} shows 'not found'")
        if (page, key) in NUMERIC and not val.isdigit():
            problems.append(f"{where}: {value} -> {key} must be a number")
    return problems


LINK_IN_JS = re.compile(r'["\'](/[\w-]+\.html)\?([^"\'#]*)["\']')
FILE_IN_JS = re.compile(r'["\'](/(?:assets|data|js|css)/[^"\'?#\s]*\.[a-z0-9]+)["\']', re.I)


# A script that links a hunter or guild by name (?name=) must also link it by id (?id=): the name is only
# the fallback for an API answer without the id, and a name shared by two hunters opens the list.
EXACT_FALLBACK = {"/hunters.html", "/guilds.html"}


def check_scripts():
    """Links built in the scripts: the page exists, it reads the parameter, and named files exist."""
    problems = []
    for script in sorted((ROOT / "js").glob("*.js")):
        name = script.relative_to(ROOT)
        text = script.read_text(encoding="utf-8")
        for page in sorted(EXACT_FALLBACK):
            if re.search(re.escape(page) + r"\?name=", text) and not re.search(re.escape(page) + r"\?id=", text):
                problems.append(f"{name}: links {page}?name= but never {page}?id= (use the id when the API sends it)")
        for number, line in enumerate(script.read_text(encoding="utf-8").splitlines(), 1):
            for path, query in LINK_IN_JS.findall(line):
                target = ROOT / path.lstrip("/")
                if not target.is_file():
                    problems.append(f"{name}:{number}: link {path} -> missing file")
                    continue
                problems += check_query(f"{name}:{number}", path + "?" + query, target, query)
            for path in FILE_IN_JS.findall(line):
                if not (ROOT / path.lstrip("/")).is_file():
                    problems.append(f"{name}:{number}: {path} -> missing file")
    return problems


def check_sitemap():
    problems = []
    sitemap = ROOT / "sitemap.xml"
    for number, line in enumerate(sitemap.read_text(encoding="utf-8").splitlines(), 1):
        for loc in re.findall(r"<loc>https://hvmhfz\.eclipseforge\.xyz(/[^<]*)</loc>", line):
            hit = resolve(sitemap, loc)
            if not hit[0].is_file():
                problems.append(f"sitemap.xml:{number}: {loc} -> missing file")
                continue
            if "noindex" in hit[0].read_text(encoding="utf-8"):
                problems.append(f"sitemap.xml:{number}: {loc} -> the page says noindex")
            problems += check_query(f"sitemap.xml:{number}", loc, hit[0], urlsplit(loc).query)
    return problems


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
        if key == "href":
            problems += check_query(f"{name}:{line}", value, target, urlsplit(value).query)
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
        problems += check_scripts()
        problems += check_sitemap()
    for p in problems:
        print(p)
    print(f"{len(pages)} page(s)" + ("" if args else ", the scripts and the sitemap") + " checked, " + (f"{len(problems)} broken link(s)" if problems else "no broken links")
          + f" ({len(skipped)} fragment(s) left to page scripts)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
