#!/usr/bin/env node
/* Checks the policy rules of js/road-rules.js that the Go golden outputs do not cover (they run with no
   policy): the cap on the points multipliers (policy maxPoints, default 4) and editing the solo Road
   (mode 1), and the entry level: allowed by default, kept by copied-fields to the levels the base uses with
   the entry's other fields, and the choices the builder offers (levelChoices). Uses a small made-up Road,
   so it needs no game data:

     node dev/check-road-policy.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const rules = require("../js/road-rules.js");

function entry(monster, level, unk04) {
  return { monster: monster, unk04: unk04 || 0, monster2: 0, unk0c: 0, level: level || 1, unk14: -1, weight: 10, flags: 0 };
}

function mode() {
  return {
    floors: [
      { floor: 1, table: 0, bonus: 0, points: 1, points2: 1, loop: 0 },
      { floor: 2, table: 0, bonus: 0, points: 2, points2: 2, loop: 1 },
      { floor: 3, table: 0, bonus: 0, points: 4, points2: 4, loop: 0 }
    ],
    // table 1: level 2 for monsters 1, 4 and 5, and a Zenith-like entry (+0x04 16) at level 3
    tables: [[entry(1), entry(2), entry(3)], [entry(1, 2), entry(4, 2), entry(5), entry(6, 3, 16)]]
  };
}

const base = { modes: [mode(), mode()] };
const pointsAllowed = { floorFields: ["table", "points", "points2"] };

function floorEdit(m, fields) {
  return { modes: [{ mode: m, floors: [Object.assign({ floor: 2 }, fields)] }] };
}

const CASES = [
  {
    name: "the base passes",
    policy: {},
    edits: {},
    expected: []
  },
  {
    name: "points at the cap of 4 pass",
    policy: pointsAllowed,
    edits: floorEdit(0, { points: 4, points2: 0.5 }),
    expected: []
  },
  {
    name: "points over 4 are refused",
    policy: pointsAllowed,
    edits: floorEdit(0, { points: 4.5 }),
    expected: ["not-allowed 0/2 Changing the points multiplier to more than 4x is not allowed in this rotation."]
  },
  {
    name: "second points over 4 are refused",
    policy: pointsAllowed,
    edits: floorEdit(0, { points2: 5 }),
    expected: ["not-allowed 0/2 Changing the second points multiplier to more than 4x is not allowed in this rotation."]
  },
  {
    name: "points over 100 break the crash rule and the cap",
    policy: pointsAllowed,
    edits: floorEdit(0, { points: 150 }),
    expected: [
      "bad-edit -1/-1 Mode 0 floor 2: points multipliers must be above 0 and at most 100.",
      "not-allowed 0/2 Changing the points multiplier to more than 4x is not allowed in this rotation."
    ]
  },
  {
    name: "the pool's maxPoints replaces the default",
    policy: Object.assign({ maxPoints: 2 }, pointsAllowed),
    edits: floorEdit(0, { points: 3 }),
    expected: ["not-allowed 0/2 Changing the points multiplier to more than 2x is not allowed in this rotation."]
  },
  {
    name: "points are refused when the policy leaves them out",
    policy: {},
    edits: floorEdit(0, { points: 2 }),
    expected: ["not-allowed 0/2 Changing the points of a floor is not allowed in this rotation."]
  },
  {
    name: "the solo Road is refused by default",
    policy: {},
    edits: floorEdit(1, { table: 0 }),
    expected: ["not-allowed 1/-1 Changing mode 1 is not allowed in this rotation."]
  },
  {
    name: "the solo Road passes when the policy allows mode 1",
    policy: Object.assign({ modes: [0, 1] }, pointsAllowed),
    edits: floorEdit(1, { points: 3 }),
    expected: []
  },
  {
    name: "the cap applies to the solo Road too",
    policy: Object.assign({ modes: [0, 1] }, pointsAllowed),
    edits: floorEdit(1, { points: 4.25 }),
    expected: ["not-allowed 1/2 Changing the points multiplier to more than 4x is not allowed in this rotation."]
  },
  {
    name: "a level the base uses with the same fields passes, with the default policy",
    policy: {},
    edits: { modes: [{ mode: 0, entries: [{ table: 0, entry: 1, level: 2 }] }] },
    expected: []
  },
  {
    name: "a level the base uses only with other fields is refused by copied-fields",
    policy: {},
    edits: { modes: [{ mode: 0, entries: [{ table: 0, entry: 1, level: 3 }] }] },
    expected: ["copied-fields 0/-1 Mode 0 table 0 entry 1: level 3 with +0x04 0, +0x0c 0, +0x14 -1 and flags 0 " +
      "is not used by any entry of the live Road; copy them from an existing entry."]
  },
  {
    name: "a level is refused when the policy leaves it out",
    policy: { entryFields: ["monster", "monster2", "weight", "forced"] },
    edits: { modes: [{ mode: 0, entries: [{ table: 0, entry: 1, level: 2 }] }] },
    expected: ["not-allowed 0/-1 Changing the level of an entry is not allowed in this rotation."]
  }
];

let failed = 0;
CASES.forEach((c) => {
  const got = rules.checkEdits({ base: base, policy: c.policy }, c.edits).problems
    .map((p) => p.rule + " " + p.mode + "/" + p.floor + " " + p.message);
  if (JSON.stringify(got) === JSON.stringify(c.expected)) {
    console.log("ok   " + c.name);
    return;
  }
  failed++;
  console.log("FAIL " + c.name);
  console.log("  expected:" + (c.expected.length ? "" : " none"));
  c.expected.forEach((l) => console.log("    " + l));
  console.log("  got:" + (got.length ? "" : " none"));
  got.forEach((l) => console.log("    " + l));
});
// The levels the builder offers for an entry (js/road-rules.js levelChoices).
const LEVELS = [
  { name: "levels for monster 1: both used with it", entry: entry(1), expected: [[1, true], [2, true]] },
  { name: "levels for monster 2: level 2 not used with it", entry: entry(2), expected: [[1, true], [2, false]] },
  { name: "levels for a monster new to the Road", entry: entry(50), expected: [[1, false], [2, false]] },
  { name: "levels for a Zenith-like entry", entry: entry(6, 3, 16), expected: [[3, true]] },
  { name: "no levels for fields the base never uses", entry: entry(1, 1, 99), expected: [] }
];
LEVELS.forEach((c) => {
  const got = rules.levelChoices(base, c.entry).map((x) => [x.level, x.withMonster]);
  const ok = JSON.stringify(got) === JSON.stringify(c.expected);
  if (!ok) failed++;
  console.log((ok ? "ok   " : "FAIL ") + c.name + (ok ? "" : ": expected " + JSON.stringify(c.expected) + ", got " + JSON.stringify(got)));
});
const levelDefault = rules.DEFAULT_POLICY.entryFields.indexOf("level") >= 0;
if (!levelDefault) failed++;
console.log((levelDefault ? "ok   " : "FAIL ") + "the default policy allows the level");
const total = CASES.length + LEVELS.length + 1;
console.log(failed ? failed + " of " + total + " cases differ" : "all " + total + " cases match");
process.exit(failed ? 1 : 0);
