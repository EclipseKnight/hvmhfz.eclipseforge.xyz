#!/usr/bin/env python3
"""Writes data/quest-where.json: where a player can take each quest of data/quests.json on Hunsterverse today (the
quest page's "Where to take it on Hunsterverse" line, js/quest.js, through data/quests/pieces/ by
dev/make-quest-pieces.py). Method and menu tree: dev/quest-where.md.

Two steps, so a lead can rerun the second anywhere:

  python3 dev/make-quest-where.py --collect [--stable ZIP] [--pre ZIP] [--re DIR] [--no-live]
      Reads the client patches and the live server (read-only) and writes dev/quest-where-inputs.json:
      - each patch zip's mhfo-hd.dll (the counter menus: action table 0x11925340, the root list of each counter,
        hvmhfz_re tools/quest/menu_lists.py), dat/mhfpac.bin (the menu labels, the client's own English text) and
        dat/mhfinf.bin + dat/mhfdat.bin (the built-in quest lists; decoded with hvmhfz_re build/unpack_cli). Which
        data each built-in list number reads: the list builder 0x1037c730 (LIST_SOURCES below).
        Defaults: the stable v1.30 zip and the v1.32-pre18 zip on mhfz-dev (STABLE_ZIP, PRE_ZIP).
      - live (ssh hvmhfz-db, SELECT only): event_quests (what Erupe's ENUMERATE_QUEST serves), tournament_quests
        (Speedrun Cup), vs_bracket_quests (VS Bracket), scenario_counter (the Series Quest Counter) with hvmhfz_re
        data/series_quests.tsv (the quests each series' steps offer).
  python3 dev/make-quest-where.py            # data/quest-where.json from dev/quest-where-inputs.json + data/quests.json
  python3 dev/make-quest-where.py --check    # change nothing; exit 1 when data/quest-where.json is not what it would
                                             # write (run by dev/check-quest-where.js)
Run make-quest-pieces.py after it (the pieces carry each quest's line).

data/quest-where.json: {"_about", "inputs": {patch versions, live snapshot time}, "counts": {...},
"quests": {"<id>": {"status": "offered" | "unconfirmed" | "not-offered", "places": [{"path": "General Quest Counter >
Hunter Quests > ★3", "patch": "both" | "stable" | "pre", "need": "G Rank" (optional), "note": "..." (optional),
"sure": false (only when unconfirmed)}], "hidden": ["Order Quests > G Deco Quests", ...] (client lists no counter
shows, optional), "rankNeed": "HR 31" (optional, the quest file's own requirement, from data/quests.json)}}.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import struct
import subprocess
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
INPUTS = ROOT / "dev" / "quest-where-inputs.json"
OUT = ROOT / "data" / "quest-where.json"
QUESTS = ROOT / "data" / "quests.json"
RE_DIR = pathlib.Path("/root/mhfz/hvmhfz_re")
STABLE_ZIP = pathlib.Path("/root/work/client-patch-stamp/v1.30/Frontier_Patch.zip")
PRE_ZIP = pathlib.Path("/root/work/v132pre19/stamped/Frontier_Patch-v1.32-pre18.zip")

# ---------------------------------------------------------------------------------------------------------------
# Collect: the client's counters (hvmhfz_re docs/progression.md 3, docs/tower-npc.md, decompiles of 0x103714a0,
# 0x1037c730 and the town talk switch 0x1071ef70).

# Counter -> its root menu list (0x103714a0 picks the root by counter type; the talk switch 0x1071ef70 opens the
# counter type from the NPC kind; NPC names from the town NPC tables 0x11a7bb20, record +0x17).
#   NPC kind 0x28 "General Quest Counter" (and 0x38 "Free Quest Counter") -> type 6 -> the default root
#   kind 0xf3 "G Rank Quest Counter" -> type 0xe -> 0x11925204 (the two other type-0xe roots, the ≪...≫ rows of
#        My Missions, need a guild/mission state; not counted)
#   kind 0x26 "H.Road/Sky Corridor" -> type 16 (our patch, part 177) -> the root at dword 0x10371562
#   kind 0xb6 "Caravan Quest Counter" -> type 4; kind 0x77 "Winner Quest Counter" -> type 8
#   kind 0xc6 "Accepting the first quest" (rookie areas) -> type 2
#   Diva Defense's quest menus (docs/diva-defense.md): types 0x11, 0x13, 0x15
COUNTERS = [
    ("General Quest Counter", [0x11998B3C]),
    ("G Rank Quest Counter", [0x11925204]),
    ("H.Road/Sky Corridor", "type16"),
    ("Caravan Quest Counter", [0x119251CC]),
    ("Winner Quest Counter", [0x119252AC]),
    ("Rookie counter (Accepting the first quest)", [0x119262B0]),
    ("Diva Defense", [0x119252B4, 0x119252B8, 0x119252BC]),
    # The G counter's two other roots (the My Missions rows ≪...≫): picked by a guild/mission state (0x107fee20,
    # 0x103f5690) not traced, so their built-in lists count as unconfirmed and their event rows are left out.
    ("G Rank Quest Counter (My Missions menu)", [0x11925214, 0x11925220]),
]
UNSURE_COUNTERS = {"G Rank Quest Counter (My Missions menu)"}
TYPE16_ROOT_REF = 0x10371562      # 0x103714a0's relocated dword for counter type 16 (patched by dll_tower_menu.py)
ROAD_MENU_ROW = 0xF2              # "Hunting Road": the Road's own menu; its first row opens counter type 18 (0xe9)
ROAD_LIST_ROW = 0xE9
SPLIT_PATCH_AT = 0x1037E60B       # kind 0x43's switch index: 0x50 in the client, 0x48 with part 225's split
TOWER_TEST_IDS = {0x54E3} | set(range(0x54F2, 0x54F9))   # the counter tower test (0x101cfd60, part 106)
RAVIENTE_TYPES = (22, 40, 50, 51)
# Tune 1158 (isDelivery_venom_ult_quest) as Erupe sends it: 1, but 0 for sessions at SkyCorridor.Endless.MinimumPatch
# (v1.32-pre9) or later while Endless is on (live config 2026-11-25: on), i.e. the pre-release (Erupe sky_endless.go).
TUNE_1158 = {"stable": 1, "pre": 0}

# Rows whose list the builder cannot give exactly from the files alone (sure=False), and why.
ROW_NOTES = {
    0x0F: "festival winning team only",
    0x2F: "Raviente (Great Slaying)",
    0x99: "2nd-4th District need Tower Rank 51, 100, 200 (SkyCorridor.Endless.TowerRankGates)",
}


def _u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def _u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def _ids_at(b, o):
    out = []
    while 0 < o and o + 2 <= len(b):
        q = _u16(b, o)
        if not q:
            break
        out.append(q)
        o += 2
    return out


def inf_slot(inf, off):
    """The u16 quest-id lists of mhfinf header slot OFF (+0x18 .. +0x84): [ids, ...]."""
    table = _u32(inf, off)
    if not table:
        return []
    count = _u16(inf, _u32(inf, 0x10) + 2 * ((off - 0x14) // 4))
    return [_ids_at(inf, _u32(inf, table + 4 * i)) for i in range(count)]


def dat_entries(dat, off):
    """An mhfdat list of 8-byte entries (u16 quest id first) ended by id 0, through [dat+off] -> u32 offset."""
    head = _u32(dat, off)
    if not head or head + 4 > len(dat):
        return []
    p, out = _u32(dat, head), []
    while p and p + 8 <= len(dat):
        q = _u16(dat, p)
        if not q:
            break
        out.append(q)
        p += 8
    return out


def dat_strided(dat, off, count_at, first, step):
    arr = _u32(dat, off)
    count = _u16(dat, _u32(dat, 0x10) + count_at)
    return [q for q in (_u16(dat, arr + 2 * i) for i in range(first, count, step)) if q]


def hr_bands(dat):
    """[(band 1-7, [(id, key, urgent)])] of mhfdat [+0xa98] (hvmhfz_re item_sources.hr_band_quests)."""
    table = _u32(dat, 0xA98)
    out = []
    for band in range(1, 8):
        p, rows = _u32(dat, table + 4 * (band - 1)), []
        while p and p + 8 <= len(dat):
            q, _flag, key, urgent = struct.unpack_from("<HHBB", dat, p)
            if not q:
                break
            rows.append((q, key, urgent))
            p += 8
        out.append((band, rows))
    return out


def flat(lists):
    out = []
    for ids in lists:
        for q in ids:
            if q not in out:
                out.append(q)
    return out


def g_flag(inf, q):
    """The record's G Rank bit (body +0x97 bit 3), or None without a record (hvmhfz_re inf_quest_title.record)."""
    import inf_quest_title
    try:
        return bool(inf[inf_quest_title.record(inf, q) + 0x97] & 8)
    except ValueError:
        return None


