#!/usr/bin/env python3
"""Checks changelog.html: its layout (month > day > topic, a release time on every change) and, against
an older copy of the page, that no change was lost when entries were regrouped.

Layout (always):
  - "Released updates" holds section.cl-month > section.cl-day > section.cl-topic, newest day first, each day
    in its own month, ids m-YYYY-MM, d-YYYY-MM-DD and d-YYYY-MM-DD-<topic> (unique);
  - every change (a top-level <li> of a topic) starts with <time class="cl-when">: "D Mon YYYY, HH:MM UTC"
    with datetime="YYYY-MM-DDTHH:MMZ", or the date only "D Mon YYYY" with datetime="YYYY-MM-DD" and class
    cl-date; its date is the day it sits under. Only a "How to get it" note (li.cl-howto) has no time;
  - the contents list every day, and each day's topic line links every topic of that day.

Facts (with --old): every bullet, paragraph and table row of the old page's "Coming next", "Released updates"
and "Known issues" (and any entries after them) must appear word for word in one element of the new page,
release time aside, with the same links. The only exception: the old 3 Nov "How to get it" bullets, merged
into one note, which must keep their links, file names and numbers and most of their words.

Usage: python3 dev/check-changelog.py [--old REF|FILE]   (default REF: 8e02a4c, the last copy before the
       page was grouped by day and topic; exit code 0 = all good)
       python3 dev/check-changelog.py --self-test           (the checks on made-up pages)
"""
import html
import pathlib
import re
import subprocess
import sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_OLD = "8e02a4c"
VOID = {"br", "img", "meta", "link", "input", "hr", "source", "wbr", "col", "area", "base", "embed", "track"}
MON = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6, "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10,
       "Nov": 11, "Dec": 12}
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
               "October", "November", "December"]


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []

    def classes(self):
        return (self.attrs.get("class") or "").split()

    def iter(self):
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.iter()

    def text(self, skip=lambda n: False):
        out = []
        for c in self.children:
            if isinstance(c, str):
                out.append(c)
            elif not skip(c):
                out.append(c.text(skip))
        return "".join(out)

    def hrefs(self, skip=lambda n: False):
        found = {self.attrs["href"]} if self.tag == "a" and "href" in self.attrs else set()
        for c in self.children:
            if isinstance(c, Node) and not skip(c):
                found |= c.hrefs(skip)
        return found


