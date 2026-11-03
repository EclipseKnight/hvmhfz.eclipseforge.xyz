#!/usr/bin/env python3
"""Writes the comparison tables of guide-frontier-hunsterverse.html from the guide's own notes.

Every section of a Frontier guide page (<section id="X"> with an <h2>) ends with one "On Hunsterverse"
note: <aside class="box hv-note hv-VERDICT" id="hv-X"> (VERDICT is same, diff, missing or unknown; see
css/guide-frontier.css). This script collects those notes, page by page in reading order, and writes one
table per page between the markers <!-- hv-summary:start --> and <!-- hv-summary:end --> of
guide-frontier-hunsterverse.html, with the verdict counts. Edit the notes on the section pages, then run
it again; nothing between the markers is edited by hand.

Usage:
  python3 dev/make-hv-summary.py          rewrite the tables
  python3 dev/make-hv-summary.py --check  change nothing; exit 1 if a section has no note (or two), a
                                          note has no known verdict, or the page is out of date
"""
import html
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SUMMARY = ROOT / "guide-frontier-hunsterverse.html"
START, END = "<!-- hv-summary:start -->", "<!-- hv-summary:end -->"

# Section pages in reading order (the same order as the guide's "All sections" list).
PAGES = ["basics", "guild", "house", "menus", "items", "item-box", "weapons", "armour", "transcend",
         "monsters", "tools", "hunter-rank", "g-rank-start", "g-rank", "zenith", "quests-food", "events",
         "hunters-road"]
VERDICTS = {"same": "Works the same", "diff": "Different", "missing": "Not available here yet",
            "unknown": "Unknown, not checked"}

SECTION = re.compile(r'<section id="([^"]+)">\s*<h2>(.*?)</h2>(.*?)</section>', re.S)
NOTE = re.compile(r'<aside class="box hv-note hv-(\w+)" id="hv-([^"]+)">(.*?)</aside>', re.S)
VERDICT_TAG = re.compile(r'<strong class="hv-verdict">.*?</strong>\s*', re.S)


def page_title(text):
    return html.unescape(re.search(r"<h1>(.*?)</h1>", text, re.S).group(1)).strip()


def collect():
    """[(page, title, [(section id, h2, [(verdict, note id, note html)])])] and the problems found."""
    out, problems = [], []
    for name in PAGES:
        file = f"guide-frontier-{name}.html"
        text = (ROOT / file).read_text(encoding="utf-8")
        sections = []
        for sid, h2, body in SECTION.findall(text):
            notes = [(v, nid, inner) for v, nid, inner in NOTE.findall(body)]
            main = [n for n in notes if n[1] == sid]
            if len(main) != 1:
                problems.append(f"{file}#{sid}: {len(main)} notes with id hv-{sid} (want 1)")
            for verdict, nid, _ in notes:
                if verdict not in VERDICTS:
                    problems.append(f"{file}#hv-{nid}: unknown verdict hv-{verdict}")
                if nid != sid and not nid.startswith(sid + "-"):
                    problems.append(f"{file}#hv-{nid}: note id does not match its section {sid}")
            sections.append((sid, re.sub(r"<[^>]+>", "", h2).strip(), notes))
        out.append((file, page_title(text), sections))
    return out, problems


def note_html(file, inner):
    """The note's paragraphs without the verdict label, with in-page links pointing at the page."""
    inner = VERDICT_TAG.sub("", inner.strip())
    return re.sub(r'href="#', f'href="/{file}#', inner)


def render(pages):
    counts = {v: 0 for v in VERDICTS}
    for _, _, sections in pages:
        for _, _, notes in sections:
            for verdict, _, _ in notes:
                counts[verdict] = counts.get(verdict, 0) + 1
    lines = [START, '<ul class="hv-counts">']
    for verdict, label in VERDICTS.items():
        lines.append(f'<li><span class="hv-pill hv-{verdict}">{label}</span> {counts[verdict]} notes</li>')
    lines.append("</ul>")
    for file, title, sections in pages:
        anchor = file[len("guide-frontier-"):-len(".html")]
        lines += [f'<section id="{anchor}">', f'<h2><a href="/{file}">{html.escape(title)}</a></h2>',
                  '<div class="table-wrap"><table class="hv-table">',
                  "<thead><tr><th>Section</th><th>On Hunsterverse</th></tr></thead><tbody>"]
        for sid, h2, notes in sections:
            for verdict, nid, inner in notes:
                label = VERDICTS.get(verdict, verdict)
                lines.append(f'<tr class="hv-{verdict}"><td><a href="/{file}#hv-{nid}">{html.escape(h2)}</a></td>'
                             f'<td><span class="hv-pill hv-{verdict}">{label}</span> {note_html(file, inner)}</td></tr>')
        lines += ["</tbody></table></div>", "</section>"]
    lines.append(END)
    return "\n".join(lines)


def main():
    check = "--check" in sys.argv[1:]
    pages, problems = collect()
    text = SUMMARY.read_text(encoding="utf-8")
    if START not in text or END not in text:
        problems.append(f"{SUMMARY.name}: markers {START} / {END} missing")
        new = text
    else:
        before, rest = text.split(START, 1)
        after = rest.split(END, 1)[1]
        new = before + render(pages) + after
        if check and new != text:
            problems.append(f"{SUMMARY.name} is out of date: run python3 dev/make-hv-summary.py")
    for p in problems:
        print(p)
    if not check and new != text:
        SUMMARY.write_text(new, encoding="utf-8")
        print(f"wrote {SUMMARY.name}")
    total = sum(len(n) for _, _, s in pages for _, _, n in s)
    print(f"{len(pages)} pages, {total} notes, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