def list_source(n, inf, dat, row, split, counter, tune1158):
    """(ids, maybe_ids, note) of built-in list N (0x1037c730's case N) for menu row ROW at COUNTER. maybe_ids: listed
    only in some client state the files do not settle (shown as unconfirmed). TUNE1158: what Erupe sends this
    patch's sessions (isDelivery_venom_ult_quest; 0 for the endless Sky Corridor clients, v1.32-pre9 and later)."""
    s = lambda off: inf_slot(inf, off)
    pick = lambda off, i: (s(off)[i] if i < len(s(off)) else [])
    if n in (0, 1):
        return pick(0x34, n), [], None
    if n == 2:                       # Quest Orders: lists 0..count-2; Training Support (row 0x6e = 'n'): the last
        lists = s(0x20)
        if row == 0x6E:
            return (lists[-1] if lists else []), [], "Guild Ticket"
        return flat(lists[:-2]), (lists[-2] if len(lists) > 1 else []), "Guild Ticket"
    if n == 5:
        return flat(s(0x24)[:4]), [q for q in flat(s(0x18)[:4]) if q <= 10000], "follows the season and time"
    if n == 6:
        return flat(s(0x28)[:4] + s(0x2C)[:4]), [q for q in flat(s(0x18)[3:8]) if q > 10000], \
            "follows the season and time"
    if n == 7:
        return flat(s(0x30)[:4]), [], None
    if n == 8:
        return flat([pick(off, 3) for off in (0x24, 0x28, 0x2C, 0x30)]), [], None
    if 0x1D <= n <= 0x22:
        return pick(0x1C, n - 0x1D), [], None
    if n == 0x26:
        return pick(0x38, 0), [], None
    if n == 0x27:
        return pick(0x3C, 0), [], None
    if 0x29 <= n <= 0x2F:
        return dat_entries(dat, 0x6C8 + 4 * (n - 0x29)), [], None
    if 0x30 <= n <= 0x32:
        return dat_entries(dat, 0x740 + 4 * (n - 0x30)), [], None
    if 0x33 <= n <= 0x3C:            # the Order Quests family: [+0x48] when 0x11513320 (tune 1046,
        i = n - 0x33                 # get_hunter_life_cap; Erupe sends 99) is 0, else [+0x4c/+0x50/+0x54]
        return flat([pick(0x4C, i), pick(0x50, i), pick(0x54, i)]), [], None   # (parent row not 0xa0-0xa7)
    if n == 0x3E:
        return pick(0x44, 0), [], None
    if n == 0x42:
        return pick(0x58, 0), [], None
    if n == 0x46:                    # 0x1037f320: at the G counter (type 0xe) the G records, elsewhere the others
        g = counter == "G Rank Quest Counter"
        return [q for q in pick(0x60, 0) if g_flag(inf, q) is g], [], None
    if 0x47 <= n <= 0x4E:
        return pick(0x64, n - 0x47), [], None
    if 0x4F <= n <= 0x55:
        return pick(0x68, n - 0x4F), [], None
    if 0x5F <= n <= 0x64:            # Hunter Quests ★N: band N's rows but the urgent one, each once HR cap allows
        band = dict(hr_bands(dat))[n - 0x5F + 1]
        return [q for q, _k, u in band if not u], [], None
    if n == 0x65:
        return [q for _b, rows in hr_bands(dat)[:6] for q, _k, u in rows if u], [], "after the band's Key Quests"
    if n == 0x66:                    # 0x1037f6c0: HR band 5 and up (HR from HRP above 99), each until cleared
        return pick(0x44, 1), [], "from HR 100, until cleared"
    if n == 0x67:
        return pick(0x44, 12), [], None
    if n == 0x68:
        return pick(0x38, 1), [], None
    if 0x69 <= n <= 0x6B:
        return pick(0x78, n - 0x69), [], None
    if n == 0x43 and not split:      # no case for 0x43 in the client's builder: always empty (tower-npc.md 5.1)
        return [], [], None
    if 0x56 <= n <= 0x5E:            # the ≪Hunter Training≫ lists (0x1037fa50; no counter root reaches them)
        if n == 0x5B:
            return flat(s(0x70)[0:6]), [], None
        if n == 0x5C:
            return flat(s(0x70)[6:13]), [], None
        return pick(0x70, 13) if n == 0x5D else pick(0x6C, 0 if n == 0x5E else n - 0x55), [], None
    if n in (0x6C, 0x43):            # the Road counter's list (Sky Corridor tower quests: TOWER_TEST_IDS)
        lists = s(0x5C)
        l0, l4, l8 = (lists + [[], [], []])[:3]
        if not split:                # v1.30: everything in Hunting Road Quests (list +8 needs tune 1158 = 1)
            return flat([l0, [q for q in l4 if q not in TOWER_TEST_IDS], l8]), [], None
        if n == 0x6C:
            return [q for q in l0 if q not in TOWER_TEST_IDS], [], None
        return [q for q in l0 if q in TOWER_TEST_IDS], [], None   # list +8: tune 1158 is 0 for pre9+ (endless)
    if n in (0x6D, 0x6E):
        return dat_strided(dat, 0xB34, 0x402, n - 0x6D, 2), [], None
    if 0x6F <= n <= 0x72:
        return dat_strided(dat, 0xB30, 0x400, n - 0x6F, 4), [], None
    if n == 0x73:                    # empty while tune 1158 is on; else one of three lists (0x107ace90 % 3)
        if tune1158:
            return [], [], None
        return flat([dat_entries(dat, off) for off in (0xB50, 0xB54, 0xB58)]), [], "one of three lists in turn"
    if n in (0x74, 0x75):
        return pick(0x7C, n - 0x74), [], None
    if n == 0x77:
        return pick(0x84, 0), [], None
    return [], [], None             # 3, 4, 9-0x1c (map lists of the HR lists), 0x23, 0x24, 0x76: special screens


