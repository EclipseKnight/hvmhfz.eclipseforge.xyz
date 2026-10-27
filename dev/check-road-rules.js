#!/usr/bin/env node
/* Checks js/road-rules.js against the Go golden outputs of the Road tool (Erupe, cmd/rengoku-build).
   There is no game data in this repo, so you give it the base Road as JSON and the fixtures folder:

     rengoku-build decode -in <live bin>/rengoku_data.bin > base.json     (keep base.json out of the repo)
     node dev/check-road-rules.js base.json <Erupe>/cmd/rengoku-build/testdata/roads

   For every <dir>/good/<name>.json and <dir>/bad/<name>.json the problems from the page's rules must be
   those of <dir>/expected/<name>.json (rule, mode, floor, table, entry, message, order). The rule
   "too-big" is left out of the expected list: only the API can compute it. The policy is off, so every
   edit is allowed. Exit code 0 = all match, 1 = a difference, 2 = bad arguments. */
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
    const got = rules.checkEdits(pool, text).problems.map(line);
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
console.log(failed ? failed + " of " + count + " fixtures differ" : "all " + count + " fixtures match");
process.exit(failed ? 1 : 0);
