#!/usr/bin/env node
/* Checks js/road-summary.js: the words a Road's changes are listed in (road.html "Changes from the base").
   Uses a small made-up base Road (no game data) and js/road-rules.js apply, as the page does.

     node dev/check-road-summary.js

   Exit code 0 = all cases match, 1 = a difference. */
"use strict";

const rules = require("../js/road-rules.js");
const summary = require("../js/road-summary.js");

function entry(monster, monster2, weight, level, flags) {
  return { monster: monster, unk04: 0, monster2: monster2, unk0c: 0, level: level, unk14: -1, weight: weight, flags: flags };
}

function floor(n, table) { return { floor: n, table: table, loop: 0, points: 1, points2: 1, bonus: 0 }; }

const base = {
  modes: [
    {
      floors: [floor(1, 0), floor(10, 1), floor(20, 1)],
      tables: [
        [entry(1, 0, 10, 1, 0), entry(2, 0, 10, 1, 0), entry(3, 0, 10, 1, 0)],
        [entry(4, 0, 10, 3, 0), entry(5, 6, 5, 3, 0), entry(1, 0, 10, 3, 0)]
      ]
    },
    {
      floors: [floor(1, 0), floor(5, 0)],
      tables: [[entry(1, 0, 10, 1, 0), entry(2, 0, 10, 1, 0), entry(3, 0, 10, 1, 0)]]
    }
  ]
};

const NAMES = { 1: "Alpha", 2: "Bravo", 3: "Charlie", 4: "Delta", 5: "Echo", 6: "Foxtrot" };
function nameOf(id) { return NAMES[id] || "Unknown monster " + id; }

function run(edits) {
  const applied = rules.apply(base, rules.parseEdits(edits).edits);
  if (applied.problems.length) throw new Error("bad test edits: " + applied.problems[0].message);
  return summary.summarize(base, applied.road, nameOf);
}

const cases = [
  {
    name: "no edits",
    edits: {},
    want: { count: 0, road: [], modes: [] }
  },
  {
    name: "floors, entries, a new entry, a floor count",
    edits: {
      modes: [{
        mode: 0,
        floorCount: 2,
        floors: [{ floor: 2, table: 0, loop: 1, points: 1.5 }],
        entries: [
          { table: 0, entry: 1, monster: 4, weight: 20 },
          { table: 1, entry: 1, monster2: 0, forced: true },
          { table: 1, entry: 3, monster: 2, monster2: 3, weight: 1 }
        ]
      }]
    },
    want: {
      count: 5,
      road: [],
      modes: [{
        mode: 0,
        title: "Mode 0: open Road",
        floors: [
          "Record 2 (floors 10 to 19): table 1 → 0, loop off → on, points multiplier 1 → 1.5",
          "Floor records 3 → 2: the Road ends after record 2 (floors 10 to 19)."
        ],
        tables: [
          // Delta's level comes from the base (table 1), as the game file gets it.
          "Table 0, entry 1 (Bravo): monster Bravo → Delta, weight 10 → 20, level 1 → 3",
          "Table 1, entry 1 (Echo with Foxtrot): second monster Foxtrot → none, now forced",
          "Table 1, new entry 3: Bravo with Charlie, weight 1, level 0"
        ]
      }]
    }
  },
  {
    name: "solo mode and the mode count",
    edits: { modeCount: 1, modes: [{ mode: 1, floors: [{ floor: 1, bonus: 2 }] }] },
    want: {
      count: 1,
      road: ["Modes 2 → 1: mode 1 is left out."],
      modes: []
    }
  },
  {
    name: "a mode cut to no floors",
    edits: { modes: [{ mode: 1, floorCount: 0 }] },
    want: {
      count: 1,
      road: [],
      modes: [{ mode: 1, title: "Mode 1: solo Road", floors: ["Floor records 2 → 0: this mode has no floors left."], tables: [] }]
    }
  },
  {
    name: "solo mode only",
    edits: { modes: [{ mode: 1, floors: [{ floor: 2, points2: 2 }], entries: [{ table: 0, entry: 2, weight: 0 }] }] },
    want: {
      count: 2,
      road: [],
      modes: [{
        mode: 1,
        title: "Mode 1: solo Road",
        floors: ["Record 2 (floor 5 and up): second points multiplier 1 → 2"],
        tables: ["Table 0, entry 2 (Charlie): weight 10 → 0"]
      }]
    }
  }
];

let failed = 0;
cases.forEach((c) => {
  const got = JSON.stringify(run(c.edits), null, 2);
  const want = JSON.stringify(c.want, null, 2);
  if (got === want) {
    console.log("ok   " + c.name);
    return;
  }
  failed++;
  console.log("FAIL " + c.name);
  console.log("  want: " + want.replace(/\n/g, "\n        "));
  console.log("  got:  " + got.replace(/\n/g, "\n        "));
});
console.log(failed ? failed + " of " + cases.length + " cases differ" : "all " + cases.length + " cases match");
process.exit(failed ? 1 : 0);
