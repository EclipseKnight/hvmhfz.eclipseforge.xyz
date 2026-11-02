#!/usr/bin/env python3
"""Writes the Road data into road-data.html: per Road its number, name, and per floor the points
multipliers and the monsters with their chance. Plain markup, no script: the page is generated here,
not in the browser.

The Roads are whole Roads as `rengoku-build decode` prints them (Erupe, cmd/rengoku-build). Every Road
file the server has run is archived by sha256 on the game host (~/frontier/road/maps/<sha256>.bin);
the numbers and names are those of /api/public/road/history. Decode each one, then:

  rengoku-build decode -in <sha256>.bin > zenith.json
  python3 dev/make-road-data.py 0 "Zenith Road" zenith.json -1 "Original Road" original.json

Give the Roads newest first. Run it again when a new Road goes live. With --check it only says whether
the page is up to date (exit code 1 when not). The monster names come from js/road-rules.js, so the page
names monsters as the builder does.
"""
import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "road-data.html"
START = "<!-- road-data:start (dev/make-road-data.py writes this part) -->"
END = "<!-- road-data:end -->"
FLAG_FORCED = 2
MODE_TITLES = {0: "Open Road", 1: "Solo Road"}


def monster_names():
    """Erupe's monster table, as js/road-rules.js keeps it (index = monster id)."""
    text = (ROOT / "js/road-rules.js").read_text(encoding="utf-8")
    listed = re.search(r"var MONSTER_NAMES = \[(.*?)\];", text, re.S)
    return re.findall(r'"([^"]*)"', listed.group(1))


def name_of(names, monster_id):
    """Id 0 has no monster in the table (its level is 0 too); what the game does when it draws one is not
    known (hvmhfz_re docs/rengoku-data.md), so it is named for what it is."""
    if monster_id == 0:
        return "No monster (id 0)"
    return names[monster_id] if 0 < monster_id < len(names) else "Monster " + str(monster_id)


def number(value):
    """2.0 -> "2", 1.75 -> "1.75"."""
    return ("%.3f" % value).rstrip("0").rstrip(".")


def floors_label(first, last):
    if last is None:
        return f"{first} and up"
    return f"{first} to {last}" if last > first else str(first)


def chance(share):
    percent = share * 100
    if 0 < percent < 1:  # not "< 0.5": Python rounds 0.5 to even, so 0.5% would show as "0%"
        return "under 1%"
    return f"{percent:.0f}%"


def monsters_text(table, names):
    """The monsters of one table: chance by weight (one entry's weight over the table's total), the
    same monster's entries added up, highest chance first. Forced entries are named as forced; an entry
    with weight 0 that is not forced is never drawn, so it is left out."""
    total = sum(e["weight"] for e in table)
    weights, forced = {}, set()
    for e in table:
        label = name_of(names, e["monster"])
        if e.get("monster2"):
            label += " + " + name_of(names, e["monster2"])
        if e["flags"] & FLAG_FORCED:
            forced.add(label)
        if e["weight"] > 0 or e["flags"] & FLAG_FORCED:
            weights[label] = weights.get(label, 0) + e["weight"]
    parts = []
    for label, weight in sorted(weights.items(), key=lambda kv: (-kv[1], kv[0])):
        text = label + (" " + chance(weight / total) if weight else "")
        parts.append(text + (" (forced)" if label in forced else ""))
    return ", ".join(parts) if parts else "none"


def floor_rows(mode, names):
    """One row per run of floor records with the same table and points; the last record covers every
    floor above it."""
    floors = mode["floors"]
    rows = []
    for i, f in enumerate(floors):
        key = (f["table"], f["points"], f["points2"])
        last = floors[i + 1]["floor"] - 1 if i + 1 < len(floors) else None
        if rows and rows[-1]["key"] == key and rows[-1]["last"] == f["floor"] - 1:
            rows[-1]["last"] = last
        else:
            rows.append({"key": key, "first": f["floor"], "last": last})
    out = []
    for r in rows:
        table, p1, p2 = r["key"]
        points = number(p1) + "×" if p1 == p2 else number(p1) + "× / " + number(p2) + "×"
        monsters = monsters_text(mode["tables"][table], names) if table < len(mode["tables"]) else "none"
        out.append(f'<tr><td>{floors_label(r["first"], r["last"])}</td><td class="num">{points}</td>'
                   f'<td class="num">{table}</td><td class="road-data-monsters">{html.escape(monsters)}</td></tr>')
    return out


def render(roads, names):
    """roads: [(number, name, decoded Road)], newest first. Returns the markup between the markers."""
    out = []
    seen = []  # (mode index, mode data, Road label) already written, to point at instead of repeating
    for num, name, road in roads:
        # The base Roads (number 0 and below) are "base" on the past winners page; keep their number.
        label = f"Road {num}: {name}" if num > 0 else f"{name} (base Road, number {num})"
        out.append(f'<section class="panel" id="road-{num}">')
        out.append(f'  <div class="panel-head"><h2>{html.escape(label)}</h2></div>')
        for m, mode in enumerate(road["modes"]):
            title = MODE_TITLES.get(m, f"Mode {m}")
            out.append(f"  <h3>{title}</h3>")
            same = next((owner for sm, data, owner in seen if sm == m and data == mode), None)
            if same:
                out.append(f'  <p class="note-text">The same as the {title} of {html.escape(same)}.</p>')
                continue
            seen.append((m, mode, label))
            out.append('  <div class="table-wrap"><table class="data-table road-data-table">')
            out.append('    <thead><tr><th>Floors</th><th class="num">Points</th><th class="num">Table</th>'
                       '<th>Monsters (chance on each floor)</th></tr></thead>')
            out.append("    <tbody>")
            out += ["      " + row for row in floor_rows(mode, names)]
            out.append("    </tbody>")
            out.append("  </table></div>")
        out.append("</section>")
    return "\n".join("      " + line for line in out)


def write(page_text, body):
    head, rest = page_text.split(START, 1)
    _, tail = rest.split(END, 1)
    return head + START + "\n" + body + "\n      " + END + tail


def main(argv):
    check = "--check" in argv
    args = [a for a in argv if a != "--check"]
    if not args or len(args) % 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    roads = []
    for i in range(0, len(args), 3):
        roads.append((int(args[i]), args[i + 1], json.loads(pathlib.Path(args[i + 2]).read_text(encoding="utf-8"))))
    old = PAGE.read_text(encoding="utf-8")
    new = write(old, render(roads, monster_names()))
    if check:
        print("road-data.html is up to date" if new == old else "road-data.html is out of date")
        return 0 if new == old else 1
    PAGE.write_text(new, encoding="utf-8")
    print(f"wrote road-data.html ({len(new.encode('utf-8'))} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
