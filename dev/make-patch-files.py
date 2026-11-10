#!/usr/bin/env python3
"""Writes or checks data/patch-files.json: the sha256 of the key game files inside each client patch zip.

The game's diagnostics report (hvdiag.txt, client patch part 87) lists the sha256 of these files as the
player has them; the API's Diagnostics upload compares them with this list to tell a player whose patch is
incomplete or mixed which file is wrong (and which version it comes from). data/patch-versions.json has the
zip's own sha256 only, so the entries' hashes are computed here, once per release, from the zips.

    python3 dev/make-patch-files.py --backups DIR   # (re)write it from the zips in DIR (matched by the zip's
                                                    # sha256 in patch-versions.json; pre-release zips by their
                                                    # name Frontier_Patch-v1.21-pre3.zip)
    python3 dev/make-patch-files.py --check         # "patch files OK": every version in patch-versions.json
                                                    # has an entry, every hash is 64 hex, current matches

Run it with --backups after every release (release-patch.sh adds the version to patch-versions.json first).
"""
import argparse
import hashlib
import json
import os
import re
import sys
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "patch-files.json")
VERSIONS = os.path.join(ROOT, "data", "patch-versions.json")
# The names the report uses (paths from the game folder); the zips keep them under Frontier_Patch/.
FILES = ["mhf.exe", "mhfo-hd.dll", "mhfo.dll", "dat/mhfdat.bin", "dat/mhfpac.bin", "dat/mhfinf.bin", "hvmods.dll"]
PRE = re.compile(r"^Frontier_Patch-v(\d+\.\d+-pre\d+)\.zip$")
ABOUT = ("sha256 of the key game files in each client patch zip, by version (pre-releases as 1.21-pre3). A file "
         "a version's zip does not ship is not listed. Read by the API's Diagnostics upload to compare a player's "
         "files (hvdiag.txt [files]) with the release. Written by dev/make-patch-files.py --backups DIR.")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def zip_files(path):
    """{report name: sha256} for the key files in one patch zip (any folder prefix, case-insensitive)."""
    out = {}
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name = info.filename.replace("\\", "/").lower()
            for want in FILES:
                if name == want or name.endswith("/" + want):
                    h = hashlib.sha256()
                    with z.open(info) as f:
                        for chunk in iter(lambda: f.read(1 << 20), b""):
                            h.update(chunk)
                    out[want] = h.hexdigest()
    return {k: out[k] for k in FILES if k in out}


def build(backups):
    with open(VERSIONS, encoding="utf-8") as f:
        doc = json.load(f)
    by_sha, pre = {}, {}
    for name in sorted(os.listdir(backups)):
        if not name.endswith(".zip"):
            continue
        path = os.path.join(backups, name)
        m = PRE.match(name)
        if m:
            pre[m.group(1)] = path
        else:
            by_sha.setdefault(sha256_file(path), path)
    versions, missing = {}, []
    for p in doc["patches"]:
        path = by_sha.get(p["sha256"])
        if path is None:
            missing.append(p["version"])
            continue
        versions[p["version"]] = zip_files(path)
    for v in sorted(pre, key=lambda s: [int(x) for x in re.findall(r"\d+", s)], reverse=True):
        versions[v] = zip_files(pre[v])
    current = next(p["version"] for p in doc["patches"] if p.get("current"))
    return {"_about": ABOUT, "current": current, "files": FILES, "versions": versions}, missing


def problems(doc, versions_doc):
    out = []
    if set(doc) != {"_about", "current", "files", "versions"}:
        out.append("keys are not _about, current, files, versions")
        return out
    current = next((p["version"] for p in versions_doc["patches"] if p.get("current")), None)
    if doc["current"] != current:
        out.append("current is %r, patch-versions.json says %r" % (doc["current"], current))
    for p in versions_doc["patches"]:
        if p["version"] not in doc["versions"]:
            out.append("v%s: no entry (run dev/make-patch-files.py --backups DIR)" % p["version"])
    for v, files in doc["versions"].items():
        if not re.match(r"^\d+\.\d+(-pre\d+)?$", v):
            out.append("version %r is not N.N or N.N-preN" % v)
        for name, sha in files.items():
            if name not in FILES:
                out.append("v%s: unknown file %s" % (v, name))
            if not re.match(r"^[0-9a-f]{64}$", str(sha)):
                out.append("v%s %s: not a sha256" % (v, name))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--backups", help="folder of patch zips: write data/patch-files.json from them")
    ap.add_argument("--check", action="store_true", help="check data/patch-files.json")
    args = ap.parse_args()
    if args.backups:
        doc, missing = build(args.backups)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=1)
            f.write("\n")
        for v in missing:
            print("WARN v%s: no zip with its sha256 in %s" % (v, args.backups))
        print("wrote %s (%d versions)" % (os.path.relpath(OUT, ROOT), len(doc["versions"])))
    if args.check or not args.backups:
        with open(OUT, encoding="utf-8") as f:
            doc = json.load(f)
        with open(VERSIONS, encoding="utf-8") as f:
            versions_doc = json.load(f)
        found = problems(doc, versions_doc)
        for p in found:
            print("FAIL " + p)
        print("%d problem(s)" % len(found) if found else "patch files OK (%d versions)" % len(doc["versions"]))
        return 1 if found else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