def label(s):
    """A menu label as the game shows it, with its full-width letters and digits (★１, ＧＲＰ) in plain ASCII."""
    return s.translate({c: c - 0xFEE0 for c in range(0xFF01, 0xFF5F)}).replace("\\n", " ").strip()


def collect_patch(zip_path, re_dir, work, tune1158):
    sys.path.insert(0, str(re_dir / "tools" / "quest"))
    sys.path.insert(0, str(re_dir / "tools" / "translate"))
    import menu_lists as M
    names = {"dll": "Frontier_Patch/mhfo-hd.dll", "inf": "Frontier_Patch/dat/mhfinf.bin",
             "dat": "Frontier_Patch/dat/mhfdat.bin", "pac": "Frontier_Patch/dat/mhfpac.bin"}
    raw = {}
    with zipfile.ZipFile(zip_path) as z:
        for k, n in names.items():
            raw[k] = z.read(n)
    dec = {}
    for k in ("inf", "dat", "pac"):
        p = pathlib.Path(work) / (k + ".bin")
        p.write_bytes(raw[k])
        dec[k] = subprocess.run([str(re_dir / "build" / "unpack_cli"), str(p)], check=True,
                                capture_output=True).stdout
    pe = M.Pe(raw["dll"])
    rows = M.read_actions(pe, dec["pac"])
    split = pe.rd(SPLIT_PATCH_AT, 1) == b"\x48"
    parents = {0xC9: 0xC8, 0xCA: 0xC8, 0xCB: 0xC8}   # the client's ≪Hunter Training Quest≫ (our patch reuses 0xc8's list)
    for r in rows:
        for c in r["sub"]:
            if c not in (0xC9, 0xCA, 0xCB):
                parents.setdefault(c, r["action"])

    out, reached = [], set()

    def walk(counter, act, path, depth=0):
        r = rows[act]
        here = path + [label(r["label"])]
        reached.add(act)
        subs = list(r["sub"])
        if act == ROAD_MENU_ROW:     # the Road menu, only at the Road counter (0xf2's patched condition: type 16)
            if counter != "H.Road/Sky Corridor":
                return
            subs = subs or [ROAD_LIST_ROW]
        if r["spec"]:
            out.append(entry(counter, here, r))
        if depth < 4:
            for c in subs:
                walk(counter, c, here, depth + 1)

    def entry(counter, path, r):
        ids, maybe, types, notes = [], [], [], []
        for kind, arg in r["spec"]:
            if kind == 1:
                a, b, note = list_source(arg, dec["inf"], dec["dat"], r["action"], split, counter, tune1158)
                ids += [q for q in a if q not in ids]
                maybe += [q for q in b if q not in maybe and q not in ids]
                if note and note not in notes:
                    notes.append(note)
                if arg == 0x67:
                    types.append(43)      # Zenith Monster Quests: 0x1037eef0 adds event quests of type 0x2b
            elif kind in (2, 3, 4):
                types.append(arg)
                if kind == 3:
                    types += list(RAVIENTE_TYPES)
                if kind == 4:
                    notes.append("and the Diva Defense list")
        if ROW_NOTES.get(r["action"]):
            notes.append(ROW_NOTES[r["action"]])
        if counter in UNSURE_COUNTERS:
            ids, maybe, types = [], ids + [q for q in maybe if q not in ids], []
        return {"counter": counter, "path": path, "row": r["action"], "ids": ids, "maybe": maybe,
                "types": sorted(set(types)), "note": "; ".join(notes) or None}

    for counter, roots in COUNTERS:
        if roots == "type16":
            roots = [_u32(pe.rd(TYPE16_ROOT_REF, 4), 0)]
        for root in roots:
            for act in M.read_bytes_list(pe, root):
                walk(counter, act, [])
    hidden = []
    for r in rows:
        if r["action"] in reached or not any(k == 1 for k, _ in r["spec"]):
            continue
        chain, a = [label(r["label"])], r["action"]
        while a in parents and len(chain) < 4:
            a = parents[a]
            chain.insert(0, label(rows[a]["label"]))
        e = entry(None, chain, r)
        if e["ids"] or e["maybe"]:
            e["ids"] = sorted(set(e["ids"]) | set(e["maybe"]))
            e["maybe"] = []
            hidden.append(e)
    # The Order Quests family's other copy ([+0x48], used only while tune 1046 is 0): what it alone holds.
    for e in list(out):
        for kind, arg in rows[e["row"]]["spec"]:
            if kind == 1 and 0x33 <= arg <= 0x3C and e["counter"] not in UNSURE_COUNTERS:
                alt = [q for q in (inf_slot(dec["inf"], 0x48) + [[]] * 10)[arg - 0x33] if q not in e["ids"]]
                if alt:
                    hidden.append({"counter": None, "path": e["path"][:-1] + [e["path"][-1] + " (an alternate list our "
                                   "server's settings switch off)"], "row": e["row"], "ids": alt, "maybe": [],
                                   "types": [], "note": None})
    return {"sha256": hashlib.sha256(zip_path.read_bytes()).hexdigest(), "split_tower": split,
            "rows": out, "hidden": hidden}


