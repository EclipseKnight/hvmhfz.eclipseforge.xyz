#!/usr/bin/env python3
"""Copy the Hunter Bento data into the site: data/food-recipes.json, read by /food.html (js/food.js), the site
search's "Food and Bentos" kind and, later, the Discord bot's /food command (the bot reads the site's copy, so
there is one copy only).

The file is made in the private hvmhfz_re repo (tools/items/food_recipes.py, docs/food-recipes.md: every bento
read from the game's client) and copied here unchanged, byte for byte. Run this after it is rebuilt there:

    python3 dev/copy-food-data.py                  # copies from /root/mhfz/hvmhfz_re/data/food-recipes.json
    python3 dev/copy-food-data.py --src <file>     # from another checkout
    python3 dev/copy-food-data.py --check          # change nothing: the site's copy is the same as the source

Then run node dev/check-food.js. The copy is refused when the source is not format 1 (js/food.js reads format 1;
a new format means the page has to change first) or lacks the lists the page needs.
"""
import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / "data" / "food-recipes.json"
DEFAULT_SRC = pathlib.Path("/root/mhfz/hvmhfz_re/data/food-recipes.json")


def problems(data):
    out = []
    if data.get("format") != 1:
        out.append("format is %r, the page reads format 1" % data.get("format"))
    for key in ("seasons", "ingredients", "bentos", "sr_bentos"):
        if not isinstance(data.get(key), list) or not data[key]:
            out.append("no %s list" % key)
    if out:
        return out
    keys = [s.get("key") for s in data["seasons"]]
    if keys != ["warm", "cold", "breeding"]:
        out.append("seasons are %r, not warm, cold, breeding" % keys)
    ids = {i["id"] for i in data["ingredients"]}
    for b in data["bentos"] + data["sr_bentos"]:
        if b.get("a") not in ids or b.get("b") not in ids:
            out.append("a bento names an ingredient that is not in the list: %r" % b)
            break
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--src", type=pathlib.Path, default=DEFAULT_SRC, help="hvmhfz_re's data/food-recipes.json")
    ap.add_argument("--check", action="store_true", help="change nothing; fail when the copy differs")
    args = ap.parse_args()

    if not args.src.is_file():
        if args.check and DEST.is_file():
            # No hvmhfz_re checkout here (it is private): check the site's own copy only.
            bad = problems(json.loads(DEST.read_text(encoding="utf-8")))
            for p in bad:
                print("data/food-recipes.json: " + p)
            print("no source at %s; site copy %s" % (args.src, "has problems" if bad else "OK"))
            return 1 if bad else 0
        print("no source file at %s (use --src)" % args.src)
        return 1
    raw = args.src.read_bytes()
    bad = problems(json.loads(raw.decode("utf-8")))
    if bad:
        for p in bad:
            print("%s: %s" % (args.src, p))
        return 1
    same = DEST.is_file() and DEST.read_bytes() == raw
    if args.check:
        print("data/food-recipes.json " + ("up to date" if same else "differs from %s: run python3 dev/copy-food-data.py" % args.src))
        return 0 if same else 1
    if same:
        print("data/food-recipes.json already up to date")
    else:
        DEST.write_bytes(raw)
        print("data/food-recipes.json copied from %s (%d bytes)" % (args.src, len(raw)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
