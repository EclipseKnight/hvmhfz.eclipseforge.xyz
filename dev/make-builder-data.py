#!/usr/bin/env python3
"""Writes the lookup tables the Quest builder needs and the site cannot derive by itself.

  python3 dev/make-builder-data.py --dll <mhfo-hd.dll> --item-tsv <item-icons.tsv> --dat <mhfdat.bin, decompressed>

--dll       the client's mhfo-hd.dll (the unpacked one from the owner's client; it is never copied here).
            Writes data/map-areas.json: per map id, the ids of its areas, in the client's own order (the
            first is the area a quest starts in). The client keeps a u16 count per map at 0x11864828 and a
            pointer to a u16 list per map at 0x11a3fa28 (hvmhfz_re docs/quest-files.md, header +0x24). Areas
            the old file listed (start areas seen in quests) that the client list lacks are kept at the end.
--item-tsv  the API's src/main/resources/item-icons.tsv (community item database: item id, byte reversed
            hex, then the icon name). Writes data/item-icons.json: item id -> icon name, the file being
            /assets/items/<name>.webp. Items with no icon name are left out; the builders draw the neutral
            placeholder for them (dev/check-builder-icons.js lists them).

--dat       the English client's dat/mhfdat.bin, decompressed (e.g. `mono ReFrontier.exe mhfdat.bin`; the patch's file,
            never copied here). Rewrites the names in data/item-ids.json with the game's own: the client keeps a
            pointer at 0x100 to a table of one pointer per item id to its cp932 name. The current name stays where
            the game's is still Japanese, a placeholder ("(dummy)", "－－－"), or has a "?" the current name has not
            (a character the patch could not write in cp932, e.g. "Bow Hiden? Red" for "Bow Hiden· Red"). Run it
            when a new client patch changes item names; dev/check-wiki-names.py says nothing about items.

Any of the options may be given alone. Only the standard library is used.
"""
import argparse
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COUNTS = 0x11864828
LISTS = 0x11a3fa28


def pe_reader(data):
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    sections = struct.unpack_from("<H", data, pe + 6)[0]
    optional = struct.unpack_from("<H", data, pe + 20)[0]
    base = struct.unpack_from("<I", data, pe + 24 + 28)[0]
    table = []
    for i in range(sections):
        _, vsize, vaddr, rsize, raddr = struct.unpack_from("<8sIIII", data, pe + 24 + optional + i * 40)
        table.append((vaddr, vsize, raddr, rsize))

    def offset(address):
        rva = address - base
        for vaddr, vsize, raddr, rsize in table:
            if vaddr <= rva < vaddr + rsize:
                return raddr + rva - vaddr
        return None

    return offset


def map_areas(dll):
    data = open(dll, "rb").read()
    offset = pe_reader(data)
    counts, lists = offset(COUNTS), offset(LISTS)
    if counts is None or lists is None:
        sys.exit("the area tables are not where this script expects them: is this the unpacked mhfo-hd.dll?")
    result = {}
    for map_id in range(1, 256):
        count = struct.unpack_from("<H", data, counts + 2 * map_id)[0]
        at = offset(struct.unpack_from("<I", data, lists + 4 * map_id)[0])
        if at is None or count == 0 or count > 64:
            break
        result[str(map_id)] = [struct.unpack_from("<H", data, at + 2 * i)[0] for i in range(count)]
    path = os.path.join(ROOT, "data", "map-areas.json")
    try:
        old = json.load(open(path))
    except (OSError, ValueError):
        old = {}
    for key, areas in old.items():
        merged = result.setdefault(key, [])
        merged.extend(a for a in areas if a not in merged)
    ordered = {key: result[key] for key in sorted(result, key=int)}
    with open(path, "w") as out:
        json.dump(ordered, out, separators=(",", ":"))
        out.write("\n")
    print("data/map-areas.json: %d maps, %d areas" % (len(ordered), sum(len(v) for v in ordered.values())))


def item_icons(tsv):
    icons = {}
    for line in open(tsv, encoding="utf-8"):
        key, _, name = line.rstrip("\n").partition("\t")
        key, name = key.strip(), name.strip()
        if len(key) != 4 or not name:
            continue
        try:
            item = (int(key[2:4], 16) << 8) | int(key[0:2], 16)
        except ValueError:
            continue
        icons[item] = name
    ordered = {str(k): icons[k] for k in sorted(icons)}
    path = os.path.join(ROOT, "data", "item-icons.json")
    with open(path, "w") as out:
        json.dump(ordered, out, separators=(",", ":"))
        out.write("\n")
    print("data/item-icons.json: %d items" % len(ordered))


def game_text_kept(game, current):
    """Why the current name stays instead of the game's, or None to take the game's."""
    if any("\u3000" <= ch <= "\u9fff" or "\uff00" <= ch <= "\uffef" for ch in game):
        return "Japanese"
    if not game.strip() or "dummy" in game.lower() or not game.strip("-－ "):
        return "placeholder"
    if "?" in game and "?" not in current:
        return "unwritable character"
    return None


def item_names(dat):
    data = open(dat, "rb").read()
    path = os.path.join(ROOT, "data", "item-ids.json")
    names = json.load(open(path, encoding="utf-8"))
    table = struct.unpack_from("<I", data, 0x100)[0]
    taken, kept = 0, {}
    for key in names:
        item = int(key)
        if item == 0:
            continue  # "None", the empty slot
        at = struct.unpack_from("<I", data, table + 4 * item)[0]
        if not 0 < at < len(data):
            sys.exit("item %d: name pointer 0x%x outside the file: is this the decompressed mhfdat.bin?" % (item, at))
        game = data[at:data.index(b"\0", at)].decode("cp932", "replace").replace("\n", " ")
        why = game_text_kept(game, names[key])
        if why:
            kept[why] = kept.get(why, 0) + 1
        elif game != names[key]:
            names[key] = game
            taken += 1
    with open(path, "w", encoding="utf-8") as out:
        json.dump(names, out, ensure_ascii=False, separators=(",", ":"))
    print("data/item-ids.json: %d names, %d changed to the game's; kept: %s" % (
        len(names), taken, ", ".join("%d %s" % (n, why) for why, n in sorted(kept.items())) or "none"))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dll")
    parser.add_argument("--item-tsv")
    parser.add_argument("--dat")
    args = parser.parse_args()
    if not args.dll and not args.item_tsv and not args.dat:
        parser.error("give --dll, --item-tsv, --dat or several")
    if args.dll:
        map_areas(args.dll)
    if args.item_tsv:
        item_icons(args.item_tsv)
    if args.dat:
        item_names(args.dat)


if __name__ == "__main__":
    main()
