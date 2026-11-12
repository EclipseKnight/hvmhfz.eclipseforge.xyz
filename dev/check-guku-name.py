#!/usr/bin/env python3
"""The house pet グーク is "Gu-ku" on this site, never the slur (owner, 2026-11-12). Fails when any tracked
text file (pages, data, scripts, docs) or file name holds "gook" in any case, inside a longer word too
(Patapatagook, an anchor such as #gook-farm). Binary files (images) are not read: a compressed picture can hold
those four letters by chance.

    python3 dev/check-guku-name.py
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PATTERN = re.compile("gook", re.I)


def main():
    bad = []
    for name in subprocess.check_output(["git", "-C", str(ROOT), "ls-files", "-z"], text=True).split("\0"):
        if not name:
            continue
        if PATTERN.search(name):
            bad.append("%s: the file name" % name)
        try:
            text = (ROOT / name).read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue  # an image, or a file removed in the working tree
        if name == "dev/check-guku-name.py":
            continue
        for n, line in enumerate(text.splitlines(), 1):
            if PATTERN.search(line):
                bad.append("%s:%d: %s" % (name, n, PATTERN.sub(lambda m: "[%s]" % m.group(), line.strip())[:100]))
    for b in bad[:40]:
        print(b)
    if bad:
        print("%d places name the pet with the slur; spell it Gu-ku (identifiers: guku)" % len(bad))
        return 1
    print("no Gook anywhere: OK")
    return 0


sys.exit(main())