def psql(sql):
    cmd = ["ssh", "hvmhfz-db", "sudo -H psql -X -w -h localhost -U postgres -d erupe -At -F'|' -c " +
           json.dumps(sql)]
    return [line.split("|") for line in subprocess.run(cmd, check=True, capture_output=True, text=True)
            .stdout.splitlines() if line]


def collect_live(re_dir):
    ev = [[int(a), int(b), int(c), int(d)] for a, b, c, d in psql(
        "SELECT quest_id, quest_type, COALESCE(active_days, 0), COALESCE(inactive_days, 0) FROM event_quests "
        "ORDER BY quest_id, quest_type")]
    cup = [[int(a or 0), int(b or 0), int(c), d == "t", e] for a, b, c, d, e in psql(
        "SELECT solo_quest_id, guild_quest_id, quest_type, enabled, title FROM tournament_quests ORDER BY id")]
    vs = [[int(a), int(b), c == "t", d] for a, b, c, d in psql(
        "SELECT quest_id, quest_type, enabled, title FROM vs_bracket_quests ORDER BY id")]
    sc = {(int(a), int(b)) for a, b in psql("SELECT category_id, scenario_id FROM scenario_counter")}
    series = []
    lines = [x for x in (re_dir / "data" / "series_quests.tsv").read_text(encoding="utf-8").splitlines()
             if x and not x.startswith("#")]
    head = lines[0].split("\t")
    for line in lines[1:]:
        g = dict(zip(head, line.split("\t")))
        if (int(g["category"]), int(g["id"])) in sc:
            ids = [int(q) for q in g["quests"].split(",") if q.isdigit()]
            if ids:
                series.append([g["tab"], g["title_en"], ids])
    return {"event_quests": ev, "tournament_quests": cup, "vs_bracket_quests": vs, "series": series}


