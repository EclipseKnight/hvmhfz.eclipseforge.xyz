#!/usr/bin/env node
/* Checks the allowed monsters of js/road-rules.js (any of the 176, owner 2026-10-28) the way Go's
   TestAllowedMonster does (Erupe cmd/rengoku-build/road): a monster the base never uses passes only
   when allowed, copies its fields from a drawn entry of its own table, and skips a weight-0 filler.
   Uses a small made-up Road, so it needs no game data:

     node dev/check-road-monsters.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const rules = require("../js/road-rules.js");

function entry(monster, level, unk04) {
  return { monster: monster, unk04: unk04 || 0, monster2: 0, unk0c: 0, level: level, unk14: -1, weight: 1, flags: 0 };
}

// Both modes alike. Table 0: monster 1 at level 60, then 6 and 11 at 53, then a pair; table 1: 2, 3, 4 at 40.
function mode() {
  const pair = entry(5, 53);
  pair.monster2 = 7;
  return {
    floors: [{ floor: 1, table: 0, bonus: 0, points: 1, points2: 1, loop: 1 },
             { floor: 2, table: 1, bonus: 0, points: 1, points2: 1, loop: 0 }],
    tables: [[entry(1, 60, 7), entry(6, 53, 8), entry(11, 53, 8), pair],
             [entry(2, 40, 9), entry(3, 40, 9), entry(4, 40, 9)]]
  };
}

function made() { return { modes: [mode(), mode()] }; }

const FIELDS = ["level", "unk04", "unk0c", "unk14", "flags"];
function fields(e) { return FIELDS.map((f) => e[f]).join(","); }
function messages(problems) { return problems.map((p) => p.rule + " " + p.message); }

let failed = 0;
let count = 0;
function expect(name, got, want) {
  count++;
  if (JSON.stringify(got) === JSON.stringify(want)) { console.log("ok   " + name); return; }
  failed++;
  console.log("FAIL " + name + "\n  expected " + JSON.stringify(want) + "\n  got      " + JSON.stringify(got));
}

function run(base, edits, extra) {
  const applied = rules.apply(base, edits, extra);
  return { road: applied.road, problems: applied.problems.concat(rules.check(base, applied.road, extra)) };
}

expect("176 known monsters, ids 1 to 176", [rules.KNOWN_MONSTERS, Object.keys(rules.allMonsters()).length,
  !!rules.allMonsters()[1], !!rules.allMonsters()[176], !!rules.allMonsters()[177]], [176, 176, true, true, false]);

let base = made();
const edits = { modes: [{ mode: 0, entries: [
  { table: 0, entry: 2, monster: 99 },            // replaces monster 11 at level 53
  { table: 0, entry: 4, monster: 99, weight: 1 }  // added
] }] };
expect("a monster the base never uses is refused without the extra id", messages(run(base, edits, null).problems), [
  "unknown-monster Mode 0 table 0 entry 2: monster 99 is not one of the 8 allowed monsters.",
  "unknown-monster Mode 0 table 0 entry 4: monster 99 is not one of the 8 allowed monsters."
]);
let res = run(base, edits, { 99: true });
expect("it passes with the extra id", messages(res.problems), []);
expect("a replaced entry takes the fields of a drawn entry at its level",
  fields(res.road.modes[0].tables[0][2]), fields(base.modes[0].tables[0][1]));
expect("an added entry takes the fields of the table's first drawn entry",
  fields(res.road.modes[0].tables[0][4]), fields(base.modes[0].tables[0][0]));
expect("another unknown monster is still refused, and the count includes the allowed one",
  messages(run(base, { modes: [{ mode: 0, entries: [{ table: 0, entry: 2, monster: 98 }] }] }, { 99: true }).problems),
  ["unknown-monster Mode 0 table 0 entry 2: monster 98 is not one of the 9 allowed monsters."]);
res = run(base, { modes: [{ mode: 0, entries: [{ table: 0, entry: 1, monster2: 99 }] }] }, { 99: true });
expect("a new second monster takes the fields of the table's pair", messages(res.problems), []);
expect("  (its fields)", fields(res.road.modes[0].tables[0][1]), fields(base.modes[0].tables[0][3]));

// A weight-0 forced filler (as monster 71 starts live mode 0 tables 5 and 11) is never drawn, so it
// gives no fields: the new monster takes the next entry.
base = made();
base.modes[0].tables[1].unshift({ monster: 71, unk04: 20, monster2: 0, unk0c: 0, level: 60, unk14: 3,
  weight: 0, flags: rules.FLAG_FORCED });
res = run(base, { modes: [{ mode: 0, entries: [{ table: 1, entry: 4, monster: 99, weight: 1 }] }] }, { 99: true });
expect("with a weight-0 filler first, an added monster passes", messages(res.problems), []);
expect("  and takes the fields of the first drawn entry, not the filler's",
  fields(res.road.modes[0].tables[1][4]), fields(base.modes[0].tables[1][1]));

expect("the page allows all 176 by default", messages(rules.checkEdits({ base: made(), policy: null },
  { modes: [{ mode: 0, entries: [{ table: 1, entry: 0, monster: 176 }, { table: 1, entry: 1, monster: 177 }] }] }).problems),
  ["unknown-monster Mode 0 table 1 entry 1: monster 177 is not one of the 176 allowed monsters."]);

console.log(failed ? failed + " of " + count + " cases differ" : "all " + count + " cases match");
process.exit(failed ? 1 : 0);
