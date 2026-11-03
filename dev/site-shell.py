#!/usr/bin/env python3
"""Writes the site shell (skip link, header nav, breadcrumbs, footer) into every page.

The sources, in dev/shell/:
  - nav.html     the skip link and header nav, with no page marked as current;
  - footer.html  the footer;
  - pages.json   one entry per *.html page in the site root:
                 page (file name), group (the menu it sits under, or null), label (its short name),
                 title (its <title>, unescaped) and current (the nav link it marks, or null);
                 optional: trail (a list of [label, href] crumbs between the group and the page),
                 item (true: the last crumb is a stand-in the page's script replaces with the item's
                 name, see HvCrumbs in js/nav.js) and crumbs (false: no breadcrumbs, the home page).

Each page holds the shell between marker comments:
    <!-- site-shell:header ... -->  ...  <!-- /site-shell:header -->
    <!-- site-shell:footer ... -->  ...  <!-- /site-shell:footer -->
A page without markers gets them around its existing skip link + <header class="site-nav"> and
its <footer class="site-foot">. The breadcrumbs (Home › group › trail › page) go between
    <!-- site-shell:crumbs ... -->  ...  <!-- /site-shell:crumbs -->
replacing, on a page without those markers, its <nav class="breadcrumbs"> line, else written as the
first thing in its <main id="content">; the old "Hunsterverse · X" kicker line is removed. In the header, the page's `current` link gets aria-current="page"
and the button of the menu holding it the class is-current. A page that does not load
/js/search.js gets it before </body>. Everything else on the page (head, main, scripts) is kept.

Usage: python3 dev/site-shell.py          rewrites the pages that are out of date
       python3 dev/site-shell.py --check  lists them and exits 1, changes nothing
"""
import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHELL = ROOT / "dev" / "shell"
INDENT = "    "  # the shell sits directly in <body>
SEARCH = '<script src="/js/search.js" defer></script>'
MARKERS = {
    "header": ("<!-- site-shell:header: edit dev/shell/nav.html, then run python3 dev/site-shell.py -->",
               "<!-- /site-shell:header -->"),
    "footer": ("<!-- site-shell:footer: edit dev/shell/footer.html, then run python3 dev/site-shell.py -->",
               "<!-- /site-shell:footer -->"),
}
CRUMBS = ("<!-- site-shell:crumbs: from dev/shell/pages.json, run python3 dev/site-shell.py -->",
          "<!-- /site-shell:crumbs -->")
KICKER = re.compile(r'^[ \t]*<p class="kicker">Hunsterverse · [^<]*</p>[ \t]*\n', re.M)
# Where the shell sits on a page that has no markers yet.
UNMARKED = {
    "header": re.compile(r'^[ \t]*<a class="skip-link".*?</header>[ \t]*\n', re.S | re.M),
    "footer": re.compile(r'^[ \t]*<footer class="site-foot">.*?</footer>[ \t]*\n', re.S | re.M),
}


class ShellError(Exception):
    pass


def load(root=ROOT):
    shell = root / "dev" / "shell"
    pages = json.loads((shell / "pages.json").read_text(encoding="utf-8"))
    return {
        "nav": (shell / "nav.html").read_text(encoding="utf-8"),
        "footer": (shell / "footer.html").read_text(encoding="utf-8"),
        "pages": {entry["page"]: entry for entry in pages},
        "order": [entry["page"] for entry in pages],
    }


def indent(block):
    return "".join(INDENT + line if line.strip() else line for line in block.splitlines(True))


def nav_groups(nav):
    """Each nav link's href -> the label of the menu holding it (None for a top-level link)."""
    groups = {}
    group, depth = None, 0
    for line in nav.splitlines():
        if '<div class="nav-group">' in line:
            group, depth = "", 0
        if group is not None:
            depth += line.count("<div") - line.count("</div>")
            m = re.search(r'class="[^"]*\bnav-group-toggle\b[^"]*"[^>]*>([^<]+)</button>', line)
            if m:
                group = m.group(1).strip()
        for href in re.findall(r'<a class="navlink[^"]*" href="([^"]+)"', line):
            groups[href] = group or None
        if group is not None and depth <= 0:
            group = None
    return groups


def header_for(nav, entry):
    current = entry.get("current")
    if current is None:
        return nav
    lines = nav.splitlines(True)
    link = f'href="{current}">'
    hits = [i for i, line in enumerate(lines) if '<a class="navlink' in line and link in line]
    if len(hits) != 1:
        raise ShellError(f'{entry["page"]}: current {current} is {len(hits)} links in dev/shell/nav.html, not 1')
    at = hits[0]
    lines[at] = lines[at].replace(link, f'href="{current}" aria-current="page">', 1)
    group = nav_groups(nav).get(current)
    if group != entry.get("group"):
        raise ShellError(f'{entry["page"]}: group is {entry.get("group")!r} in pages.json, '
                         f'but {current} sits under {group!r} in nav.html')
    if group:
        # The toggle button of the menu holding the link: the last one above it.
        for i in range(at, -1, -1):
            if "nav-group-toggle" in lines[i]:
                lines[i] = lines[i].replace("nav-group-toggle", "nav-group-toggle is-current", 1)
                break
    return "".join(lines)