def collect(args):
    re_dir = pathlib.Path(args.re)
    data = {"_about": "Inputs of dev/make-quest-where.py (its --collect): the counter menus and built-in quest lists "
                      "of each client patch, and the live server's quest lists. Regenerate, do not edit.",
            "collected": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "patches": {}}
    for key, version, path in (("stable", args.stable_version, args.stable), ("pre", args.pre_version, args.pre)):
        with tempfile.TemporaryDirectory() as work:
            p = collect_patch(pathlib.Path(path), re_dir, work, TUNE_1158[key])
        p["version"] = version
        data["patches"][key] = p
    if args.no_live:
        old = json.loads(INPUTS.read_text(encoding="utf-8")) if INPUTS.exists() else {}
        data["live"], data["live_at"] = old.get("live"), old.get("live_at")
    else:
        data["live"], data["live_at"] = collect_live(re_dir), data["collected"]
    INPUTS.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("%s: stable %d rows, pre %d rows" % (INPUTS.relative_to(ROOT), len(data["patches"]["stable"]["rows"]),
                                               len(data["patches"]["pre"]["rows"])))


# ---------------------------------------------------------------------------------------------------------------
# Build

COUNTER_NEED = {"G Rank Quest Counter": "G Rank", "G Rank Quest Counter (My Missions menu)": "G Rank"}


