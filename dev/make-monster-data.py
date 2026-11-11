#!/usr/bin/env python3
"""Write the game's own monster and quest reward data for the monster and quest pages.

    python3 dev/make-monster-data.py [--src /root/work/monster-data] [--items PATH]

Reads the outputs of hvmhfz_re tools/monsters (part 100, docs/monsters-data.md section 6):
    SRC/out/monsters.json               HP per level, hitzones per quest class and state, breaks, status, modifiers
    SRC/out/quest_rewards.json          the live quest files' reward groups and monsters
    SRC/out-drops/monster_drops.json    carves, tail carves, shiny drops, captures, breaks (and Zenith)
    SRC/out-attacks/monster_attacks.json  attack records (monsters 99 and up from mhfsdt; the older monsters' linked DLL rows, part 103)
and item names from hvmhfz_re data/item_sources.tsv (part 99; data/item-ids.json fills the rest).

Writes, compact and only the fields the pages use:
    data/monsters/game/index.json       {id: [name, slug or null, has hitzones]} for the calculator and quest pages
    data/monsters/game/<id>.json        one per monster id (js/monster-game.js reads it)
    data/quests/rewards/<n>.json        quests n*1000 .. n*1000+999: {names: {item: name}, quests: {id: {...}}}

The client's files themselves are never copied here: only the numbers the pages show.
"""
import argparse
import json
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_MON = ROOT / "data" / "monsters" / "game"
OUT_QUEST = ROOT / "data" / "quests" / "rewards"

# The quest classes the page shows (docs/monsters-data.md section 6); the others mostly repeat them.
SHOWN = [(0, "Low rank"), (1, "High rank"), (3, "HR100+ / Hardcore"), (7, "G rank"), (9, "Zenith")]
# The site's column order; the game's row is id, cut, impact, shot, fire, water, ice, thunder, dragon, stun.
GAME_COLS = ["id", "cut", "impact", "shot", "fire", "water", "ice", "thunder", "dragon", "stun"]
COLS = ["cut", "impact", "shot", "fire", "water", "thunder", "dragon", "ice", "stun"]
STATUS = ["poison", "paralysis", "sleep", "stun", "tranq", "blast"]
# Attack record +0x0f type mask: 0x01 physical; the element bits map to the hunter's resist slots in the
# game's resist order (fire, water, thunder, dragon, ice). The names are ours, from the monsters' known
# elements (Zinogre 0x40, Barioth 0x80, Deviljho 0x20).
ELEMENT_BITS = [(0x04, "fire"), (0x10, "water"), (0x40, "thunder"), (0x20, "dragon"), (0x80, "ice")]


def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def rnd(x):
    return round(x, 4)


def load_items(path):
    names = {}
    site = json.loads((ROOT / "data" / "item-ids.json").read_text())
    if isinstance(site, dict):
        for k, v in site.items():
            name = v if isinstance(v, str) else (v.get("name") if isinstance(v, dict) else None)
            if name and str(k).isdigit():
                names[int(k)] = name
    if path and Path(path).exists():
        for line in Path(path).read_text().splitlines()[1:]:
            f = line.split("\t")
            if len(f) > 2 and f[0] == "item" and f[1].isdigit() and f[2]:
                names[int(f[1])] = f[2]
    return names


