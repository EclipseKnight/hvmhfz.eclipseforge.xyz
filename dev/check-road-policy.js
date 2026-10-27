#!/usr/bin/env node
/* Checks the policy rules of js/road-rules.js that the Go golden outputs do not cover (they run with no
   policy): the cap on the points multipliers (policy maxPoints, default 4) and editing the solo Road
   (mode 1). Uses a small made-up Road, so it needs no game data:

     node dev/check-road-policy.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const rules = require("../js/road-rules.js");

function entry(monster) {
  return { monster: monster, unk04: 0, monster2: 0, unk0c: 0, level: 1, unk14: -1, weight: 10, flags: 0 };
}

function mode() {
  return {
    floors: [
      { floor: 1, table: 0, bonus: 0, points: 1, points2: 1, loop: 0 },
      { floor: 2, table: 0, bonus: 0, points: 2, points2: 2, loop: 1 },
      { floor: 3, table: 0, bonus: 0, points: 4, points2: 4, loop: 0 }
    ],
    tables: [[entry(1), entry(2), entry(3)]]
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
console.log(failed ? failed + " of " + CASES.length + " cases differ" : "all " + CASES.length + " cases match");
process.exit(failed ? 1 : 0);