def build(inputs, quests):
    places = {}           # id -> {(path, need, note, sure): set(patch keys)}
    hidden = {}

    def add(q, path, key, need=None, note=None, sure=True):
        places.setdefault(q, {}).setdefault((path, need, note, sure), set()).add(key)

    by_type = {}          # (patch key, type) -> [(path, need, note)]
    for key, patch in inputs["patches"].items():
        for row in patch["rows"]:
            path = " > ".join([row["counter"]] + row["path"])
            need = COUNTER_NEED.get(row["counter"])
            for q in row["ids"]:
                add(q, path, key, need, row["note"])
            for q in row["maybe"]:
                add(q, path, key, need, row["note"], False)
            for t in row["types"]:
                by_type.setdefault((key, t), []).append((path, need, row["note"]))
        for row in patch["hidden"]:
            for q in row["ids"]:
                hidden.setdefault(q, set()).add(" > ".join(row["path"]))

    live = inputs["live"]
    keys = list(inputs["patches"])

    def add_typed(q, t, extra=None):
        found = False
        for key in keys:
            for path, need, note in by_type.get((key, t), []):
                n = "; ".join(x for x in (note, extra) if x) or None
                add(q, path, key, need, n)
                found = True
        if not found:
            hidden.setdefault(q, set()).add("event list type %d (no counter row shows it)" % t)

    for q, t, active, inactive in live["event_quests"]:
        if t == 24:                  # Series: the Series Quest Counter finds them by quest id (below)
            continue
        add_typed(q, t, "rotates: %d days on, %d off" % (active, inactive) if active else None)
    for solo, guild, t, enabled, _title in live["tournament_quests"]:
        if enabled:
            for q in (solo, guild):
                if q:
                    add_typed(q, t, "while the Speedrun Cup runs")
    for q, t, enabled, _title in live["vs_bracket_quests"]:
        if enabled:
            add_typed(q, t, "VS Bracket: players with an open match")
    for tab, title, ids in live["series"]:
        for q in ids:
            for key in keys:
                add(q, "Series Quest Counter > %s > %s" % (tab, title), key)

    out, counts = {}, {"offered": 0, "unconfirmed": 0, "not-offered": 0, "pre-only": 0}
    for quest in sorted(quests, key=lambda x: x["id"]):
        q = quest["id"]
        rows = []
        for (path, need, note, sure), ks in sorted(places.get(q, {}).items(), key=lambda kv: (not kv[0][3], kv[0][0])):
            patch = "both" if set(ks) >= set(keys) else ("stable" if "stable" in ks else "pre")
            p = {"path": path, "patch": patch}
            if need:
                p["need"] = need
            if note:
                p["note"] = note
            if not sure:
                p["sure"] = False
            rows.append(p)
        # a place known for sure makes the same path's unconfirmed copy redundant
        sure_paths = {(p["path"], p["patch"]) for p in rows if p.get("sure", True)}
        rows = [p for p in rows if p.get("sure", True) or (p["path"], p["patch"]) not in sure_paths]
        if any(p.get("sure", True) for p in rows):
            status = "offered"
        elif rows:
            status = "unconfirmed"
        else:
            status = "not-offered"
        e = {"status": status, "places": rows}
        if status == "offered" and all(p["patch"] == "pre" for p in rows if p.get("sure", True)):
            counts["pre-only"] += 1
        if q in hidden and status != "offered":
            e["hidden"] = sorted(hidden[q])
        if quest.get("rankNeed"):
            e["rankNeed"] = quest["rankNeed"]
        counts[status] += 1
        out[str(q)] = e
    return out, counts