def norm(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def community_rows(site):
    """Every hitzone row of a community file (base, enraged and each form), with its part name and state."""
    out = []

    def add(form):
        for state, key in ((0, "hitzones"), (1, "hitzonesEnraged")):
            for r in form.get(key) or []:
                vals = tuple(r.get(c) for c in COLS[:8])
                out.append((vals, r.get("part"), state))
    if site:
        add(site)
        for v in site.get("variantStats") or []:
            add(v)
    return out


def hitzone_states(mon, key, comm, item_names):
    sets = mon["hitzone_sets"][key]
    names = mon.get("part_names") or []
    states = []
    for si, rows in enumerate(sets):
        out_rows = []
        enraged_hits = 0
        for pi, row in enumerate(rows):
            vals = dict(zip(GAME_COLS, row))
            if not any(vals[c] for c in COLS[:8]):
                continue  # an unused slot: no damage of any kind
            # Name source: 1 = the part list (community labels, counts fit), 2 = a community row with the same
            # values (a guess), 0 = no name (shown as "Part N").
            name, how = (names[pi], 1) if pi < len(names) and names[pi] else (None, 0)
            ordered = tuple(vals[c] for c in COLS[:8])
            if not name:
                hit = [c for c in comm if c[0] == ordered and c[1]]
                if hit:
                    name, how = hit[0][1], 2
            if any(c[0] == ordered and c[2] == 1 for c in comm) and not any(c[0] == ordered and c[2] == 0 for c in comm):
                enraged_hits += 1
            out_rows.append([name or ("Part %d" % (pi + 1)), how] + [vals[c] for c in COLS])
        if si == 0:
            label = "Normal"
        elif len(sets) == 2:
            label = "Enraged" if enraged_hits else "Enraged or second form"
        else:
            label = "State %d" % (si + 1) + (" (enraged)" if enraged_hits else "")
        states.append({"label": label, "rows": out_rows})
    return states


def status_block(st):
    out = {}
    for k in STATUS:
        s = st.get(k)
        if not s:
            continue
        thr = s.get("threshold")
        if thr is None or thr >= 65535:
            out[k] = None  # immune
            continue
        e = {"threshold": thr, "increase": s.get("increase", 0), "cap": s.get("cap", 0)}
        if "duration_frames" in s:
            e["duration"] = round(s["duration_frames"] / 30, 1)
        if "recovery_frames" in s:
            e["recovery"] = s.get("recovery", 0)
            e["recoveryEvery"] = round(s["recovery_frames"] / 30, 1)
        if k == "poison":
            e["damage"] = s.get("damage")
            e["damageEvery"] = round(s.get("damage_frames", 0) / 30, 1)
        if k == "blast":
            e["damage"] = s.get("damage")
        out[k] = e
    return out


def breaks_block(mon, values):
    names = mon.get("break_part_names") or []
    out = []
    if names:
        for i, name in enumerate(names):
            if i < len(values) and values[i] > 0:
                out.append([name, values[i]])
    else:
        for i, v in enumerate(values):
            if v <= 0:
                break
            out.append(["Part %d" % (i + 1), v])
    return out


def drop_items(slot, names):
    items = []
    for it in slot.get("items") or []:
        iid = it.get("item")
        name = "Nothing" if not iid else names.get(iid) or it.get("name") or ("Item %d" % iid)
        items.append([iid, name, it.get("pct"), it.get("qty", 1)])
    return items


DROP_RANKS = {"0": "LR", "1": "HR", "2": "Arena", "3": "Elite", "7": "GR"}


def community_breaks(site):
    """{rank: [(method, set of item ids)]} for the community drop sections that are not carves, shiny or capture."""
    out = {}
    drops = (site or {}).get("drops") or {}
    for sec in drops.get("sections") or []:
        m = sec.get("method") or ""
        if re.search(r"carve|shiny|capture", m, re.I):
            continue
        for d in sec.get("drops") or []:
            ids = frozenset(int(i["hex"], 16) for i in d.get("items") or [] if i.get("hex"))
            if ids:
                out.setdefault(d.get("rank"), []).append((m, ids))
    return out


def drops_block(dr, names, site, zenith):
    if not dr:
        return None
    ranks = {}
    order = []
    comm = community_breaks(site)

    def put(rank, method, slot, count=None):
        items = drop_items(slot, names)
        if not items:
            return
        if rank not in ranks:
            ranks[rank] = []
            order.append(rank)
        sec = {"method": method, "items": items}
        if count:
            sec["count"] = count
        ranks[rank].append(sec)

    def walk(block, rankname):
        for key, method in (("carve", "Carves"), ("tail_carve", "Tail carves")):
            b = block.get(key)
            if b:
                for s, slot in sorted(b.get("slots", {}).items(), key=lambda x: int(x[0])):
                    put(rankname(s, slot), method, slot, b.get("count") or None)
        sets = block.get("carve_sets") or []
        sets = [sets[k] for k in sorted(sets, key=int)] if isinstance(sets, dict) else sets
        for i, b in enumerate(sets):
            for s, slot in sorted(b.get("slots", {}).items(), key=lambda x: int(x[0])):
                put(rankname(s, slot), "Extra carves %d" % (i + 1), slot, b.get("count") or None)
        b = block.get("shiny")
        if b:
            for s, slot in sorted(b.get("slots", {}).items(), key=lambda x: int(x[0])):
                put(rankname(s, slot), "Shiny drops", slot)
        b = block.get("capture")
        if b:
            for s, slot in sorted(b.get("slots", {}).items(), key=lambda x: int(x[0])):
                put(rankname(s, slot), "Capture", slot)
        for b in block.get("breaks") or []:
            for s, slot in sorted(b.get("slots", {}).items(), key=lambda x: int(x[0])):
                rank = rankname(s, slot)
                ids = frozenset(it["item"] for it in slot.get("items") or [] if it.get("item"))
                label = None
                used = [x["method"] for x in ranks.get(rank, [])]
                for m, cids in comm.get(rank, []):
                    m = re.sub(r"^part\s*break\s*:?\s*", "Break: ", m, flags=re.I)
                    if cids == ids and m not in used:
                        label = m
                        break
                put(rank, label or ("Break (part flag %d)" % b.get("part_bit")), slot)

    walk(dr, lambda s, slot: DROP_RANKS.get(s, slot.get("rank") or ("Class " + s)))
    if dr.get("zenith") and zenith:
        # Class slots 0-3 of the Zenith tables are the Zenith tiers; the rest is filler.
        walk(dr["zenith"], lambda s, slot: ("Zenith tier %d" % (int(s) + 1)) if int(s) < 4 else None)
    out = []
    for r in order:
        if r is None:
            continue
        same = next((o for o in out if o["sections"] == ranks[r]), None)
        if same:
            same["rank"] += " · " + r
        else:
            out.append({"rank": r, "sections": ranks[r]})
    return out


def attacks_block(att):
    """Lines [rows, power, ko, elements, community name, how sure, reach]; rows with the same numbers and the same
    confidence are one line. How sure: 0 = the game's attack file (mhfsdt, confirmed), 1 = a linked DLL row read the
    same on HD and SD, 2 = HD only. Reach: how many monsters' code can use the row (DLL rows; 0 for the file's)."""
    if not att or not att.get("attacks"):
        return None
    seen = {}
    order = []
    for r in att["attacks"]:
        if not r.get("power"):
            continue
        elems = [n for b, n in ELEMENT_BITS if r.get("type_mask", 0) & b]
        dll = str(r.get("set", "")).startswith("dll")
        sure = (1 if r.get("emu") == "hd+sd" else 2) if dll else 0
        key = (r["power"], r.get("ko", 0), tuple(elems), sure)
        if key not in seen:
            seen[key] = [[], r["power"], r.get("ko", 0), "+".join(elems), "", sure, 0]
            order.append(key)
        line = seen[key]
        line[0].append(r["row"])
        line[4] = line[4] or r.get("community") or ""
        line[6] = max(line[6], r.get("reach") or 0) if dll else 0
    for line in seen.values():
        line[0] = sorted(set(line[0]))
    return [seen[k] for k in order]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/root/work/monster-data")
    ap.add_argument("--items", default="/root/mhfz/hvmhfz_re/data/item_sources.tsv")
    args = ap.parse_args()
    src = Path(args.src)
    emd = json.loads((src / "out" / "monsters.json").read_text())
    drops = json.loads((src / "out-drops" / "monster_drops.json").read_text())
    attacks = json.loads((src / "out-attacks" / "monster_attacks.json").read_text())["monsters"]
    rewards = json.loads((src / "out" / "quest_rewards.json").read_text())["quests"]
    names = load_items(args.items)

    index = json.loads((ROOT / "data" / "monsters" / "index.json").read_text())
    slug_of = {}
    idx_of = {e["slug"]: e for e in index}
    for e in index:
        for i in e.get("ids") or []:
            slug_of.setdefault(i, e["slug"])
    sites = {}

    def site(slug):
        if slug not in sites:
            p = ROOT / "data" / "monsters" / (slug + ".json")
            sites[slug] = json.loads(p.read_text()) if p.exists() else None
        return sites[slug]

    OUT_MON.mkdir(parents=True, exist_ok=True)
    for old in OUT_MON.glob("*.json"):
        old.unlink()
    gindex = {}
    for mon in emd["monsters"]:
        mid = mon["id"]
        if not mon.get("base_hp") and not mon.get("hitzone_sets"):
            continue
        slug = slug_of.get(mid)
        comm_site = site(slug) if slug else None
        comm = community_rows(comm_site)
        base = mon["base_hp"]
        levels = [[int(base * f32(r[0])), rnd(r[1]), rnd(r[2]), rnd(r[3])] for r in mon["levels"]]
        ranks = []
        zenith = any("enith" in v for v in (idx_of.get(slug) or {}).get("variants") or [])
        for cls, label in SHOWN:
            if cls == 9 and not zenith:
                continue
            bc = mon["by_class"].get(str(cls))
            if not bc:
                continue
            block = {
                "hz": hitzone_states(mon, bc["hitzones"], comm, names) if bc.get("hitzones") in mon["hitzone_sets"] else [],
                "breaks": breaks_block(mon, bc.get("breaks") or []),
                "status": status_block(bc.get("status") or {}),
                "mods": {k: rnd(v) for k, v in bc["modifiers"].items()} if bc.get("modifiers") else None,
            }
            same = next((r for r in ranks if all(r[k] == block[k] for k in block)), None)
            if same:
                same["label"] += " · " + label
                same["classes"].append(cls)
            else:
                ranks.append(dict(label=label, classes=[cls], **block))
        has_hz = any(r["hz"] and any(s["rows"] for s in r["hz"]) for r in ranks)
        out = {"id": mid, "name": mon["name"], "slug": slug, "baseHp": base, "levels": levels, "ranks": ranks}
        d = drops_block(drops.get(str(mid)), names, comm_site, zenith)
        if d:
            out["drops"] = d
        a = attacks_block(attacks.get(str(mid)))
        if a:
            out["attacks"] = a
        (OUT_MON / ("%d.json" % mid)).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
        gindex[str(mid)] = [mon["name"], slug, has_hz]
    (OUT_MON / "index.json").write_text(json.dumps(gindex, ensure_ascii=False, separators=(",", ":")))

    OUT_QUEST.mkdir(parents=True, exist_ok=True)
    for old in OUT_QUEST.glob("*.json"):
        old.unlink()
    shards = {}
    for qid, q in rewards.items():
        shard = shards.setdefault(int(qid) // 1000, {"names": {}, "quests": {}})
        groups = []
        for g in q.get("rewards") or []:
            entries = []
            for e in g.get("entries") or []:
                iid = e.get("item")
                if iid:
                    shard["names"][str(iid)] = names.get(iid) or e.get("name") or ("Item %d" % iid)
                entries.append([iid, e.get("count", 1), e.get("chance")])
            if entries:
                groups.append({"g": g.get("group"), "when": g.get("condition"), "items": entries})
        shard["quests"][qid] = {
            "rank": q.get("class_name"), "level": q.get("level"),
            "monsters": [[m["id"], m.get("name"), m.get("hp")] for m in q.get("monsters") or []],
            "rewards": groups,
        }
    for n, shard in shards.items():
        (OUT_QUEST / ("%d.json" % n)).write_text(json.dumps(shard, ensure_ascii=False, separators=(",", ":")))
    total = sum(p.stat().st_size for p in list(OUT_MON.glob("*.json")) + list(OUT_QUEST.glob("*.json")))
    print("monsters %d, quest shards %d (%d quests), %.1f MB" % (len(gindex), len(shards), len(rewards), total / 1e6))


if __name__ == "__main__":
    main()
