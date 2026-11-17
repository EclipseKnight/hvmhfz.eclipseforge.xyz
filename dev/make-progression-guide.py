#!/usr/bin/env python3
"""Write the Key and Urgent Quest lists of the progression guide page from data/quest-gates.json.

guide-frontier-progression.html has one section per HR band (#hr1..#hr7, the anchors the API's "next step"
links to: hvmhfz_rest_api NextStepPlanner.GUIDE). The quest lists inside them sit between the markers
<!-- progression:hrN:begin --> and <!-- progression:hrN:end --> and are written by this script; the words
around them are edited by hand. Run it again after dev/make-quest-gates.py changes data/quest-gates.json.

    python3 dev/make-progression-guide.py           rewrite the lists
    python3 dev/make-progression-guide.py --check   exit 1 when the page differs from the data (dev/check-next-step.js runs it)
"""
import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "guide-frontier-progression.html"
DATA = ROOT / "data" / "quest-gates.json"
URGENT_WHERE = "Quest Counter &gt; Hunter Quests &gt; Urgent Quests"


def band_start(band):
    """The lowest HR the game shows in a band (the owner's ranges: HR2 = HR 2-30, HR3 = HR 31-50, ...)."""
    return int(re.search(r"\d+", band["hr"]).group())


def quest_link(qid, quests):
    return '<a href="/quest.html?id=%d">%s</a>' % (qid, html.escape(quests[str(qid)]["name"], quote=False))


def band_html(band, bands, quests):
    """The lists of one band: its Key Quests in the game's order, then its Urgent Quest."""
    start = band_start(band)
    lines = ['<h3>Key Quests (%d)</h3>' % len(band["keys"]), "<ol>"]
    for qid in band["keys"]:
        req = quests[str(qid)]["reqHr"]
        later = " (from HR %d)" % req if req > start else ""
        lines.append("<li>%s%s</li>" % (quest_link(qid, quests), later))
    lines.append("</ol>")
    if band["urgent"]:
        following = next((b for b in bands if b["band"] == band["band"] + 1), None)
        req = quests[str(band["urgent"])]["reqHr"]
        when = "once every Key Quest above is cleared" + ("" if req <= start else " and you are HR %d" % req)
        lines.append("<h3>Urgent Quest</h3>")
        lines.append('<p>%s: appears in %s %s. Clearing it raises your HR cap to %d%s.</p>'
                     % (quest_link(band["urgent"], quests), URGENT_WHERE, when, band["unlocksHr"],
                        " (%s)" % following["label"] if following else " (HR%d)" % (band["band"] + 1)))
    else:
        lines.append('<p>%s has no Urgent Quest.</p>' % band["label"])
    lines.append('<p><a href="/quests.html?gate=%s">%s Key and Urgent Quests in the quest list</a></p>'
                 % (band["label"], band["label"]))
    return "\n".join(lines)


def render(page, data):
    quests = data["quests"]
    for band in data["bands"]:
        name = "hr%d" % band["band"]
        pattern = re.compile(r"(<!-- progression:%s:begin -->\n).*?(<!-- progression:%s:end -->)" % (name, name), re.S)
        if not pattern.search(page):
            raise SystemExit("guide-frontier-progression.html has no markers for " + name)
        page = pattern.sub(lambda m: m.group(1) + band_html(band, data["bands"], quests) + "\n" + m.group(2), page)
    return page


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    old = PAGE.read_text(encoding="utf-8")
    new = render(old, data)
    if "--check" in sys.argv[1:]:
        if new != old:
            print("guide-frontier-progression.html: the quest lists differ from data/quest-gates.json;"
                  " run python3 dev/make-progression-guide.py")
            sys.exit(1)
        print("progression guide lists OK")
        return
    if new != old:
        PAGE.write_text(new, encoding="utf-8")
        print("wrote " + PAGE.name)
    else:
        print("no change")


if __name__ == "__main__":
    main()