def render(inputs, quests):
    data, counts = build(inputs, quests)
    p = inputs["patches"]
    return json.dumps({
        "_about": "Where each quest of data/quests.json can be taken on Hunsterverse (dev/make-quest-where.py; "
                  "method and menu tree: dev/quest-where.md). status: offered (a counter lists it), unconfirmed "
                  "(only lists the files cannot settle), not-offered (no counter lists it). patch: both, stable (v%s "
                  "only) or pre (v%s, the Test land, only)." % (p["stable"]["version"], p["pre"]["version"]),
        "inputs": {"stable": p["stable"]["version"], "pre": p["pre"]["version"], "live": inputs.get("live_at")},
        "counts": counts,
        "quests": data,
    }, ensure_ascii=False, separators=(",", ":"), sort_keys=False) + "\n"


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--collect", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--stable", default=str(STABLE_ZIP))
    ap.add_argument("--stable-version", default="1.30")
    ap.add_argument("--pre", default=str(PRE_ZIP))
    ap.add_argument("--pre-version", default="1.32-pre18")
    ap.add_argument("--re", default=str(RE_DIR))
    ap.add_argument("--no-live", action="store_true", help="--collect: keep the live part of the old inputs")
    args = ap.parse_args(argv)
    if args.collect:
        collect(args)
        if args.check:
            return 0
    inputs = json.loads(INPUTS.read_text(encoding="utf-8"))
    quests = json.loads(QUESTS.read_text(encoding="utf-8"))["quests"]
    text = render(inputs, quests)
    if args.check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print("data/quest-where.json is out of date; run python3 dev/make-quest-where.py")
            return 1
        return 0
    OUT.write_text(text, encoding="utf-8")
    c = json.loads(text)["counts"]
    print("data/quest-where.json: %d quests: %d offered (%d only on the pre-release), %d unconfirmed, %d not offered"
          % (len(quests), c["offered"], c["pre-only"], c["unconfirmed"], c["not-offered"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