class Tree(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", {}, None)
        self.cur = self.root
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def norm(s):
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def is_time(n):
    return n.tag == "time" and "cl-when" in n.classes()


def is_list(n):
    return n.tag in ("ul", "ol", "table")


def main_of(tree):
    return next((n for n in tree.root.iter() if n.tag == "main"), tree.root)


def facts(tree):
    """(text, links) of every li, p and table row in main from #next on (not the nav or contents)."""
    main = main_of(tree)
    started, out = False, []
    for n in main.iter():
        if n.attrs.get("id") == "next":
            started = True
        if not started or n.tag not in ("li", "p", "tr"):
            continue
        if n.tag == "p" and "cl-topics" in n.classes():
            continue
        skip = lambda c: is_list(c) or is_time(c)
        text = norm(n.text(skip))
        if text:
            out.append((text, n.hrefs(skip), n))
    return out


WORD = re.compile(r"[a-z][a-z']{2,}")
STOP = {"the", "and", "for", "you", "your", "its", "with", "from", "that", "this", "now", "are", "was", "has",
        "can", "not", "but", "all", "out", "one", "get", "again", "before", "then", "also", "there", "they"}


def words(s):
    return {w for w in WORD.findall(s.lower()) if w not in STOP}


def tokens(s):
    """Numbers, file names and quoted names: the parts a merged bullet must keep exactly."""
    return set(re.findall(r"\d[\d,.]*\d|\d|[\w-]+\.(?:zip|bin|html)\b", s))


# Known-issue bullets of the old page that were rewritten on purpose because the issue was fixed
# (4 Nov 2026: Diva Defense and the tournaments are built now).
REWRITTEN = ("Not built on our server yet: Diva Defense, reward song effects",)


def is_merged_howto(old_text):
    return old_text.startswith("How to get it:")


def check_facts(old_src, new_src):
    problems = []
    new = facts(Tree(new_src))
    howto = [f for f in new if "cl-howto" in f[2].classes()]
    for text, links, node in facts(Tree(old_src)):
        hit = next((f for f in new if text in f[0] and links <= f[1]), None)
        if hit or text.startswith(REWRITTEN):
            continue
        # The 3 Nov "How to get it" bullets were merged into the day's note.
        merged = None
        if is_merged_howto(text):
            for h in howto:
                kept = words(text) & words(h[0])
                if (tokens(text) <= tokens(h[0]) and links <= h[1]
                        and len(kept) >= 0.7 * max(1, len(words(text)))):
                    merged = h
                    break
        if merged is None:
            problems.append("lost or changed: " + text[:140])
    return problems


def check_layout(src):
    problems = []
    tree = Tree(src)
    main = main_of(tree)
    ids = [n.attrs["id"] for n in main.iter() if "id" in n.attrs]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append("duplicate id " + dup)
    months = [n for n in main.iter() if n.tag == "section" and "cl-month" in n.classes()]
    if not months:
        return ["no section.cl-month in the page"]
    days_seen = []
    for month in months:
        mid = month.attrs.get("id", "")
        m = re.fullmatch(r"m-(\d{4})-(\d{2})", mid)
        if not m:
            problems.append(f"month section id {mid!r} is not m-YYYY-MM")
            continue
        title = next((c for c in month.iter() if "cl-month-title" in c.classes()), None)
        want = f"{MONTH_NAMES[int(m.group(2)) - 1]} {m.group(1)}"
        if title is None or norm(title.text()) != want:
            problems.append(f"{mid}: month title should be {want!r}")
        for day in (c for c in month.children if isinstance(c, Node) and "cl-day" in c.classes()):
            did = day.attrs.get("id", "")
            d = re.fullmatch(r"d-(\d{4})-(\d{2})-(\d{2})", did)
            if not d or f"m-{d.group(1)}-{d.group(2)}" != mid:
                problems.append(f"day {did!r} is not d-YYYY-MM-DD inside its month {mid}")
                continue
            days_seen.append(did)
            date = did[2:]
            topics = [c for c in day.children if isinstance(c, Node) and "cl-topic" in c.classes()]
            if not topics:
                problems.append(f"{did}: no topic")
            line = next((c for c in day.children if isinstance(c, Node) and "cl-topics" in c.classes()), None)
            listed = line.hrefs() if line else set()
            for t in topics:
                tid = t.attrs.get("id", "")
                if not tid.startswith(did + "-"):
                    problems.append(f"topic id {tid!r} does not start with {did}-")
                if "#" + tid not in listed:
                    problems.append(f"{did}: the topic line does not link #{tid}")
                for ul in (c for c in t.children if isinstance(c, Node) and c.tag == "ul"):
                    for li in (c for c in ul.children if isinstance(c, Node) and c.tag == "li"):
                        problems += check_time(li, date, tid)
    if days_seen != sorted(days_seen, reverse=True):
        problems.append("days are not newest first: " + ", ".join(days_seen))
    toc = next((n for n in main.iter() if "cl-toc" in n.classes()), None)
    toc_links = toc.hrefs() if toc else set()
    for did in days_seen:
        if "#" + did not in toc_links:
            problems.append(f"the contents do not link #{did}")
    for mon in months:
        if "#" + mon.attrs.get("id", "") not in toc_links:
            problems.append(f"the contents do not link #{mon.attrs.get('id')}")
    return problems


def check_time(li, date, where):
    if "cl-howto" in li.classes():
        return []
    first = next((c for c in li.children if isinstance(c, Node) or c.strip()), None)
    label = norm(li.text())[:60]
    if not isinstance(first, Node) or not is_time(first):
        return [f"{where}: change without a release time first: {label}"]
    stamp, text = first.attrs.get("datetime", ""), norm(first.text())
    y, m, d = date.split("-")
    day_text = f"{int(d)} {[k for k, v in MON.items() if v == int(m)][0]} {y}"
    if "cl-date" in first.classes():
        if stamp != date or text != day_text:
            return [f"{where}: date-only time should be datetime={date!r}, {day_text!r}: {label}"]
        return []
    t = re.fullmatch(r"(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})Z", stamp)
    if not t or t.group(1) != date or text != f"{day_text}, {t.group(2)}:{t.group(3)} UTC":
        return [f"{where}: time should be datetime='{date}THH:MMZ' and '{day_text}, HH:MM UTC': {label}"]
    if not (int(t.group(2)) < 24 and int(t.group(3)) < 60):
        return [f"{where}: impossible time {stamp}"]
    return []


def self_test():
    shell = ('<main><nav class="toc cl-toc"><a href="#m-2026-11">x</a><a href="#d-2026-11-03">x</a></nav>'
             '<h2 id="next">Next</h2><h2 id="live">Released</h2>'
             '<section class="cl-month" id="m-2026-11"><h3 class="cl-month-title">November 2026</h3>'
             '<section class="cl-day" id="d-2026-11-03"><h4 class="cl-day-title">3 Nov</h4>'
             '<p class="cl-topics"><a href="#d-2026-11-03-sky">Sky</a></p>'
             '<section class="cl-topic" id="d-2026-11-03-sky"><h5>Sky</h5><ul>{items}</ul></section>'
             '</section></section><h2 id="known">Known</h2></main>')
    old = ('<main><h2 id="next">Next</h2><h2 id="live">Released</h2><h3>3 Nov</h3><ul>'
           '<li><b>Tower:</b> open, see <a href="/sky.html">Sky</a>.</li>'
           '<li><b>How to get it:</b> download <code>Frontier_Patch.zip</code> again from the setup guide and copy '
           'it over your game folder.</li></ul><h2 id="known">Known</h2></main>')
    good = shell.format(items=(
        '<li><time class="cl-when" datetime="2026-11-03T03:41Z">3 Nov 2026, 03:41 UTC</time> <b>Tower:</b> open, '
        'see <a href="/sky.html">Sky</a>.</li>'
        '<li class="cl-howto"><b>How to get it:</b> download <code>Frontier_Patch.zip</code> again from the setup '
        'guide and unzip it over your game folder.</li>'))
    cases = [
        ("good page", good, True, True),
        ("a lost bullet", shell.format(items='<li class="cl-howto"><b>How to get it:</b> download '
                                             '<code>Frontier_Patch.zip</code> again from the setup guide.</li>'),
         False, True),
        ("a dropped link", good.replace('<a href="/sky.html">Sky</a>', "Sky"), False, True),
        ("a bullet without a time", good.replace(
            '<time class="cl-when" datetime="2026-11-03T03:41Z">3 Nov 2026, 03:41 UTC</time> ', ""), True, False),
        ("a time on the wrong day", good.replace("2026-11-03T03:41Z", "2026-11-02T03:41Z"), True, False),
        ("a time text that disagrees", good.replace("03:41 UTC", "03:42 UTC"), True, False),
        ("a day missing from the contents", good.replace('<a href="#d-2026-11-03">x</a>', ""), True, False),
        ("a topic missing from the day's line", good.replace('<a href="#d-2026-11-03-sky">Sky</a>', ""), True, False),
    ]
    failed = 0
    for name, page, facts_ok, layout_ok in cases:
        got_facts = not check_facts(old, page)
        got_layout = not check_layout(page)
        ok = got_facts == facts_ok and got_layout == layout_ok
        failed += not ok
        print(("ok  " if ok else "FAIL") + f" {name}: facts {'kept' if got_facts else 'lost'}, "
              f"layout {'ok' if got_layout else 'problem'}")
    print("self-test " + ("passed" if not failed else f"failed ({failed})"))
    return 1 if failed else 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    old_ref = DEFAULT_OLD
    if "--old" in argv:
        old_ref = argv[argv.index("--old") + 1]
    new_src = (ROOT / "changelog.html").read_text(encoding="utf-8")
    if pathlib.Path(old_ref).is_file():
        old_src = pathlib.Path(old_ref).read_text(encoding="utf-8")
    else:
        old_src = subprocess.run(["git", "-C", str(ROOT), "show", f"{old_ref}:changelog.html"],
                                 capture_output=True, text=True, check=True).stdout
    problems = check_layout(new_src) + check_facts(old_src, new_src)
    n_old = len(facts(Tree(old_src)))
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} problem(s)")
        return 1
    print(f"changelog OK: {n_old} old bullets, paragraphs and rows all kept (old copy: {old_ref})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
