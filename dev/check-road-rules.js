#!/usr/bin/env node
/* Checks js/road-rules.js against the Go golden outputs of the Road tool (Erupe, cmd/rengoku-build).
   There is no game data in this repo, so you give it the base Road as JSON and the fixtures folder:

     rengoku-build decode -in <live bin>/rengoku_data.bin > base.json     (keep base.json out of the repo)
     node dev/check-road-rules.js base.json <Erupe>/cmd/rengoku-build/testdata/roads

   For every <dir>/good/<name>.json and <dir>/bad/<name>.json the problems from the page's rules must be
   those of <dir>/expected/<name>.json (rule, mode, floor, table, entry, message, order). The rule
   "too-big" is left out of the expected list: only the API can compute it. The policy is off, so every
   edit is allowed. Monsters: all 176 are allowed, as in Go, unless <dir>/allow-monsters.json lists the
   fixture (name without .json -> ids allowed besides the base's; [] for the base's only).
   Then, as Go's TestEveryKnownMonsterBuilds: each of the 176 monsters as an added entry and as a second
   monster passes, 177 does not; and the monster names match <Erupe>/common/mhfmon/mhfmon.go. Exit code 0 = all match, 1 = a difference, 2 = bad arguments. */
"use strict";

const fs = require("fs");
const path = require("path");
const rules = require("../js/road-rules.js");

if (process.argv.length !== 4) {
  console.error("usage: node dev/check-road-rules.js <base.json> <fixtures dir>");
  process.exit(2);
}
const base = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const dir = process.argv[3];
const pool = { base: base, policy: null };
const FIELDS = ["rule", "mode", "floor", "table", "entry", "message"];
const allowFile = path.join(dir, "allow-monsters.json");
const allowLists = fs.existsSync(allowFile) ? JSON.parse(fs.readFileSync(allowFile, "utf8")) : {};

// The monsters a fixture is checked with besides the base's (Go fixtureExtras).
function extraFor(name) {
  if (!Object.prototype.hasOwnProperty.call(allowLists, name)) return rules.allMonsters();
  const ids = {};
  allowLists[name].forEach((id) => { ids[id] = true; });
  return ids;
}

function line(p) {
  return FIELDS.map((f) => f + "=" + JSON.stringify(p[f])).join(" ");
}

let failed = 0;
let count = 0;
["good", "bad"].forEach((kind) => {
  fs.readdirSync(path.join(dir, kind)).filter((f) => f.endsWith(".json")).sort().forEach((file) => {
    const name = file.replace(/\.json$/, "");
    const text = fs.readFileSync(path.join(dir, kind, file), "utf8");
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected", file), "utf8"))
      .problems.filter((p) => p.rule !== rules.RULES.tooBig).map(line);
    const got = rules.checkEdits(pool, text, { extra: extraFor(name) }).problems.map(line);
    count++;
    if (JSON.stringify(got) === JSON.stringify(expected)) {
      console.log("ok   " + kind + "/" + name + " (" + got.length + " problems)");
      return;
    }
    failed++;
    console.log("FAIL " + kind + "/" + name);
    console.log("  expected:" + (expected.length ? "" : " none"));
    expected.forEach((l) => console.log("    " + l));
    console.log("  got:" + (got.length ? "" : " none"));
    got.forEach((l) => console.log("    " + l));
  });
});

// Every known monster, as an added entry after table 1's 7 entries and as the second monster of the
// pair 91 + 92 (mode 0 table 0 entry 27).
const all = rules.allMonsters();
for (let id = 1; id <= rules.KNOWN_MONSTERS + 1; id++) {
  [{ table: 1, entry: 7, monster: id, weight: 1 }, { table: 0, entry: 27, monster2: id }].forEach((ee) => {
    const got = rules.checkEdits(pool, { modes: [{ mode: 0, entries: [ee] }] }, { extra: all }).problems;
    const ok = id > rules.KNOWN_MONSTERS
      ? got.length === 1 && got[0].rule === rules.RULES.unknownMonster
      : got.length === 0;
    count++;
    if (ok) return;
    failed++;
    console.log("FAIL monster " + id + " " + JSON.stringify(ee));
    got.forEach((p) => console.log("    " + line(p)));
  });
}
console.log("ok   every known monster as an added entry and as a second monster");

// The names must be Erupe's, so the page and the server tool name the same monster alike.
const mhfmon = path.join(dir, "..", "..", "..", "..", "common", "mhfmon", "mhfmon.go");
if (fs.existsSync(mhfmon)) {
  const table = fs.readFileSync(mhfmon, "utf8").split("var Monsters = []Monster{")[1].split("\n}")[0];
  const names = [...table.matchAll(/^\s*\{"(.*?)",/gm)].map((m) => m[1]);
  count++;
  if (JSON.stringify(names) === JSON.stringify(rules.MONSTER_NAMES)) {
    console.log("ok   monster names match " + mhfmon);
  } else {
    failed++;
    names.forEach((n, i) => {
      if (n !== rules.MONSTER_NAMES[i]) console.log("FAIL monster " + i + ": Erupe " + JSON.stringify(n) +
        ", page " + JSON.stringify(rules.MONSTER_NAMES[i]));
    });
    if (names.length !== rules.MONSTER_NAMES.length) {
      console.log("FAIL Erupe has " + names.length + " names, the page " + rules.MONSTER_NAMES.length);
    }
  }
} else {
  console.log("skip monster names: no " + mhfmon);
}
console.log(failed ? failed + " of " + count + " checks differ" : "all " + count + " checks match");
process.exit(failed ? 1 : 0);
