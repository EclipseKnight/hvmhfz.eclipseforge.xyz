#!/usr/bin/env python3
"""Writes the two lookup tables the Quest builder needs and the site cannot derive by itself.

  python3 dev/make-builder-data.py --dll <mhfo-hd.dll> --item-tsv <item-icons.tsv>

--dll       the client's mhfo-hd.dll (the unpacked one from the owner's client; it is never copied here).
            Writes data/map-areas.json: per map id, the ids of its areas, in the client's own order (the
            first is the area a quest starts in). The client keeps a u16 count per map at 0x11864828 and a
            pointer to a u16 list per map at 0x11a3fa28 (hvmhfz_re docs/quest-files.md, header +0x24). Areas
            the old file listed (start areas seen in quests) that the client list lacks are kept at the end.
--item-tsv  the API's src/main/resources/item-icons.tsv (community item database: item id, byte reversed
            hex, then the icon name). Writes data/item-icons.json: item id -> icon name, the file being
            /assets/items/<name>.webp. Items with no icon name are left out; the builders draw the neutral
            placeholder for them (dev/check-builder-icons.js lists them).

Either option may be given alone. Only the standard library is used.
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


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dll")
    parser.add_argument("--item-tsv")
    args = parser.parse_args()
    if not args.dll and not args.item_tsv:
        parser.error("give --dll, --item-tsv or both")
    if args.dll:
        map_areas(args.dll)
    if args.item_tsv:
        item_icons(args.item_tsv)


if __name__ == "__main__":
    main()
