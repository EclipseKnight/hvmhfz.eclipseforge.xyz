#!/usr/bin/env python3
"""Writes data/quest-gates.json: the Key Quests and Urgent Quests of each HR band, for the quest catalog's badges and
"Key & Urgent quests" filter (js/quests.js), the quest page's progression panel (js/quest.js) and the site search
(dev/make-search-index.py).

Source: hvmhfz_re data/progression_hr_gates.tsv (tools/quest/hr_gates.py, part 188, read from the client's
mhfdat gate tables). Columns: band, hr_cap, role (key/urgent), quest_id, clear_flag, req_hr, title; a comment line
gives the band thresholds (the save's HR cap word), e.g. "1, 30, 50, 99, 299, 998, 999". How it works in game: a
band's Urgent Quest appears once all of that band's Key Quests are cleared and the HR is high enough; clearing it
raises the HR cap to the next band's threshold. HR6 has Key Quests but no Urgent Quest; HR7 and G Rank have none.

The quest names come from the site's own data/quests.json (the titles the site already shows), not the tsv. The
quest's form (Hardcore, Supremacy...) is not copied: the pages read it from the quest data as for any quest.

  python3 dev/make-quest-gates.py [--tsv PATH]   # default /root/mhfz/hvmhfz_re/data/progression_hr_gates.tsv
  python3 dev/make-quest-gates.py --check         # change nothing; exit 1 when data/quest-gates.json differs
                                                  # (without the tsv: checks the file against data/quests.json only)
Checked by dev/check-quest-gates.js.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "quest-gates.json"
TSV = pathlib.Path("/root/mhfz/hvmhfz_re/data/progression_hr_gates.tsv")


def read_tsv(path):
    thresholds, rows, header = None, [], None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            m = re.search(r"band thresholds[^:]*:\s*([\d,\s]+)$", line)
            if m:
                thresholds = [int(x) for x in m.group(1).replace(" ", "").split(",") if x]
            continue
        if not line.strip():
            continue
        cells = line.split("\t")
        if header is None:
            header = cells
            continue
        rows.append(dict(zip(header, cells)))
    if not thresholds or not rows:
        raise SystemExit("%s: no band thresholds or no rows" % path)
    return thresholds, rows


def hr_range(lo, hi):
    return "HR %d" % lo if lo == hi else "HR %d-%d" % (lo, hi)


def build(thresholds, rows, names):
    """thresholds[n-1] is band n's HR cap (the save's cap word: 1, 30, 50, 99, 299, 998, 999). In band n the HR shown
    (from HR points) runs from one above band n-1's cap to band n's cap: HR1 = HR 1, HR2 = HR 2-30, ... HR6 = HR 300-998
    (hvmhfz_re docs/progression.md 1-2). Clearing band n's Urgent Quest raises the cap to thresholds[n]."""
    bands, quests = {}, {}
    for row in rows:
        band = int(row["band"])
        qid = int(row["quest_id"])
        if qid not in names:
            raise SystemExit("quest %d (HR%d %s) is not in data/quests.json" % (qid, band, row["role"]))
        lo, nxt = thresholds[band - 1], thresholds[band]
        b = bands.setdefault(band, {"band": band, "label": "HR%d" % band, "hr": hr_range(thresholds[band - 2] + 1 if band > 1 else 1, lo),
                                    "urgent": None, "unlocksHr": None, "keys": []})
        role = row["role"]
        if role == "urgent":
            if b["urgent"] is not None:
                raise SystemExit("HR%d has two Urgent Quests" % band)
            b["urgent"], b["unlocksHr"] = qid, nxt
        elif role == "key":
            b["keys"].append(qid)
        else:
            raise SystemExit("quest %d: unknown role %r" % (qid, role))
        quests[str(qid)] = {"role": role, "band": band, "reqHr": int(row["req_hr"]),
                            "flag": int(row["clear_flag"]), "name": names[qid]}
    return {
        "_about": "Key Quests and Urgent Quests per HR band, written by dev/make-quest-gates.py from hvmhfz_re "
                  "data/progression_hr_gates.tsv (the client's gate tables). A band's Urgent Quest appears once all "
                  "its Key Quests are cleared and the HR is high enough (reqHr); clearing it raises the HR cap to "
                  "unlocksHr. Keys in the game's order (flag = its clear flag). HR7 and G Rank have none.",
        "bands": [bands[n] for n in sorted(bands)],
        "quests": quests,
    }


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1) + "\n"


def main(args):
    tsv = TSV
    if "--tsv" in args:
        tsv = pathlib.Path(args[args.index("--tsv") + 1])
    names = {q["id"]: q["name"] for q in json.loads((ROOT / "data" / "quests.json").read_text(encoding="utf-8"))["quests"]}
    if not tsv.exists():
        if "--check" not in args:
            print("%s not found; give --tsv PATH" % tsv)
            return 1
        # The public repo's checkout has no hvmhfz_re: check the names against the site's quest data only.
        doc = json.loads(OUT.read_text(encoding="utf-8"))
        stale = [qid for qid, q in doc["quests"].items() if names.get(int(qid)) != q["name"]]
        if stale:
            print("data/quest-gates.json: names differ from data/quests.json for %s; run python3 dev/make-quest-gates.py"
                  % ", ".join(stale))
            return 1
        return 0
    text = dump(build(*read_tsv(tsv), names))
    current = OUT.read_text(encoding="utf-8") if OUT.exists() else None
    if "--check" in args:
        if current != text:
            print("data/quest-gates.json is out of date; run python3 dev/make-quest-gates.py")
            return 1
        return 0
    if current != text:
        OUT.write_text(text, encoding="utf-8")
    doc = json.loads(text)
    print("data/quest-gates.json: %d bands, %d quests%s" % (len(doc["bands"]), len(doc["quests"]),
                                                           " (written)" if current != text else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