def put(text, name, part, block):
    start, end = MARKERS[part]
    wrapped = f"{INDENT}{start}\n{indent(block)}{INDENT}{end}\n"
    marked = re.compile(r"^[ \t]*" + re.escape(start) + r".*?" + re.escape(end) + r"[ \t]*\n", re.S | re.M)
    found = marked.findall(text)
    if len(found) > 1:
        raise ShellError(f"{name}: {len(found)} {part} markers")
    if not found:
        found = UNMARKED[part].findall(text)
        if len(found) != 1:
            raise ShellError(f"{name}: no {part} markers, and {len(found)} unmarked {part}s to replace")
    return text.replace(found[0], wrapped, 1)


def crumbs_for(entry):
    """The breadcrumb trail of a page: Home › group › trail › page, or None for no breadcrumbs."""
    if entry.get("crumbs") is False:
        return None
    esc = html.escape
    items = ['<li><a href="/">Home</a></li>']
    if entry.get("group"):
        items.append(f'<li>{esc(entry["group"])}</li>')
    for label, href in entry.get("trail") or []:
        items.append(f'<li><a href="{esc(href)}">{esc(label)}</a></li>')
    item = " data-crumb-item" if entry.get("item") else ""
    items.append(f'<li aria-current="page"{item}>{esc(entry["label"])}</li>')
    return f'<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>{"".join(items)}</ol></nav>'


def put_crumbs(text, name, entry):
    start, end = CRUMBS
    text = KICKER.sub("", text)  # the breadcrumbs replace the old "Hunsterverse · X" line
    marked = re.compile(r"^([ \t]*)" + re.escape(start) + r".*?" + re.escape(end) + r"[ \t]*\n", re.S | re.M)
    found = list(marked.finditer(text))
    if len(found) > 1:
        raise ShellError(f"{name}: {len(found)} crumbs markers")
    nav = crumbs_for(entry)
    if found:
        at, pad = found[0], found[0].group(1)
    else:
        if nav is None:
            return text
        at = list(re.finditer(r'^([ \t]*)<nav class="breadcrumbs".*?</nav>[ \t]*\n', text, re.S | re.M))
        if len(at) > 1:
            raise ShellError(f"{name}: {len(at)} breadcrumbs, not markers")
        if at:
            at, pad = at[0], at[0].group(1)
        else:
            main = list(re.finditer(r'^([ \t]*)<main\b[^>]*\bid="content"[^>]*>([ \t]*\n([ \t]*))?', text, re.M))
            if len(main) != 1:
                raise ShellError(f'{name}: no breadcrumbs markers and {len(main)} <main id="content"> tags')
            main = main[0]
            if main.group(2) is not None:  # main on a line of its own: a line above its first child
                pad, spot, lead = main.group(3), main.start(3), ""
            else:  # content right after <main>: the crumbs go on lines of their own
                pad, spot, lead = main.group(1) + "  ", main.end(), "\n"
            return text[:spot] + f"{lead}{pad}{start}\n{pad}{nav}\n{pad}{end}\n" + text[spot:]
    block = "" if nav is None else f"{pad}{start}\n{pad}{nav}\n{pad}{end}\n"
    return text[:at.start()] + block + text[at.end():]


def render(text, name, shell):
    """The page text with its shell written in."""
    entry = shell["pages"].get(name)
    if entry is None:
        raise ShellError(f"{name}: not in dev/shell/pages.json")
    title = re.search(r"<title>(.*?)</title>", text, re.S)
    if not title or html.unescape(title.group(1).strip()) != entry.get("title"):
        raise ShellError(f'{name}: <title> is {html.unescape(title.group(1)) if title else None!r}, '
                         f'pages.json says {entry.get("title")!r}')
    text = put(text, name, "header", header_for(shell["nav"], entry))
    text = put(text, name, "footer", shell["footer"])
    text = put_crumbs(text, name, entry)
    if not re.search(r'<script src="/js/search\.js"', text):
        if text.count("</body>") != 1:
            raise ShellError(f"{name}: no single </body> to add the search script before")
        text = text.replace("</body>", f"{INDENT}{SEARCH}\n  </body>", 1)
    return text


def problems(root=ROOT, write=False):
    """Out-of-date pages and shell errors; rewrites the out-of-date pages when write is true."""
    shell = load(root)
    found = []
    names = sorted(p.name for p in root.glob("*.html"))
    for name in sorted(set(shell["pages"]) - set(names)):
        found.append(f"dev/shell/pages.json: {name} is not a page")
    if len(shell["order"]) != len(shell["pages"]):
        found.append("dev/shell/pages.json: a page is listed twice")
    for name in names:
        path = root / name
        text = path.read_text(encoding="utf-8")
        try:
            new = render(text, name, shell)
        except ShellError as error:
            found.append(str(error))
            continue
        if new != text:
            if write:
                path.write_text(new, encoding="utf-8")
                print(f"wrote {name}")
            else:
                found.append(f"{name}: out of sync with dev/shell (run python3 dev/site-shell.py)")
    return found


if __name__ == "__main__":
    check = "--check" in sys.argv[1:]
    found = problems(write=not check)
    for line in found:
        print(line)
    print(f"{len(found)} problem(s)" if found else "site shell in sync")
    sys.exit(1 if found else 0)
