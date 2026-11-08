#!/usr/bin/env python3
"""Checks data/patch-versions.json, the client patch versions the Play page lists (play.html#patches).

Every entry: version "1.N" (unique, newest first, one step per public patch), published as
"YYYY-MM-DDTHH:MMZ" or a date alone (newest first), a full sha256 (unique), size and file count, a
"what changed" line without HTML, an optional note, a changelog link to an id that exists in
changelog.html (or null), the download URL of its own GitHub release client-patch-v<version>, and
"current": true on the newest entry only. "current" at the top is the client_patch download.

    python3 dev/check-patch-versions.py                       # "patch versions OK", exit code 0
    python3 dev/check-patch-versions.py --backups DIR         # also: a zip with each sha256 and size in DIR
"""
import argparse
import hashlib
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
REPO = "https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz"
CURRENT_URL = REPO + "/releases/download/client_patch/Frontier_Patch.zip"
KEYS = {"version", "published", "sha256", "size", "files", "changes", "note", "changelog", "download", "current"}
WHEN = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}Z)?$")


def problems(doc, changelog_ids, backups=None):
    out = []
    if doc.get("current") != CURRENT_URL:
        out.append("current is not the client_patch download " + CURRENT_URL)
    patches = doc.get("patches")
    if not isinstance(patches, list) or not patches:
        return out + ["patches: no list"]
    seen_v, seen_sha = set(), set()
    prev = None
    for i, p in enumerate(patches):
        v = p.get("version")
        where = "patches[%d] v%s" % (i, v)
        extra = set(p) - KEYS
        missing = KEYS - {"note"} - set(p)
        if extra:
            out.append(where + ": unknown keys " + ", ".join(sorted(extra)))
        if missing:
            out.append(where + ": missing " + ", ".join(sorted(missing)))
            continue
        m = re.match(r"^(\d+)\.(\d+)$", str(v))
        if not m:
            out.append(where + ": version is not N.N")
            continue
        key = (int(m.group(1)), int(m.group(2)))
        if v in seen_v:
            out.append(where + ": version listed twice")
        seen_v.add(v)
        if not WHEN.match(str(p["published"])):
            out.append(where + ": published is not YYYY-MM-DD or YYYY-MM-DDTHH:MMZ")
        if prev:
            if key >= prev[0]:
                out.append(where + ": not older than the entry above (newest first)")
            if str(p["published"]) > prev[1]:
                out.append(where + ": published after the entry above")
            if key[0] == prev[0][0] and key[1] != prev[0][1] - 1:
                out.append(where + ": a version is skipped (v%d.%d above)" % prev[0])
        prev = (key, str(p["published"]))
        if not re.match(r"^[0-9a-f]{64}$", str(p["sha256"])):
            out.append(where + ": sha256 is not 64 hex digits")
        elif p["sha256"] in seen_sha:
            out.append(where + ": sha256 listed twice")
        seen_sha.add(p["sha256"])
        for k in ("size", "files"):
            if not isinstance(p[k], int) or isinstance(p[k], bool) or p[k] <= 0:
                out.append(where + ": " + k + " is not a positive number")
        for k in ("changes", "note"):
            if k in p and (not isinstance(p[k], str) or not p[k].strip() or "<" in p[k] or ">" in p[k]):
                out.append(where + ": " + k + " is empty or has HTML")
        cl = p["changelog"]
        if cl is not None:
            if not isinstance(cl, str) or not cl.startswith("/changelog.html#"):
                out.append(where + ": changelog is not /changelog.html#<id>")
            elif cl.split("#", 1)[1] not in changelog_ids:
                out.append(where + ": changelog.html has no id " + cl.split("#", 1)[1])
        want = REPO + "/releases/download/client-patch-v" + v + "/Frontier_Patch.zip"
        if p["download"] != want:
            out.append(where + ": download is not " + want)
        if p["current"] is not (i == 0):
            out.append(where + ": current must be true on the newest entry only")
        if backups is not None:
            hit = backups.get(p["sha256"])
            if not hit:
                out.append(where + ": no zip with sha256 %s… in the backups" % str(p["sha256"])[:8])
            elif hit[1] != p["size"]:
                out.append(where + ": size %s, but %s has %d bytes" % (p["size"], hit[0], hit[1]))
    return out


def hash_folder(folder):
    found = {}
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        path = os.path.join(folder, name)
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        found.setdefault(h.hexdigest(), (name, os.path.getsize(path)))
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--file", default=os.path.join(ROOT, "data", "patch-versions.json"))
    ap.add_argument("--backups", help="folder of patch zips to match every sha256 and size against")
    args = ap.parse_args()
    with open(args.file, encoding="utf-8") as f:
        doc = json.load(f)
    with open(os.path.join(ROOT, "changelog.html"), encoding="utf-8") as f:
        ids = set(re.findall(r'\sid="([^"]+)"', f.read()))
    found = problems(doc, ids, hash_folder(args.backups) if args.backups else None)
    for p in found:
        print("FAIL " + p)
    print("%d problem(s)" % len(found) if found else "patch versions OK (%d versions)" % len(doc["patches"]))
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
