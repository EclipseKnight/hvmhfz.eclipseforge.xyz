#!/usr/bin/env python3
"""Move every reference to the site's own address from the old domain to the new one, then regenerate.

    python3 dev/set-site-domain.py           rewrite, then run dev/make-share-pages.py and dev/make-og.py
    python3 dev/set-site-domain.py --check   change nothing; exit 1 and list file:line for every old address left
    python3 dev/set-site-domain.py --self-test   the rules on made-up lines

What counts as the site's own address (in every text file git tracks or would add, s/ included):
  - https://hvmhfz.eclipseforge.xyz (or http://): canonical, og:url, og:image, twitter:image, sitemap.xml,
    robots.txt, share pages, constants in js/ and dev/, README and docs;
  - the same written as a regular expression (https://hvmhfz\\.eclipseforge\\.xyz, dev/check-links.py);
  - the bare host as a label, e.g. the domain drawn on the preview cards (dev/make-og.py) and the hunter card
    (js/hunters.js).
Left alone: the API (https://api.hvmhfz.eclipseforge.xyz, not moving), the GitHub repository
(github.com/EclipseKnight/hvmhfz.eclipseforge.xyz, its name stays), folder paths (/root/mhfz/hvmhfz.eclipseforge.xyz),
and ALLOW below. Safe to run again: a second run changes nothing. Each run prints the count by kind.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OLD = "hvmhfz.eclipseforge.xyz"
NEW = "frontier.hunsterverse.net"

# (pattern, replacement). A host is only the site's when nothing host- or path-like is right before it
# (so api.<old>, github.com/EclipseKnight/<old> and /root/mhfz/<old> do not match).
NOT_AFTER = r"(?<![\w.\-/\\])"
NOT_BEFORE = r"(?![\w-])"
RULES = [
    ("url", re.compile(r"https?://" + re.escape(OLD) + NOT_BEFORE), "https://" + NEW),
    ("regex", re.compile(r"https?://" + re.escape(re.escape(OLD)) + NOT_BEFORE), "https://" + re.escape(NEW)),
    ("host", re.compile(NOT_AFTER + re.escape(OLD) + NOT_BEFORE), NEW),
]

# (path, regex the line must match): lines that keep the old domain on purpose.
ALLOW = [
    ("CNAME", r""),  # GitHub Pages rewrites it when the owner sets the custom domain
    ("README.md", r"^# hvmhfz\.eclipseforge\.xyz$"),  # the repository's name, which stays
    ("changelog.html", r"<b>New address:</b>"),  # the entry that records the move
    ("dev/set-site-domain.py", r""),  # this script
]


def files():
    out = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                         cwd=ROOT, check=True, capture_output=True).stdout
    for name in sorted(set(out.decode().split("\0"))):
        path = ROOT / name
        if name and path.is_file() and not path.is_symlink():
            yield name, path


def allowed(name, line):
    return any(name == path and re.search(rx, line) for path, rx in ALLOW)


def kind(name, line):
    if name.startswith("s/"):
        return "share pages s/"
    if name in ("sitemap.xml", "robots.txt"):
        return name
    for tag, label in (('rel="canonical"', "canonical"), ('property="og:url"', "og:url"),
                       ('property="og:image"', "og:image"), ('name="twitter:image"', "twitter:image")):
        if tag in line:
            return label
    if name.startswith("dev/"):
        return "dev/ scripts"
    if name.startswith("js/"):
        return "js/"
    if name.endswith(".md"):
        return "README and docs"
    return "other: " + name


def scan_line(name, line):
    """The old references on a line: [(rule, start)], each place counted once."""
    hits, taken = [], set()
    for rule, rx, _ in RULES:
        for m in rx.finditer(line):
            spot = line.find(OLD.split(".")[0], m.start())
            if spot not in taken:
                taken.add(spot)
                hits.append(rule)
    return hits


def rewrite(line):
    for _, rx, new in RULES:
        line = rx.sub(lambda m, new=new: new, line)
    return line


def self_test():
    cases = [  # (file, line before, line after)
        ("a.html", '<meta property="og:url" content="https://hvmhfz.eclipseforge.xyz/a.html" />',
         '<meta property="og:url" content="https://frontier.hunsterverse.net/a.html" />'),
        ("sitemap.xml", "<loc>http://hvmhfz.eclipseforge.xyz/</loc>", "<loc>https://frontier.hunsterverse.net/</loc>"),
        ("dev/x.py", r'r"<loc>https://hvmhfz\.eclipseforge\.xyz(/[^<]*)</loc>"',
         r'r"<loc>https://frontier\.hunsterverse\.net(/[^<]*)</loc>"'),
        ("js/x.js", 'fillText("hvmhfz.eclipseforge.xyz/hunters.html?id=" + id', 'fillText("frontier.hunsterverse.net/hunters.html?id=" + id'),
        ("js/x.js", 'var API = "https://api.hvmhfz.eclipseforge.xyz";', None),
        ("dev/x.js", r"route(/api\.hvmhfz\.eclipseforge\.xyz/, f)", None),
        ("README.md", "https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases", None),
        ("docs/x.md", "cd /root/mhfz/hvmhfz.eclipseforge.xyz", None),
        ("a.html", "https://hvmhfz.eclipseforge.xyzz/", None),
        ("CNAME", "hvmhfz.eclipseforge.xyz", "keep"),
        ("README.md", "# hvmhfz.eclipseforge.xyz", "keep"),
        ("changelog.html", "<li>... <b>New address:</b> old hvmhfz.eclipseforge.xyz links still work</li>", "keep"),
    ]
    bad = 0
    for name, before, after in cases:
        if after == "keep":
            got, want = allowed(name, before), True
        else:
            got, want = rewrite(before), after or before
            if bool(scan_line(name, before)) != (after is not None):
                print("FAIL: --check would", "miss" if after else "flag", name, before)
                bad += 1
        if got != want:
            print("FAIL:", name, before, "->", got, "want", want)
            bad += 1
    print("set-site-domain self-test", "OK" if not bad else f"{bad} failure(s)", f"({len(cases)} cases)")
    return 1 if bad else 0


def main():
    if "--self-test" in sys.argv[1:]:
        return self_test()
    check = "--check" in sys.argv[1:]
    counts, left, changed = {}, [], []
    for name, path in files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # pictures and other binary files
        if OLD not in text and re.escape(OLD) not in text:
            continue
        lines = text.split("\n")
        for i, line in enumerate(lines):
            if allowed(name, line):
                continue
            hits = scan_line(name, line)
            if not hits:
                continue
            k = kind(name, line)
            counts[k] = counts.get(k, 0) + len(hits)
            if check:
                left.append(f"{name}:{i + 1}: {line.strip()[:160]}")
                continue
            lines[i] = rewrite(line)
        if not check:
            new_text = "\n".join(lines)
            if new_text != text:
                path.write_text(new_text, encoding="utf-8")
                changed.append(name)

    total = sum(counts.values())
    print(("old site address left" if check else "old site address rewritten") + f": {total}")
    for k in sorted(counts, key=lambda k: (-counts[k], k)):
        print(f"  {counts[k]:6d}  {k}")
    if check:
        for line in left[:200]:
            print(line)
        if len(left) > 200:
            print(f"... and {len(left) - 200} more line(s)")
        print("site domain OK" if not left else f"{len(left)} line(s) still use {OLD}")
        return 1 if left else 0

    print(f"{len(changed)} file(s) changed")
    # What the generators make from the new address: the share pages and the preview cards (the domain is
    # drawn on them). Both write the same bytes when nothing changed.
    for script in ("dev/make-share-pages.py", "dev/make-og.py"):
        print("running", script)
        subprocess.run([sys.executable, str(ROOT / script)], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
