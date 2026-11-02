#!/usr/bin/env python3
"""Checks dev/make-road-data.py on two small made-up Roads (no game data): chances from the weights,
the same monster added up, second monsters, forced and weight-0 entries, floor runs, the second points
multiplier, a mode equal to an earlier Road's, the base Road heading, escaping, and that writing the
page only replaces the part between the markers.

Usage: python3 dev/check-road-data.py   (exit code 0 = all good, 1 = a difference, listed)
"""
import importlib.util
import pathlib
import sys

sys.dont_write_bytecode = True  # no dev/__pycache__ left behind in the worktree
HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("make_road_data", HERE / "make-road-data.py")
make = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make)

NAMES = make.monster_names()  # 1 Rathian, 11 Rathalos, 14 Diablos, 17 Gravios, 71 White Fatalis


def entry(monster, weight, monster2=0, flags=0):
    return {"monster": monster, "monster2": monster2, "weight": weight, "flags": flags}


def floor(n, table, points=1, points2=None):
    return {"floor": n, "table": table, "points": points, "points2": points if points2 is None else points2}


TABLES = [
    # Rathian twice (weights add up), Rathalos with Diablos as second monster, a forced weight-0
    # White Fatalis, and a weight-0 Gravios that is never drawn.
    [entry(1, 1), entry(1, 1), entry(11, 2, monster2=14), entry(71, 0, flags=2), entry(17, 0)],
    [entry(14, 3), entry(17, 1, flags=2)],
]
SOLO = {"floors": [floor(1, 1, 0.5)], "tables": TABLES}
NEW = {"modes": [{"floors": [floor(1, 0), floor(2, 0), floor(3, 0, 2), floor(4, 1, 1.5, 2), floor(5, 1, 1.5, 2),
                             floor(8, 1)],
                  "tables": TABLES}, SOLO]}
BASE = {"modes": [{"floors": [floor(1, 1)], "tables": TABLES}, SOLO]}

problems = []


def expect(what, got, want):
    if got != want:
        problems.append(f"{what}:\n  got  {got!r}\n  want {want!r}")


expect("table 0 monsters", make.monsters_text(TABLES[0], NAMES),
       "Rathalos + Diablos 50%, Rathian 50%, White Fatalis (forced)")
expect("table 1 monsters", make.monsters_text(TABLES[1], NAMES), "Diablos 75%, Gravios 25% (forced)")
expect("tiny chance", make.chance(1 / 300), "under 1%")
expect("empty table", make.monsters_text([entry(11, 0)], NAMES), "none")

rows = make.floor_rows(NEW["modes"][0], NAMES)
expect("floor runs", [r.split("</td>")[0].replace("<tr><td>", "") for r in rows],
       ["1 to 2", "3", "4 to 7", "8 and up"])
expect("points", [r.split('<td class="num">')[1].split("<")[0] for r in rows], ["1×", "2×", "1.5× / 2×", "1×"])
expect("table column", [r.split('<td class="num">')[2].split("<")[0] for r in rows], ["0", "0", "1", "1"])

page = make.render([(2, "Rocks & Rathians", NEW), (0, "Base", BASE)], NAMES)
expect("Road heading escaped", "<h2>Road 2: Rocks &amp; Rathians</h2>" in page, True)
expect("base Road heading", "<h2>Base (base Road, number 0)</h2>" in page, True)
expect("same solo Road written once", page.count("<table"), 3)
expect("same solo Road points back",
       '<p class="note-text">The same as the Solo Road of Road 2: Rocks &amp; Rathians.</p>' in page, True)

shell = "<html>\nbefore\n      " + make.START + "\nold\n      " + make.END + "\nafter\n</html>\n"
written = make.write(shell, "      new")
expect("write keeps the shell", written,
       "<html>\nbefore\n      " + make.START + "\n      new\n      " + make.END + "\nafter\n</html>\n")
expect("write twice is the same", make.write(written, "      new"), written)

for p in problems:
    print(p)
print(f"{len(problems)} problem(s)" if problems else "road data OK")
sys.exit(1 if problems else 0)
